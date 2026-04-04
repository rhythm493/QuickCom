import { IProvider, AggregatedSearchResult, Location, SearchResult } from './types';

/**
 * Provider registry — manages all registered grocery service providers.
 * Extensible: register any IProvider implementation.
 */
export class ProviderRegistry {
  private providers = new Map<string, IProvider>();

  register(provider: IProvider): void {
    this.providers.set(provider.name, provider);
    console.log(`[Registry] Registered provider: ${provider.name}`);
  }

  get(name: string): IProvider | undefined {
    return this.providers.get(name);
  }

  getAll(): IProvider[] {
    return Array.from(this.providers.values());
  }

  getNames(): string[] {
    return Array.from(this.providers.keys());
  }

  getReady(): IProvider[] {
    return this.getAll().filter(p => p.isReady());
  }

  /** Initialize all providers in parallel (background init) */
  async initializeAll(): Promise<void> {
    const promises = this.getAll().map(async provider => {
      try {
        await provider.initialize();
      } catch (err) {
        console.error(`[Registry] Failed to initialize ${provider.name}:`, err);
      }
    });
    await Promise.allSettled(promises);
  }

  /** Set location on all (or specified) providers in parallel */
  async setLocationAll(
    location: Location,
    providerNames?: string[]
  ): Promise<Record<string, { success: boolean; error?: string }>> {
    const targets = providerNames
      ? providerNames.map(n => this.get(n)).filter((p): p is IProvider => !!p)
      : this.getAll();

    const results: Record<string, { success: boolean; error?: string }> = {};

    await Promise.allSettled(
      targets.map(async provider => {
        try {
          await provider.setLocation(location);
          results[provider.name] = { success: true };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results[provider.name] = { success: false, error: msg };
        }
      })
    );

    return results;
  }

  /** Search across all (or specified) providers in parallel */
  async searchAll(
    query: string,
    providerNames?: string[],
    limit = 20
  ): Promise<AggregatedSearchResult> {
    const targets = providerNames
      ? providerNames.map(n => this.get(n)).filter((p): p is IProvider => p?.isReady() ?? false)
      : this.getReady();

    const wallStart = Date.now();
    const results: Record<string, SearchResult> = {};

    await Promise.allSettled(
      targets.map(async provider => {
        const start = Date.now();
        try {
          const products = await provider.search(query);
          results[provider.name] = {
            products: products.slice(0, limit),
            totalFound: products.length,
            searchTimeMs: Date.now() - start,
            cached: false,
            stale: false,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Registry] Search failed for ${provider.name}:`, msg);
          results[provider.name] = {
            products: [],
            totalFound: 0,
            searchTimeMs: Date.now() - start,
            cached: false,
            stale: false,
          };
        }
      })
    );

    return {
      results,
      searchTimeMs: Date.now() - wallStart,
    };
  }

  /** Tear down all providers */
  async teardownAll(): Promise<void> {
    await Promise.allSettled(
      this.getAll().map(p => p.teardown())
    );
  }
}
