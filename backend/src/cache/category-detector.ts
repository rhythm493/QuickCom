import { ProductCategory } from './types';

const CATEGORY_KEYWORDS: Record<ProductCategory, string[]> = {
  perishable: [
    'milk', 'bread', 'egg', 'eggs', 'paneer', 'curd', 'yogurt', 'dahi',
    'butter', 'cheese', 'cream', 'ghee', 'tofu', 'sprout', 'juice',
    'salad', 'cake', 'pastry', 'sandwich', 'fresh', 'green',
    'spinach', 'palak', 'methi', 'coriander', 'mint', 'pudina',
    'mushroom', 'chicken', 'mutton', 'fish', 'prawn', 'meat',
  ],
  staple: [
    'rice', 'atta', 'flour', 'maida', 'wheat', 'oil', 'dal', 'lentil',
    'sugar', 'salt', 'jaggery', 'gur', 'tea', 'coffee', 'spice',
    'masala', 'turmeric', 'haldi', 'chilli', 'pepper', 'cumin', 'jeera',
    'rava', 'suji', 'semolina', 'poha', 'oats', 'noodle', 'pasta',
    'besan', 'chana', 'rajma', 'moong', 'toor', 'urad',
    'onion', 'potato', 'tomato', 'garlic', 'ginger', 'aloo',
    'banana', 'apple', 'orange', 'mango', 'lemon', 'coconut',
  ],
  non_food: [
    'soap', 'shampoo', 'conditioner', 'detergent', 'surf', 'tide',
    'toothpaste', 'toothbrush', 'mouthwash', 'floss',
    'tissue', 'toilet', 'napkin', 'pad', 'tampon', 'diaper',
    'sanitizer', 'handwash', 'dettol', 'lizol', 'harpic',
    'floor', 'cleaner', 'mop', 'wipe', 'sponge', 'scrub',
    'battery', 'bulb', 'candle', 'matchbox', 'agarbatti',
    'dustbin', 'bag', 'foil', 'cling', 'wrap', 'container',
    'mosquito', 'repellent', 'coil', 'spray',
  ],
  other: [], // fallback, no keywords needed
};

// Pre-compile all keywords into a single lookup map for O(1) average-case detection
const keywordMap = new Map<string, ProductCategory>();

for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [ProductCategory, string[]][]) {
  if (category === 'other') continue;
  for (const kw of keywords) {
    keywordMap.set(kw.toLowerCase(), category);
  }
}

export function detectCategory(productName: string): ProductCategory {
  const nameLower = productName.toLowerCase();
  const words = nameLower.split(/[\s,\-\/\(\)]+/);

  // Check each word against the keyword map
  for (const word of words) {
    const category = keywordMap.get(word);
    if (category) return category;
  }

  // Substring match for compound words (e.g., "buttermilk" contains "butter")
  for (const [kw, category] of keywordMap) {
    if (nameLower.includes(kw)) return category;
  }

  return 'other';
}
