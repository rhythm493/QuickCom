import { UnifiedProduct, formatPrice, parseQuantity, computePerUnitPrice } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Parse Instamart API response into UnifiedProduct[].
 *
 * API format (as of 2026-03):
 *   data.cards[].card.card.gridElements.infoWithStyle.items[]
 *   Prices in whole INR (not paise).
 */
export function parseInstamartProducts(data: any): UnifiedProduct[] {
  const products: UnifiedProduct[] = [];

  const cards = data?.data?.cards;
  if (!Array.isArray(cards)) return products;

  for (const cardWrapper of cards) {
    const card = cardWrapper?.card?.card;
    if (!card) continue;

    const items = card?.gridElements?.infoWithStyle?.items;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      try {
        const product = parseItem(item);
        if (product) products.push(product);
      } catch {
        // Skip malformed products
      }
    }
  }

  return products;
}

function parseItem(item: any): UnifiedProduct | null {
  const variation = item?.variations?.[0];
  if (!variation) return null;

  const name = item.displayName || variation.displayName || '';
  if (!name) return null;

  const brand: string | null = item.brand || variation.brandName || null;

  const offerPriceINR = parseInt(variation.price?.offerPrice?.units || '0', 10);
  const mrpINR = parseInt(variation.price?.mrp?.units || '0', 10);
  const pricePaise = offerPriceINR * 100;
  const mrpPaise = mrpINR * 100;
  const hasMrp = mrpPaise > pricePaise;

  let imageUrl = '';
  const imageId: string = variation.imageIds?.[0] || '';
  if (imageId) {
    imageUrl = imageId.startsWith('http')
      ? imageId
      : `https://media-assets.swiggy.com/swiggy/image/upload/${imageId}`;
  }

  const discountPct = hasMrp
    ? Math.round(((mrpPaise - pricePaise) / mrpPaise) * 100)
    : null;

  const qtyText = variation.quantityDescription || 'N/A';
  const qty = parseQuantity(qtyText);
  const id = variation.skuId || String(item.productId || '');

  return {
    id,
    name,
    brand,
    pricePaise,
    priceDisplay: formatPrice(pricePaise),
    mrpPaise: hasMrp ? mrpPaise : null,
    mrpDisplay: hasMrp ? formatPrice(mrpPaise) : null,
    quantity: qtyText,
    quantityValue: qty.value,
    quantityUnit: qty.unit,
    perUnitPricePaise: computePerUnitPrice(pricePaise, qty.value, qty.unit),
    deliveryTime: '10 mins',
    discount: discountPct ? `${discountPct}% OFF` : null,
    discountPct,
    imageUrl,
    productUrl: `https://www.swiggy.com/instamart/item/${id}`,
    available: item.inStock !== false,
    source: 'instamart',
  };
}
