/** Extensible — any provider name is valid */
export type Service = string;

export type ProductCategory = 'perishable' | 'staple' | 'non_food' | 'other';

export type RefreshJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type RefreshJobType = 'popular_refresh' | 'cache_cleanup' | 'price_snapshot' | 'darkstore_verify';

// ---------- Database row types ----------

export interface LocationRow {
  id: number;
  lat: number;
  lon: number;
  label: string;
  city: string | null;
  pincode: string | null;
  created_at: string;
}

export interface DarkstoreRow {
  id: number;
  service: Service;
  store_id: string;
  location_id: number;
  is_active: number; // SQLite boolean
  metadata_json: string | null;
  last_verified_at: string | null;
  created_at: string;
}

export interface ProductRow {
  id: number;
  service: Service;
  external_id: string;
  name: string;
  category: ProductCategory;
  quantity: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductListingRow {
  id: number;
  product_id: number;
  darkstore_id: number;
  price_paise: number;
  mrp_paise: number | null;
  available: number; // SQLite boolean
  discount_label: string | null;
  delivery_time: string | null;
  updated_at: string;
}

export interface PriceHistoryRow {
  id: number;
  product_id: number;
  darkstore_id: number;
  price_paise: number;
  mrp_paise: number | null;
  recorded_at: string;
}

export interface SearchCacheRow {
  id: number;
  service: Service;
  darkstore_id: number;
  query_normalized: string;
  results_json: string;
  product_count: number;
  created_at: string;
  expires_at: string;
}

export interface PopularQueryRow {
  id: number;
  query_normalized: string;
  search_count: number;
  is_scheduled: number; // SQLite boolean
  last_searched_at: string;
  created_at: string;
}

export interface RefreshJobRow {
  id: number;
  job_type: RefreshJobType;
  service: Service | null;
  query: string | null;
  darkstore_id: number | null;
  status: RefreshJobStatus;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ---------- Cache lookup result ----------

export interface CacheLookupResult {
  hit: boolean;
  fresh: boolean;
  stale: boolean;
  products: CachedProduct[];
  cacheId: number | null;
}

// ---------- Product as stored/returned from cache ----------

export interface CachedProduct {
  id: string;
  name: string;
  brand: string | null;
  price: string;
  originalPrice: string | null;
  savings: string | null;
  quantity: string;
  deliveryTime: string;
  discount: string | null;
  discountPct: number | null;
  imageUrl: string;
  productUrl: string | null;
  available: boolean;
  rating?: number;
  totalRatings?: number;
  source: Service;
}

// ---------- Price history query result ----------

export interface PricePoint {
  price_paise: number;
  mrp_paise: number | null;
  recorded_at: string;
}

export interface BestPriceResult {
  service: Service;
  product_name: string;
  price_paise: number;
  price_display: string;
  darkstore_id: number;
}
