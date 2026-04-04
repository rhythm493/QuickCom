import { UnifiedProduct, parsePriceToPaise, formatPrice, parseQuantity, computePerUnitPrice } from '../types';

interface BlinkitSnippet {
  widget_type?: string;
  data?: {
    identity?: { id?: string };
    name?: { text?: string };
    normal_price?: { text?: string };
    price?: number;
    mrp?: { text?: string };
    variant?: { text?: string };
    eta_tag?: { title?: { text?: string } };
    offer_tag?: { title?: { text?: string } };
    image?: { url?: string };
    is_sold_out?: boolean;
  };
}

interface BlinkitSearchResponse {
  is_success?: boolean;
  response?: {
    snippets?: BlinkitSnippet[];
  };
}

/** Parse Blinkit API response into UnifiedProduct[] */
export function parseBlinkitProducts(data: BlinkitSearchResponse): UnifiedProduct[] {
  if (!data.response?.snippets) return [];

  const products: UnifiedProduct[] = [];

  for (const snippet of data.response.snippets) {
    if (
      !snippet.data ||
      snippet.widget_type === 'image_text_vr_type_header' ||
      !snippet.data.name ||
      !snippet.data.identity ||
      snippet.data.identity.id === 'product_container'
    ) {
      continue;
    }

    const d = snippet.data;

    try {
      const priceStr = d.normal_price?.text || (d.price ? `₹${d.price}` : '₹0');
      const pricePaise = parsePriceToPaise(priceStr);

      let mrpPaise: number | null = null;
      if (d.mrp?.text) {
        mrpPaise = parsePriceToPaise(d.mrp.text);
        if (mrpPaise === pricePaise) mrpPaise = null;
      }

      const discountPct = mrpPaise && mrpPaise > pricePaise
        ? Math.round(((mrpPaise - pricePaise) / mrpPaise) * 100)
        : null;

      const qty = parseQuantity(d.variant?.text || '');
      const id = d.identity?.id || `blinkit_${Date.now()}`;

      products.push({
        id,
        name: d.name?.text || 'Unknown Product',
        brand: null,
        pricePaise,
        priceDisplay: formatPrice(pricePaise),
        mrpPaise,
        mrpDisplay: mrpPaise ? formatPrice(mrpPaise) : null,
        quantity: d.variant?.text || 'N/A',
        quantityValue: qty.value,
        quantityUnit: qty.unit,
        perUnitPricePaise: computePerUnitPrice(pricePaise, qty.value, qty.unit),
        deliveryTime: d.eta_tag?.title?.text || 'N/A',
        discount: d.offer_tag?.title?.text || null,
        discountPct,
        imageUrl: d.image?.url || '',
        productUrl: `https://blinkit.com/prn/-/prid/${id}`,
        available: !d.is_sold_out,
        source: 'blinkit',
      });
    } catch {
      // Skip malformed products
    }
  }

  return products;
}
