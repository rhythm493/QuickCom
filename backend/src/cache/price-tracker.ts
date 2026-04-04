import { getDb } from './database';
import { Service, PricePoint, BestPriceResult } from './types';
import { PRICE_HISTORY_RETENTION_DAYS } from './config';

export class PriceTracker {
  /**
   * Get price history for a product at a specific darkstore.
   */
  getHistory(service: Service, externalProductId: string, days: number = 30): PricePoint[] {
    const db = getDb();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    return db.prepare(
      `SELECT ph.price_paise, ph.mrp_paise, ph.recorded_at
       FROM price_history ph
       JOIN products p ON ph.product_id = p.id
       WHERE p.service = ? AND p.external_id = ? AND ph.recorded_at >= ?
       ORDER BY ph.recorded_at ASC`
    ).all(service, externalProductId, since) as PricePoint[];
  }

  /**
   * Find the best (lowest) current price for a product name across all services at a location.
   */
  getBestPrice(query: string, locationId: number): BestPriceResult[] {
    const db = getDb();
    const pattern = `%${query.toLowerCase()}%`;

    return db.prepare(
      `SELECT p.service, p.name as product_name, pl.price_paise, d.id as darkstore_id,
              ('Rs' || CAST(pl.price_paise / 100.0 AS TEXT)) as price_display
       FROM product_listings pl
       JOIN products p ON pl.product_id = p.id
       JOIN darkstores d ON pl.darkstore_id = d.id
       WHERE d.location_id = ? AND d.is_active = 1
         AND pl.available = 1
         AND LOWER(p.name) LIKE ?
       ORDER BY pl.price_paise ASC
       LIMIT 20`
    ).all(locationId, pattern) as BestPriceResult[];
  }

  /**
   * Record a daily price snapshot for all active listings.
   * Only inserts if no snapshot exists today for that product/darkstore.
   */
  takeDailySnapshot(): number {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const result = db.prepare(
      `INSERT INTO price_history (product_id, darkstore_id, price_paise, mrp_paise)
       SELECT pl.product_id, pl.darkstore_id, pl.price_paise, pl.mrp_paise
       FROM product_listings pl
       JOIN darkstores d ON pl.darkstore_id = d.id
       WHERE d.is_active = 1
         AND NOT EXISTS (
           SELECT 1 FROM price_history ph
           WHERE ph.product_id = pl.product_id
             AND ph.darkstore_id = pl.darkstore_id
             AND date(ph.recorded_at) = ?
         )`
    ).run(today);

    return result.changes;
  }

  /**
   * Clean up old price history entries beyond retention period.
   */
  cleanupOldHistory(): number {
    const db = getDb();
    const cutoff = new Date(
      Date.now() - PRICE_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = db.prepare(
      'DELETE FROM price_history WHERE recorded_at < ?'
    ).run(cutoff);

    return result.changes;
  }

  /**
   * Get price history for a product by product DB ID and darkstore ID.
   */
  getHistoryById(productId: number, darkstoreId: number, days: number = 30): PricePoint[] {
    const db = getDb();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    return db.prepare(
      `SELECT price_paise, mrp_paise, recorded_at
       FROM price_history
       WHERE product_id = ? AND darkstore_id = ? AND recorded_at >= ?
       ORDER BY recorded_at ASC`
    ).all(productId, darkstoreId, since) as PricePoint[];
  }
}

export const priceTracker = new PriceTracker();
