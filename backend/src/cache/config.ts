import { ProductCategory } from './types';

// TTL values in seconds per product category
// Grocery prices rarely change — promos are weekly, MRP is quarterly.
// Availability shifts a few times/day. These TTLs reflect reality.
export const CATEGORY_TTL: Record<ProductCategory, number> = {
  perishable: 6 * 60 * 60,    // 6 hours — milk price doesn't change hourly
  staple: 24 * 60 * 60,       // 24 hours — rice/oil prices are very stable
  non_food: 48 * 60 * 60,     // 48 hours — soap/detergent prices change monthly
  other: 12 * 60 * 60,        // 12 hours — safe default
};

// Stale-while-revalidate buffer (seconds past TTL where stale results are still served)
// With longer TTLs, a longer buffer is fine — user gets instant stale response
// while fresh data loads in background
export const STALE_BUFFER_SECONDS = 60 * 60; // 1 hour

// Rate limits (requests per minute per service)
export const RATE_LIMITS: Record<string, number> = {
  blinkit: 20,
  zepto: 10,
  instamart: 10,
};

// Max concurrent background refreshes per service
export const MAX_CONCURRENT_REFRESHES = 3;

// Auto-promotion thresholds
export const AUTO_PROMOTE_THRESHOLD = 5;   // searches to auto-schedule for snapshots
export const AUTO_DEMOTE_DAYS = 14;        // days without search to demote

// Price history retention (days)
export const PRICE_HISTORY_RETENTION_DAYS = 90;

// Database path (relative to backend/)
export const DB_PATH = 'data/quickcom.db';

// Default popular queries seeded on first run (~50 items)
// Covers a typical Indian household's weekly grocery categories
export const DEFAULT_POPULAR_QUERIES = [
  // Dairy
  'milk', 'curd', 'paneer', 'butter', 'cheese', 'ghee', 'cream', 'lassi',
  // Staples
  'rice', 'atta', 'dal', 'sugar', 'salt', 'oil', 'besan', 'maida', 'sooji', 'poha',
  // Vegetables
  'onion', 'tomato', 'potato', 'capsicum', 'carrot', 'cucumber', 'cabbage', 'beans',
  // Fruits
  'banana', 'apple', 'grapes', 'orange', 'papaya',
  // Proteins
  'eggs', 'chicken', 'soya chunks', 'peanuts',
  // Beverages
  'tea', 'coffee', 'water', 'juice', 'coconut water',
  // Bakery & snacks
  'bread', 'biscuit', 'chips', 'namkeen', 'maggi',
  // Cleaning
  'detergent', 'dishwash', 'floor cleaner',
  // Personal care
  'soap', 'shampoo', 'toothpaste', 'tissue',
];
