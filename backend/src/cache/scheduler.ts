import { getDb } from './database';
import { cacheManager } from './cache-manager';
import { darkstoreTracker } from './darkstore-tracker';
import { priceTracker } from './price-tracker';
import { AUTO_DEMOTE_DAYS } from './config';
import { PopularQueryRow, DarkstoreRow, CachedProduct } from './types';
import { IProvider, UnifiedProduct } from '../providers/types';

interface SnapshotTask {
  providerName: string;
  query: string;
  darkstoreId: number;
}

/**
 * Scheduler — handles:
 *   1. Startup pre-warm: search popular queries to fill cache
 *   2. Spread snapshots: price tracking spread evenly across 24h
 *   3. Hourly cleanup: expire old cache entries, demote stale queries
 *
 * No cron library needed — uses setInterval + task queue.
 */
export class Scheduler {
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotQueue: SnapshotTask[] = [];
  private providers = new Map<string, IProvider>();
  private running = false;

  /** Register a provider for background tasks */
  registerProvider(provider: IProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Pre-warm cache on startup: search popular queries on all ready providers.
   * Rate-limited to avoid hitting APIs too hard.
   */
  async preWarm(): Promise<void> {
    const queries = this.getPopularQueries();
    if (queries.length === 0) return;

    const readyProviders = Array.from(this.providers.values()).filter(p => p.isReady());
    if (readyProviders.length === 0) {
      console.log('[Scheduler] No ready providers for pre-warm');
      return;
    }

    console.log(`[Scheduler] Pre-warming ${queries.length} queries across ${readyProviders.length} providers`);

    let warmed = 0;
    for (const query of queries) {
      for (const provider of readyProviders) {
        // Check if already cached (from a recent session)
        const status = provider.getStatus();
        if (!status.storeId || !status.location) continue;

        const locationId = darkstoreTracker.registerLocation(
          status.location.lat, status.location.lon, status.location.label || ''
        );
        const darkstoreId = darkstoreTracker.getDarkstoreId(provider.name, locationId);
        if (!darkstoreId) continue;

        const cached = cacheManager.lookup(provider.name, darkstoreId, query);
        if (cached.hit) continue; // Any cached data (fresh or stale) — stale-while-revalidate handles refresh on first real request

        try {
          const products = await provider.search(query);
          if (products.length > 0) {
            const cachedProducts = products.map(toCache);
            cacheManager.store(provider.name, darkstoreId, query, cachedProducts);
            warmed++;
          }
          // Small delay between requests to be polite
          await sleep(2000);
        } catch (err) {
          // Non-fatal — just skip this query
        }
      }
    }

    console.log(`[Scheduler] Pre-warm complete: ${warmed} cache entries created`);
  }

  /**
   * Start the spread snapshot and hourly cleanup timers.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Build the daily snapshot queue and start processing
    this.rebuildSnapshotQueue();
    this.startSnapshotTimer();

    // Hourly cleanup: expire cache, demote stale queries, clean old price history
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(err =>
        console.error('[Scheduler] Cleanup error:', err)
      );
    }, 60 * 60 * 1000); // Every hour

    console.log('[Scheduler] Started (spread snapshots + hourly cleanup)');
  }

  stop(): void {
    if (this.snapshotTimer) { clearInterval(this.snapshotTimer); this.snapshotTimer = null; }
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    this.running = false;
    console.log('[Scheduler] Stopped');
  }

  // --- Spread snapshot logic ---

  private rebuildSnapshotQueue(): void {
    const queries = this.getPopularQueries();
    const darkstores = darkstoreTracker.getActiveDarkstores();
    if (queries.length === 0 || darkstores.length === 0) {
      this.snapshotQueue = [];
      return;
    }

    // Build tasks: each (provider, query, darkstore) combination
    const tasks: SnapshotTask[] = [];
    for (const query of queries) {
      for (const ds of darkstores) {
        if (this.providers.has(ds.service)) {
          tasks.push({
            providerName: ds.service,
            query,
            darkstoreId: ds.id,
          });
        }
      }
    }

    // Shuffle to avoid always hitting the same service first
    for (let i = tasks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
    }

    this.snapshotQueue = tasks;
    console.log(`[Scheduler] Snapshot queue: ${tasks.length} tasks spread over 24h`);
  }

  private startSnapshotTimer(): void {
    if (this.snapshotQueue.length === 0) {
      // Rebuild queue every hour if empty (darkstores may have been added)
      this.snapshotTimer = setInterval(() => {
        this.rebuildSnapshotQueue();
        if (this.snapshotQueue.length > 0) {
          clearInterval(this.snapshotTimer!);
          this.startSnapshotTimer();
        }
      }, 60 * 60 * 1000);
      return;
    }

    // Calculate interval: spread tasks evenly across 24 hours
    const intervalMs = Math.max(
      (24 * 60 * 60 * 1000) / this.snapshotQueue.length,
      30_000 // Minimum 30s between tasks
    );

    console.log(`[Scheduler] Snapshot interval: ${Math.round(intervalMs / 1000)}s per task`);

    this.snapshotTimer = setInterval(async () => {
      const task = this.snapshotQueue.shift();
      if (!task) {
        // Queue exhausted — rebuild for next cycle
        this.rebuildSnapshotQueue();
        return;
      }

      const provider = this.providers.get(task.providerName);
      if (!provider?.isReady()) return;

      try {
        const products = await provider.search(task.query);
        if (products.length > 0) {
          cacheManager.store(task.providerName, task.darkstoreId, task.query, products.map(toCache));
        }
      } catch {
        // Non-fatal — task will be retried next cycle
      }
    }, intervalMs);
  }

  // --- Cleanup ---

  private async cleanup(): Promise<void> {
    // Expire old cache entries
    const deleted = cacheManager.cleanupExpired();
    if (deleted > 0) console.log(`[Scheduler] Cleaned ${deleted} expired cache entries`);

    // Clean old price history
    const historyDeleted = priceTracker.cleanupOldHistory();
    if (historyDeleted > 0) console.log(`[Scheduler] Cleaned ${historyDeleted} old price history entries`);

    // Demote queries not searched recently
    const db = getDb();
    const cutoff = new Date(Date.now() - AUTO_DEMOTE_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const demoted = db.prepare(
      'UPDATE popular_queries SET is_scheduled = 0 WHERE is_scheduled = 1 AND last_searched_at < ?'
    ).run(cutoff);
    if (demoted.changes > 0) console.log(`[Scheduler] Demoted ${demoted.changes} stale queries`);
  }

  // --- Helpers ---

  private getPopularQueries(): string[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT query_normalized FROM popular_queries WHERE is_scheduled = 1 ORDER BY search_count DESC LIMIT 20'
    ).all() as PopularQueryRow[];
    return rows.map(r => r.query_normalized);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toCache(p: UnifiedProduct): CachedProduct {
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    price: p.priceDisplay,
    originalPrice: p.mrpDisplay,
    savings: null,
    quantity: p.quantity,
    deliveryTime: p.deliveryTime,
    discount: p.discount,
    discountPct: p.discountPct,
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
    available: p.available,
    rating: p.rating,
    totalRatings: p.totalRatings,
    source: p.source,
  };
}

export const scheduler = new Scheduler();
