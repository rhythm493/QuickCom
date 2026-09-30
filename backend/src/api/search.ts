import { Router, Request, Response } from 'express';
import { ProviderRegistry } from '../providers/registry';
import { UnifiedProduct, SearchResult, parsePriceToPaise, parseQuantity, computePerUnitPrice, formatPrice } from '../providers/types';
import { cacheManager } from '../cache/cache-manager';
import { darkstoreTracker } from '../cache/darkstore-tracker';

export function createSearchRouter(registry: ProviderRegistry): Router {
  const router = Router();

  /**
   * POST /api/search
   * Body: { query: string, providers?: string[], limit?: number }
   *
   * Flow: cache lookup → serve if fresh → live search on miss → store in cache
   */
  router.post('/', async (req: Request, res: Response) => {
    const { query, providers: providerNames, limit = 20 } = req.body;

    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const trimmedQuery = query.trim();
    const wallStart = Date.now();
    const targets = providerNames
      ? providerNames.filter((n: string) => registry.get(n)?.isReady())
      : registry.getReady().map(p => p.name);

    const results: Record<string, SearchResult> = {};

    await Promise.allSettled(
      targets.map(async (providerName: string) => {
        const start = Date.now();
        const provider = registry.get(providerName);
        if (!provider) return;

        const status = provider.getStatus();

        // Try cache first
        if (status.storeId) {
          try {
            const loc = status.location;
            if (loc) {
              const locationId = darkstoreTracker.registerLocation(loc.lat, loc.lon, loc.label || '');
              const darkstoreId = darkstoreTracker.getDarkstoreId(providerName, locationId)
                ?? darkstoreTracker.registerDarkstore(providerName, status.storeId, locationId);

              const cached = cacheManager.lookup(providerName, darkstoreId, trimmedQuery);

              if (cached.hit && cached.fresh) {
                results[providerName] = {
                  products: cached.products.slice(0, limit).map(toUnifiedProduct),
                  totalFound: cached.products.length,
                  searchTimeMs: Date.now() - start,
                  cached: true,
                  stale: false,
                };
                return;
              }

              if (cached.hit && cached.stale) {
                // Serve stale, refresh in background
                results[providerName] = {
                  products: cached.products.slice(0, limit).map(toUnifiedProduct),
                  totalFound: cached.products.length,
                  searchTimeMs: Date.now() - start,
                  cached: true,
                  stale: true,
                };

                // Background refresh (fire-and-forget)
                provider.search(trimmedQuery).then(products => {
                  if (products.length > 0) {
                    const cachedProducts = products.map(toCachedProduct);
                    try { cacheManager.store(providerName, darkstoreId, trimmedQuery, cachedProducts); } catch { /* ignore */ }
                  }
                }).catch(() => {});

                return;
              }
            }
          } catch (cacheErr) {
            // Cache error is non-fatal, fall through to live search
            console.error(`[Search] Cache error for ${providerName}:`, cacheErr);
          }
        }

        // Cache miss — live search
        try {
          const products = await provider.search(trimmedQuery);
          results[providerName] = {
            products: products.slice(0, limit),
            totalFound: products.length,
            searchTimeMs: Date.now() - start,
            cached: false,
            stale: false,
          };

          // Store in cache (fire-and-forget)
          if (products.length > 0 && status.storeId && status.location) {
            try {
              const locationId = darkstoreTracker.registerLocation(
                status.location.lat, status.location.lon, status.location.label || ''
              );
              const darkstoreId = darkstoreTracker.getDarkstoreId(providerName, locationId)
                ?? darkstoreTracker.registerDarkstore(providerName, status.storeId, locationId);

              const cachedProducts = products.map(toCachedProduct);
              cacheManager.store(providerName, darkstoreId, trimmedQuery, cachedProducts);
            } catch { /* cache store is best-effort */ }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Search] Live search failed for ${providerName}:`, msg);
          results[providerName] = {
            products: [],
            totalFound: 0,
            searchTimeMs: Date.now() - start,
            cached: false,
            stale: false,
          };
        }
      })
    );

    res.json({ results, searchTimeMs: Date.now() - wallStart });
  });

  return router;
}

/**
 * Convert CachedProduct back to UnifiedProduct.
 *
 * The cache stores prices as display strings ("₹149.00") but UnifiedProduct
 * consumers (and the Nexus Go client) read `pricePaise`. Without this inverse
 * conversion, cached results deserialize with pricePaise=0, so downstream
 * consumers show a price of zero. Cache hits are the common path at runtime
 * because the scheduler pre-warms popular queries, so this must stay in sync
 * with toCachedProduct.
 */
function toUnifiedProduct(p: any): UnifiedProduct {
  const pricePaise = parsePriceToPaise(p.price ?? '');
  const mrpPaise = p.originalPrice ? parsePriceToPaise(p.originalPrice) : null;
  const qty = parseQuantity(p.quantity ?? '');

  return {
    id: p.id,
    name: p.name,
    brand: p.brand ?? null,
    pricePaise,
    priceDisplay: p.price ?? formatPrice(pricePaise),
    mrpPaise,
    mrpDisplay: p.originalPrice ?? (mrpPaise ? formatPrice(mrpPaise) : null),
    quantity: p.quantity ?? '',
    quantityValue: qty.value,
    quantityUnit: qty.unit,
    perUnitPricePaise: computePerUnitPrice(pricePaise, qty.value, qty.unit),
    deliveryTime: p.deliveryTime ?? '',
    discount: p.discount ?? null,
    discountPct: p.discountPct ?? null,
    imageUrl: p.imageUrl ?? '',
    productUrl: p.productUrl ?? null,
    available: p.available ?? true,
    rating: p.rating,
    totalRatings: p.totalRatings,
    source: p.source,
  };
}

/** Convert UnifiedProduct to CachedProduct format for storage */
function toCachedProduct(p: UnifiedProduct): any {
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
