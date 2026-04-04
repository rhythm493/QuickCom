import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SCHEMA_VERSION, CREATE_TABLES, CREATE_INDEXES } from './schema';
import { DB_PATH, DEFAULT_POPULAR_QUERIES } from './config';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  // __dirname at runtime is dist/src/cache/, go up three levels to reach backend/
  const dbFullPath = path.resolve(__dirname, '..', '..', '..', DB_PATH);
  const dbDir = path.dirname(dbFullPath);

  // Ensure data directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbFullPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Run migrations
  migrate(db);

  return db;
}

function migrate(database: Database.Database): void {
  const currentVersion = database.pragma('user_version', { simple: true }) as number;

  if (currentVersion < SCHEMA_VERSION) {
    console.log(`[Cache DB] Migrating from version ${currentVersion} to ${SCHEMA_VERSION}`);

    database.transaction(() => {
      // Version 0 -> 1: Initial schema
      if (currentVersion < 1) {
        database.exec(CREATE_TABLES);
        database.exec(CREATE_INDEXES);
        seedPopularQueries(database);
      }

      // Version 1 -> 2: Add brand, quantity parsing, discount %, product URL, per-unit price
      if (currentVersion < 2) {
        const alterStatements = [
          'ALTER TABLE products ADD COLUMN brand TEXT',
          'ALTER TABLE products ADD COLUMN quantity_value REAL',
          'ALTER TABLE products ADD COLUMN quantity_unit TEXT',
          'ALTER TABLE products ADD COLUMN product_url TEXT',
          'ALTER TABLE product_listings ADD COLUMN discount_pct INTEGER',
          'ALTER TABLE product_listings ADD COLUMN per_unit_price_paise INTEGER',
        ];
        for (const sql of alterStatements) {
          try { database.exec(sql); } catch { /* column may already exist */ }
        }
        console.log('[Cache DB] v2: Added brand, quantity_value/unit, product_url, discount_pct, per_unit_price_paise');
      }

      database.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();

    console.log(`[Cache DB] Migration complete (version ${SCHEMA_VERSION})`);
  }
}

function seedPopularQueries(database: Database.Database): void {
  const insert = database.prepare(
    'INSERT OR IGNORE INTO popular_queries (query_normalized, search_count, is_scheduled) VALUES (?, 0, 1)'
  );

  const insertMany = database.transaction((queries: string[]) => {
    for (const q of queries) {
      insert.run(q);
    }
  });

  insertMany(DEFAULT_POPULAR_QUERIES);
  console.log(`[Cache DB] Seeded ${DEFAULT_POPULAR_QUERIES.length} popular queries`);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[Cache DB] Database closed');
  }
}
