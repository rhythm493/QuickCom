import { getDb } from './database';
import { Service, LocationRow, DarkstoreRow } from './types';

export class DarkstoreTracker {
  /**
   * Register a location. Returns the location ID (existing or new).
   * Matches by lat/lon rounded to ~100m precision.
   */
  registerLocation(lat: number, lon: number, label: string = ''): number {
    const db = getDb();

    // Round to 4 decimal places (~11m precision, good enough for darkstore matching)
    const rLat = Math.round(lat * 10000) / 10000;
    const rLon = Math.round(lon * 10000) / 10000;

    const existing = db.prepare(
      'SELECT id FROM locations WHERE ROUND(lat, 4) = ? AND ROUND(lon, 4) = ?'
    ).get(rLat, rLon) as { id: number } | undefined;

    if (existing) return existing.id;

    const result = db.prepare(
      'INSERT INTO locations (lat, lon, label) VALUES (?, ?, ?)'
    ).run(rLat, rLon, label);

    console.log(`[DarkstoreTracker] Registered location: ${label} (${rLat}, ${rLon}) -> id=${result.lastInsertRowid}`);
    return result.lastInsertRowid as number;
  }

  /**
   * Register a darkstore for a service at a location. Returns the darkstore ID.
   */
  registerDarkstore(
    service: Service,
    storeId: string,
    locationId: number,
    metadata?: Record<string, unknown>
  ): number {
    const db = getDb();

    const existing = db.prepare(
      'SELECT id FROM darkstores WHERE service = ? AND store_id = ?'
    ).get(service, storeId) as { id: number } | undefined;

    if (existing) {
      // Update location and metadata if changed
      db.prepare(
        `UPDATE darkstores SET location_id = ?, is_active = 1, metadata_json = ?,
         last_verified_at = datetime('now') WHERE id = ?`
      ).run(locationId, metadata ? JSON.stringify(metadata) : null, existing.id);
      return existing.id;
    }

    const result = db.prepare(
      `INSERT INTO darkstores (service, store_id, location_id, metadata_json, last_verified_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(service, storeId, locationId, metadata ? JSON.stringify(metadata) : null);

    console.log(`[DarkstoreTracker] Registered darkstore: ${service}/${storeId} -> id=${result.lastInsertRowid}`);
    return result.lastInsertRowid as number;
  }

  /**
   * Get darkstore ID for a service at a location.
   */
  getDarkstoreId(service: Service, locationId: number): number | null {
    const db = getDb();
    const row = db.prepare(
      'SELECT id FROM darkstores WHERE service = ? AND location_id = ? AND is_active = 1'
    ).get(service, locationId) as { id: number } | undefined;

    return row ? row.id : null;
  }

  /**
   * Get all active darkstores, optionally filtered by location.
   */
  getActiveDarkstores(locationId?: number): DarkstoreRow[] {
    const db = getDb();

    if (locationId !== undefined) {
      return db.prepare(
        'SELECT * FROM darkstores WHERE location_id = ? AND is_active = 1'
      ).all(locationId) as DarkstoreRow[];
    }

    return db.prepare(
      'SELECT * FROM darkstores WHERE is_active = 1'
    ).all() as DarkstoreRow[];
  }

  /**
   * Mark a darkstore as inactive (failed verification).
   */
  markInactive(darkstoreId: number): void {
    const db = getDb();
    db.prepare('UPDATE darkstores SET is_active = 0 WHERE id = ?').run(darkstoreId);
  }

  /**
   * Mark a darkstore as verified (successful test search).
   */
  markVerified(darkstoreId: number): void {
    const db = getDb();
    db.prepare(
      "UPDATE darkstores SET last_verified_at = datetime('now'), is_active = 1 WHERE id = ?"
    ).run(darkstoreId);
  }

  /**
   * Get all registered locations.
   */
  getLocations(): LocationRow[] {
    const db = getDb();
    return db.prepare('SELECT * FROM locations ORDER BY created_at DESC').all() as LocationRow[];
  }

  /**
   * Get all darkstores for a given city (matches label LIKE '%city%').
   */
  getDarkstoresByCity(city: string): (DarkstoreRow & { lat: number; lon: number; label: string })[] {
    const db = getDb();
    return db.prepare(
      `SELECT d.*, l.lat, l.lon, l.label
       FROM darkstores d
       JOIN locations l ON d.location_id = l.id
       WHERE l.label LIKE ?
       ORDER BY d.service, d.created_at DESC`
    ).all(`%${city}%`) as (DarkstoreRow & { lat: number; lon: number; label: string })[];
  }

  /**
   * Get summary statistics for all darkstores.
   */
  getDarkstoreStats(): { total: number; byService: Record<string, number>; byCity: Record<string, number> } {
    const db = getDb();

    const total = (db.prepare('SELECT COUNT(*) as count FROM darkstores').get() as { count: number }).count;

    const byServiceRows = db.prepare(
      'SELECT service, COUNT(*) as count FROM darkstores GROUP BY service'
    ).all() as { service: string; count: number }[];
    const byService: Record<string, number> = {};
    for (const row of byServiceRows) {
      byService[row.service] = row.count;
    }

    // Extract city from location labels (assumes "Neighborhood, City" format)
    const byCityRows = db.prepare(
      `SELECT
         CASE
           WHEN INSTR(l.label, ', ') > 0 THEN SUBSTR(l.label, INSTR(l.label, ', ') + 2)
           ELSE l.label
         END as city,
         COUNT(DISTINCT d.id) as count
       FROM darkstores d
       JOIN locations l ON d.location_id = l.id
       GROUP BY city`
    ).all() as { city: string; count: number }[];
    const byCity: Record<string, number> = {};
    for (const row of byCityRows) {
      if (row.city) byCity[row.city] = row.count;
    }

    return { total, byService, byCity };
  }

  /**
   * Get all darkstores with their location data.
   */
  getAllDarkstoresWithLocation(): (DarkstoreRow & { lat: number; lon: number; label: string })[] {
    const db = getDb();
    return db.prepare(
      `SELECT d.*, l.lat, l.lon, l.label
       FROM darkstores d
       JOIN locations l ON d.location_id = l.id
       ORDER BY d.service, d.created_at DESC`
    ).all() as (DarkstoreRow & { lat: number; lon: number; label: string })[];
  }
}

export const darkstoreTracker = new DarkstoreTracker();
