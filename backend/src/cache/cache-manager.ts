import { getDb } from './database';
import { detectCategory } from './category-detector';
import { parseQuantity, computePerUnitPrice } from '../providers/types';
import { CATEGORY_TTL, STALE_BUFFER_SECONDS, AUTO_PROMOTE_THRESHOLD } from './config';
import {
  Service,
  CachedProduct,
  CacheLookupResult,
  ProductCategory,
  SearchCacheRow,
} from './types';

export class CacheManager {
  /**
   * Normalize a search query for consistent cache keys.
   */
  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Parse a price string like "Rs25", "₹25", "Rs. 149" into paise (integer).
   */
  parsePriceToPaise(priceStr: string): number {
    if (!priceStr) return 0;
    const cleaned = priceStr.replace(/[^\d.]/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return 0;
    return Math.round(num * 100);
  }

  /**
   * Look up cached results for a query.
   */
  lookup(service: Service, darkstoreId: number, query: string): CacheLookupResult {
    const db = getDb();
    const normalized = this.normalizeQuery(query);

    const row = db.prepare(
      `SELECT * FROM search_cache
       WHERE service = ? AND darkstore_id = ? AND query_normalized = ?
       ORDER BY created_at DESC LIMIT 1`
    ).get(service, darkstoreId, normalized) as SearchCacheRow | undefined;

    if (!row) {
      return { hit: false, fresh: false, stale: false, products: [], cacheId: null };
    }

    const now = Date.now();
    const expiresAt = new Date(row.expires_at + 'Z').getTime();
    const staleDeadline = expiresAt + STALE_BUFFER_SECONDS * 1000;

    if (now < expiresAt) {
      // Fresh hit
      return {
        hit: true,
        fresh: true,
        stale: false,
        products: JSON.parse(row.results_json),
        cacheId: row.id,
      };
    }

    if (now < staleDeadline) {
      // Stale but servable
      return {
        hit: true,
        fresh: false,
        stale: true,
        products: JSON.parse(row.results_json),
        cacheId: row.id,
      };
    }

    // Expired beyond stale buffer
    return { hit: false, fresh: false, stale: false, products: [], cacheId: null };
  }

  /**
   * Store search results in cache. Also upserts products, listings, and price history.
   */
  store(
    service: Service,
    darkstoreId: number,
    query: string,
    products: CachedProduct[]
  ): void {
    const db = getDb();
    const normalized = this.normalizeQuery(query);

    // Determine TTL based on the dominant category of results
    const ttlSeconds = this.computeTtl(products);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString().replace('Z', '');

    db.transaction(() => {
      // Upsert search cache
      db.prepare(
        `INSERT INTO search_cache (service, darkstore_id, query_normalized, results_json, product_count, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(service, darkstore_id, query_normalized)
         DO UPDATE SET results_json = excluded.results_json,
                       product_count = excluded.product_count,
                       expires_at = excluded.expires_at,
                       created_at = datetime('now')`
      ).run(service, darkstoreId, normalized, JSON.stringify(products), products.length, expiresAt);

      // Upsert products, listings, and record price changes
      for (const product of products) {
        this.upsertProduct(service, darkstoreId, product);
      }

      // Track query popularity
      this.trackQuery(normalized);
    })();
  }

  /**
   * Upsert a product and its listing. Records price history on change.
   */
  private upsertProduct(service: Service, darkstoreId: number, product: CachedProduct): void {
    const db = getDb();
    const category = detectCategory(product.name);
    const pricePaise = this.parsePriceToPaise(product.price);
    const mrpPaise = product.originalPrice ? this.parsePriceToPaise(product.originalPrice) : null;

    const qty = parseQuantity(product.quantity);
    const perUnitPrice = computePerUnitPrice(pricePaise, qty.value, qty.unit);

    // Upsert product
    db.prepare(
      `INSERT INTO products (service, external_id, name, category, quantity, image_url, brand, quantity_value, quantity_unit, product_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(service, external_id)
       DO UPDATE SET name = excluded.name, category = excluded.category,
                     quantity = excluded.quantity, image_url = excluded.image_url,
                     brand = excluded.brand, quantity_value = excluded.quantity_value,
                     quantity_unit = excluded.quantity_unit, product_url = excluded.product_url,
                     updated_at = datetime('now')`
    ).run(service, product.id, product.name, category, product.quantity, product.imageUrl,
          product.brand || null, qty.value, qty.unit, product.productUrl || null);

    // Get product ID
    const productRow = db.prepare(
      'SELECT id FROM products WHERE service = ? AND external_id = ?'
    ).get(service, product.id) as { id: number };

    const productId = productRow.id;

    // Check current listing price to detect changes
    const existingListing = db.prepare(
      'SELECT price_paise FROM product_listings WHERE product_id = ? AND darkstore_id = ?'
    ).get(productId, darkstoreId) as { price_paise: number } | undefined;

    // Upsert listing
    db.prepare(
      `INSERT INTO product_listings (product_id, darkstore_id, price_paise, mrp_paise, available, discount_label, delivery_time, discount_pct, per_unit_price_paise)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id, darkstore_id)
       DO UPDATE SET price_paise = excluded.price_paise, mrp_paise = excluded.mrp_paise,
                     available = excluded.available, discount_label = excluded.discount_label,
                     delivery_time = excluded.delivery_time, discount_pct = excluded.discount_pct,
                     per_unit_price_paise = excluded.per_unit_price_paise, updated_at = datetime('now')`
    ).run(
      productId, darkstoreId, pricePaise, mrpPaise,
      product.available ? 1 : 0, product.discount, product.deliveryTime,
      product.discountPct || null, perUnitPrice
    );

    // Record price history only if price changed
    if (!existingListing || existingListing.price_paise !== pricePaise) {
      db.prepare(
        'INSERT INTO price_history (product_id, darkstore_id, price_paise, mrp_paise) VALUES (?, ?, ?, ?)'
      ).run(productId, darkstoreId, pricePaise, mrpPaise);
    }
  }

  /**
   * Track a query's popularity for auto-promotion.
   */
  private trackQuery(normalized: string): void {
    const db = getDb();

    db.prepare(
      `INSERT INTO popular_queries (query_normalized, search_count, last_searched_at)
       VALUES (?, 1, datetime('now'))
       ON CONFLICT(query_normalized)
       DO UPDATE SET search_count = search_count + 1,
                     last_searched_at = datetime('now')`
    ).run(normalized);

    // Auto-promote if threshold met
    db.prepare(
      `UPDATE popular_queries SET is_scheduled = 1
       WHERE query_normalized = ? AND search_count >= ? AND is_scheduled = 0`
    ).run(normalized, AUTO_PROMOTE_THRESHOLD);
  }

  /**
   * Compute TTL based on the dominant product category in results.
   */
  private computeTtl(products: CachedProduct[]): number {
    if (products.length === 0) return CATEGORY_TTL.other;

    const categoryCounts: Record<ProductCategory, number> = {
      perishable: 0, staple: 0, non_food: 0, other: 0,
    };

    for (const p of products) {
      const cat = detectCategory(p.name);
      categoryCounts[cat]++;
    }

    // Use the shortest TTL among categories that have products
    let minTtl = CATEGORY_TTL.non_food; // start with longest
    for (const [cat, count] of Object.entries(categoryCounts)) {
      if (count > 0) {
        const ttl = CATEGORY_TTL[cat as ProductCategory];
        if (ttl < minTtl) minTtl = ttl;
      }
    }

    return minTtl;
  }

  /**
   * Delete all expired cache entries (beyond stale buffer).
   */
  cleanupExpired(): number {
    const db = getDb();
    const staleDeadline = new Date(Date.now() - STALE_BUFFER_SECONDS * 1000).toISOString();
    const result = db.prepare(
      'DELETE FROM search_cache WHERE expires_at < ?'
    ).run(staleDeadline);
    return result.changes;
  }

  /**
   * Get cache stats for monitoring.
   */
  getStats(): {
    totalEntries: number;
    freshEntries: number;
    staleEntries: number;
    totalProducts: number;
    totalListings: number;
    priceHistoryCount: number;
  } {
    const db = getDb();
    const now = new Date().toISOString();

    const total = (db.prepare('SELECT COUNT(*) as c FROM search_cache').get() as { c: number }).c;
    const fresh = (db.prepare('SELECT COUNT(*) as c FROM search_cache WHERE expires_at > ?').get(now) as { c: number }).c;
    const totalProducts = (db.prepare('SELECT COUNT(*) as c FROM products').get() as { c: number }).c;
    const totalListings = (db.prepare('SELECT COUNT(*) as c FROM product_listings').get() as { c: number }).c;
    const priceHistoryCount = (db.prepare('SELECT COUNT(*) as c FROM price_history').get() as { c: number }).c;

    return {
      totalEntries: total,
      freshEntries: fresh,
      staleEntries: total - fresh,
      totalProducts,
      totalListings,
      priceHistoryCount,
    };
  }
}

export const cacheManager = new CacheManager();
