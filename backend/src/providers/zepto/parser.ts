import { UnifiedProduct, formatPrice, parseQuantity, computePerUnitPrice } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Parse Zepto API response into UnifiedProduct[] */
export function parseZeptoProducts(data: any): UnifiedProduct[] {
  const products: UnifiedProduct[] = [];
  const seenIds = new Set<string>();

  if (!data.layout || !Array.isArray(data.layout)) return products;

  for (const widget of data.layout) {
    const items = widget.data?.resolver?.data?.items || [];

    for (const item of items) {
      if (item.productResponse?.product) {
        const p = parseProductData(item.productResponse, seenIds);
        if (p) products.push(p);
      }

      if (item.type === 'PRODUCT_ITEM' && item.data) {
        const p = parseProductData(item.data, seenIds);
        if (p) products.push(p);
      }

      if (Array.isArray(item.items)) {
        for (const nested of item.items) {
          if (nested.data?.product) {
            const p = parseProductData(nested.data, seenIds);
            if (p) products.push(p);
          }
        }
      }
    }
  }

  return products;
}

function parseProductData(d: any, seenIds: Set<string>): UnifiedProduct | null {
  try {
    const pv = d.productVariant || {};
    const p = d.product || { brand: '', name: 'Unknown Product' };
    const id = String(pv.id || d.id || '');

    if (!id || seenIds.has(id)) return null;
    seenIds.add(id);

    const sellingPricePaise = d.sellingPrice || 0;
    const mrpPaise = d.mrp || d.sellingPrice || 0;
    const hasMrp = mrpPaise !== sellingPricePaise;
    const discountPct = d.discountPercent > 0 ? Math.round(d.discountPercent) : null;

    const qtyText = pv.formattedPacksize || (pv.packsize ? `${pv.packsize} ${pv.unitOfMeasure || ''}`.trim() : '');
    const qty = parseQuantity(qtyText);

    return {
      id,
      name: p.name || 'Unknown Product',
      brand: p.brand || null,
      pricePaise: sellingPricePaise,
      priceDisplay: formatPrice(sellingPricePaise),
      mrpPaise: hasMrp ? mrpPaise : null,
      mrpDisplay: hasMrp ? formatPrice(mrpPaise) : null,
      quantity: qtyText,
      quantityValue: qty.value,
      quantityUnit: qty.unit,
      perUnitPricePaise: computePerUnitPrice(sellingPricePaise, qty.value, qty.unit),
      deliveryTime: '10 mins',
      discount: discountPct ? `${discountPct}% OFF` : null,
      discountPct,
      imageUrl: pv.images?.[0]?.path
        ? `https://cdn.zeptonow.com/${pv.images[0].path}`
        : '',
      productUrl: `https://www.zepto.com/pn/-/pvid/${id}`,
      available: !d.outOfStock,
      rating: pv.ratingSummary?.averageRating,
      totalRatings: pv.ratingSummary?.totalRatings,
      source: 'zepto',
    };
  } catch {
    return null;
  }
}
