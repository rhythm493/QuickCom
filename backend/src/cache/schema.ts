export const SCHEMA_VERSION = 2;

export const CREATE_TABLES = `
-- Locations tracked for multi-location support
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  city TEXT,
  pincode TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Darkstores (one per service per location)
CREATE TABLE IF NOT EXISTS darkstores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL CHECK(length(service) > 0),
  store_id TEXT NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(service, store_id)
);

-- Products (deduplicated by service + external_id)
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL CHECK(length(service) > 0),
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('perishable', 'staple', 'non_food', 'other')),
  quantity TEXT,
  image_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(service, external_id)
);

-- Product listings (price per product per darkstore)
CREATE TABLE IF NOT EXISTS product_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  darkstore_id INTEGER NOT NULL REFERENCES darkstores(id),
  price_paise INTEGER NOT NULL,
  mrp_paise INTEGER,
  available INTEGER NOT NULL DEFAULT 1,
  discount_label TEXT,
  delivery_time TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, darkstore_id)
);

-- Price history (only records when price changes, plus daily snapshots)
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  darkstore_id INTEGER NOT NULL REFERENCES darkstores(id),
  price_paise INTEGER NOT NULL,
  mrp_paise INTEGER,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Search cache (full result JSON per query per darkstore)
CREATE TABLE IF NOT EXISTS search_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT NOT NULL CHECK(length(service) > 0),
  darkstore_id INTEGER NOT NULL REFERENCES darkstores(id),
  query_normalized TEXT NOT NULL,
  results_json TEXT NOT NULL,
  product_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  UNIQUE(service, darkstore_id, query_normalized)
);

-- Popular queries (for scheduled background refresh)
CREATE TABLE IF NOT EXISTS popular_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_normalized TEXT NOT NULL UNIQUE,
  search_count INTEGER NOT NULL DEFAULT 0,
  is_scheduled INTEGER NOT NULL DEFAULT 0,
  last_searched_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Refresh jobs (tracks background refresh state)
CREATE TABLE IF NOT EXISTS refresh_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL CHECK(job_type IN ('popular_refresh', 'cache_cleanup', 'price_snapshot', 'darkstore_verify')),
  service TEXT CHECK(length(service) > 0),
  query TEXT,
  darkstore_id INTEGER REFERENCES darkstores(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_darkstores_service_location ON darkstores(service, location_id);
CREATE INDEX IF NOT EXISTS idx_darkstores_active ON darkstores(is_active);
CREATE INDEX IF NOT EXISTS idx_products_service_external ON products(service, external_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_product_listings_product ON product_listings(product_id);
CREATE INDEX IF NOT EXISTS idx_product_listings_darkstore ON product_listings(darkstore_id);
CREATE INDEX IF NOT EXISTS idx_price_history_product_darkstore ON price_history(product_id, darkstore_id);
CREATE INDEX IF NOT EXISTS idx_price_history_recorded ON price_history(recorded_at);
CREATE INDEX IF NOT EXISTS idx_search_cache_lookup ON search_cache(service, darkstore_id, query_normalized);
CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON search_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_popular_queries_scheduled ON popular_queries(is_scheduled);
CREATE INDEX IF NOT EXISTS idx_popular_queries_count ON popular_queries(search_count DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_jobs_status ON refresh_jobs(status);
`;
