/** Delivery location with coordinates */
export interface Location {
  lat: number;
  lon: number;
  label?: string;
}

/** Normalized product — all providers produce this exact shape */
export interface UnifiedProduct {
  id: string;
  name: string;
  brand: string | null;
  /** Price in paise (integer). ALL providers normalize to paise. */
  pricePaise: number;
  /** Display price, e.g. "₹149.00" */
  priceDisplay: string;
  /** MRP in paise, null if same as price */
  mrpPaise: number | null;
  mrpDisplay: string | null;
  quantity: string;
  /** Parsed numeric quantity (e.g. 500 from "500 ml") */
  quantityValue: number | null;
  /** Parsed unit (e.g. "ml", "kg", "pcs") */
  quantityUnit: string | null;
  /** Per-unit price in paise, normalized to per-kg or per-L for comparison */
  perUnitPricePaise: number | null;
  deliveryTime: string;
  discount: string | null;
  /** Numeric discount percentage (e.g. 25 for 25% OFF) */
  discountPct: number | null;
  imageUrl: string;
  /** Best-effort deep link for "open in app/browser" */
  productUrl: string | null;
  available: boolean;
  rating?: number;
  totalRatings?: number;
  /** Provider name (e.g. "blinkit", "zepto") */
  source: string;
}

/** Status of a provider */
export interface ProviderStatus {
  name: string;
  initialized: boolean;
  /** Whether init is currently in progress */
  initializing: boolean;
  sessionValid: boolean;
  sessionExpiresAt: string | null;
  location: Location | null;
  storeId: string | null;
  needsPuppeteer: boolean;
  error: string | null;
}

/** Search result from a single provider */
export interface SearchResult {
  products: UnifiedProduct[];
  totalFound: number;
  searchTimeMs: number;
  cached: boolean;
  stale: boolean;
}

/** Aggregated search result across providers */
export interface AggregatedSearchResult {
  results: Record<string, SearchResult>;
  searchTimeMs: number;
}

/** Session info returned by session manager */
export interface SessionInfo {
  exists: boolean;
  savedAt?: string;
  expiresAt?: string;
  isExpired?: boolean;
}

/** Provider interface — every grocery service implements this */
export interface IProvider {
  /** Provider name (e.g. "blinkit") */
  readonly name: string;

  /** Whether this provider requires a persistent Puppeteer page for search */
  readonly needsPuppeteerForSearch: boolean;

  /** Initialize: try saved session first, then Puppeteer if needed */
  initialize(): Promise<void>;

  /** Set delivery location. Provider resolves store IDs internally. */
  setLocation(location: Location): Promise<void>;

  /** Search for products. Returns normalized UnifiedProduct[]. */
  search(query: string): Promise<UnifiedProduct[]>;

  /** Check if provider is ready to accept searches */
  isReady(): boolean;

  /** Get current provider status */
  getStatus(): ProviderStatus;

  /** Clean up resources (close pages, sessions, etc.) */
  teardown(): Promise<void>;
}

/** Format paise to display price string */
export function formatPrice(paise: number): string {
  const rupees = paise / 100;
  if (rupees === Math.floor(rupees)) {
    return `₹${rupees}`;
  }
  return `₹${rupees.toFixed(2)}`;
}

/** Parse a price string like "₹149" or "₹149.00" or "Rs149" to paise */
export function parsePriceToPaise(priceStr: string): number {
  const cleaned = priceStr.replace(/[₹Rs,\s]/gi, '');
  const val = parseFloat(cleaned);
  if (isNaN(val)) return 0;
  return Math.round(val * 100);
}

/** Parse quantity text into numeric value + unit */
export function parseQuantity(text: string): { value: number | null; unit: string | null } {
  if (!text) return { value: null, unit: null };
  const s = text.toLowerCase().trim();

  // Handle "2 x 200 ml" → 400 ml
  const multiMatch = s.match(/^(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|g|gm|kg|l|ltr|litre|liter|pcs?|pieces?|units?)/i);
  if (multiMatch) {
    const count = parseFloat(multiMatch[1]);
    const each = parseFloat(multiMatch[2]);
    const unit = normalizeUnit(multiMatch[3]);
    return { value: count * each, unit };
  }

  // Handle "500 ml", "1 kg", "1 ltr", "6 pcs", "12 Pieces", "250g"
  const match = s.match(/(\d+(?:\.\d+)?)\s*(ml|g|gm|kg|l|ltr|litre|liter|pcs?|pieces?|units?|pack|pouch)/i);
  if (match) {
    return { value: parseFloat(match[1]), unit: normalizeUnit(match[2]) };
  }

  return { value: null, unit: null };
}

function normalizeUnit(raw: string): string {
  const u = raw.toLowerCase();
  if (u === 'ltr' || u === 'litre' || u === 'liter' || u === 'l') return 'L';
  if (u === 'gm' || u === 'g') return 'g';
  if (u === 'kg') return 'kg';
  if (u === 'ml') return 'ml';
  if (u.startsWith('pc') || u.startsWith('piece') || u.startsWith('unit')) return 'pcs';
  return u;
}

/** Compute per-unit price in paise, normalized to per-kg or per-L */
export function computePerUnitPrice(pricePaise: number, qtyValue: number | null, qtyUnit: string | null): number | null {
  if (!qtyValue || !qtyUnit || qtyValue <= 0) return null;

  switch (qtyUnit) {
    case 'g':   return Math.round((pricePaise / qtyValue) * 1000);  // per kg
    case 'kg':  return Math.round(pricePaise / qtyValue);            // per kg
    case 'ml':  return Math.round((pricePaise / qtyValue) * 1000);  // per L
    case 'L':   return Math.round(pricePaise / qtyValue);            // per L
    case 'pcs': return Math.round(pricePaise / qtyValue);            // per piece
    default:    return null;
  }
}
