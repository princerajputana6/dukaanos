/**
 * Starter catalogues offered during onboarding ("Add sample products"). Selling prices are
 * typical MRP (GST-inclusive); purchase prices are cost BEFORE GST (input tax is recoverable),
 * matching how profit is computed. Owners are expected to edit them.
 */
export interface SampleProduct {
  name: string;
  category: string;
  brand?: string;
  unit: string;
  purchasePricePaise: number;
  sellingPricePaise: number;
  mrpPaise?: number;
  gstRateBp: number;
  hsnCode?: string;
  openingStockMilli: number;
  lowStockThresholdMilli: number;
  trackStock?: boolean;
  aliases: string[];
  units?: Array<{ name: string; factorMilli: number }>;
}

const crate24 = [{ name: "crate", factorMilli: 24000 }];

export const KIRANA_SAMPLES: SampleProduct[] = [
  { name: "Coke 250ml", category: "Cold Drinks", brand: "Coca-Cola", unit: "bottle", purchasePricePaise: 1215, sellingPricePaise: 2000, mrpPaise: 2000, gstRateBp: 4000, hsnCode: "2202", openingStockMilli: 48000, lowStockThresholdMilli: 12000, aliases: ["Coke", "Coca Cola", "Coke chhota", "कोक"], units: crate24 },
  { name: "Coke 500ml", category: "Cold Drinks", brand: "Coca-Cola", unit: "bottle", purchasePricePaise: 2430, sellingPricePaise: 4000, mrpPaise: 4000, gstRateBp: 4000, hsnCode: "2202", openingStockMilli: 34000, lowStockThresholdMilli: 12000, aliases: ["Coke", "Coca Cola", "Coke bottle", "500 Coke", "कोक"], units: crate24 },
  { name: "Sprite 250ml", category: "Cold Drinks", brand: "Coca-Cola", unit: "bottle", purchasePricePaise: 1215, sellingPricePaise: 2000, mrpPaise: 2000, gstRateBp: 4000, hsnCode: "2202", openingStockMilli: 36000, lowStockThresholdMilli: 12000, aliases: ["Sprite", "स्प्राइट"], units: crate24 },
  { name: "Sprite 500ml", category: "Cold Drinks", brand: "Coca-Cola", unit: "bottle", purchasePricePaise: 2430, sellingPricePaise: 4000, mrpPaise: 4000, gstRateBp: 4000, hsnCode: "2202", openingStockMilli: 24000, lowStockThresholdMilli: 12000, aliases: ["Sprite", "स्प्राइट"], units: crate24 },
  { name: "Pepsi 500ml", category: "Cold Drinks", brand: "PepsiCo", unit: "bottle", purchasePricePaise: 2430, sellingPricePaise: 4000, mrpPaise: 4000, gstRateBp: 4000, hsnCode: "2202", openingStockMilli: 20000, lowStockThresholdMilli: 10000, aliases: ["Pepsi", "पेप्सी"], units: crate24 },
  { name: "Parle-G Biscuit 100g", category: "Biscuits", brand: "Parle", unit: "pack", purchasePricePaise: 720, sellingPricePaise: 1000, mrpPaise: 1000, gstRateBp: 1800, hsnCode: "1905", openingStockMilli: 60000, lowStockThresholdMilli: 15000, aliases: ["Biscuit", "Parle G", "Parle", "बिस्कुट"], units: [{ name: "box", factorMilli: 48000 }] },
  { name: "Lay's Chips 52g", category: "Snacks", brand: "PepsiCo", unit: "packet", purchasePricePaise: 1520, sellingPricePaise: 2000, mrpPaise: 2000, gstRateBp: 1200, hsnCode: "2005", openingStockMilli: 40000, lowStockThresholdMilli: 10000, aliases: ["Chips", "Lays", "Lays chips", "चिप्स"] },
  { name: "Amul Milk 500ml", category: "Dairy", brand: "Amul", unit: "packet", purchasePricePaise: 2700, sellingPricePaise: 2900, mrpPaise: 2900, gstRateBp: 0, hsnCode: "0401", openingStockMilli: 30000, lowStockThresholdMilli: 10000, aliases: ["Milk", "Doodh", "Amul doodh", "दूध"] },
  { name: "Bread 400g", category: "Bakery", brand: "Harvest Gold", unit: "packet", purchasePricePaise: 3800, sellingPricePaise: 4500, mrpPaise: 4500, gstRateBp: 0, hsnCode: "1905", openingStockMilli: 15000, lowStockThresholdMilli: 5000, aliases: ["Bread", "Double roti", "ब्रेड"] },
  { name: "Bisleri Water 1L", category: "Beverages", brand: "Bisleri", unit: "bottle", purchasePricePaise: 1350, sellingPricePaise: 2000, mrpPaise: 2000, gstRateBp: 1800, hsnCode: "2201", openingStockMilli: 48000, lowStockThresholdMilli: 12000, aliases: ["Water", "Paani", "Bisleri", "पानी"], units: [{ name: "case", factorMilli: 12000 }] },
];

const CAFE_SAMPLES: SampleProduct[] = [
  { name: "Cutting Chai", category: "Tea", unit: "cup", purchasePricePaise: 400, sellingPricePaise: 1000, gstRateBp: 500, openingStockMilli: 0, lowStockThresholdMilli: 0, trackStock: false, aliases: ["Chai", "Tea", "चाय"] },
  { name: "Filter Coffee", category: "Coffee", unit: "cup", purchasePricePaise: 800, sellingPricePaise: 2000, gstRateBp: 500, openingStockMilli: 0, lowStockThresholdMilli: 0, trackStock: false, aliases: ["Coffee", "कॉफी"] },
  { name: "Samosa", category: "Snacks", unit: "pcs", purchasePricePaise: 700, sellingPricePaise: 1500, gstRateBp: 500, openingStockMilli: 40000, lowStockThresholdMilli: 10000, aliases: ["Samosa", "समोसा"] },
  { name: "Bun Maska", category: "Snacks", unit: "pcs", purchasePricePaise: 1200, sellingPricePaise: 3000, gstRateBp: 500, openingStockMilli: 20000, lowStockThresholdMilli: 5000, aliases: ["Bun", "Maska bun"] },
  { name: "Bisleri Water 1L", category: "Beverages", brand: "Bisleri", unit: "bottle", purchasePricePaise: 1350, sellingPricePaise: 2000, mrpPaise: 2000, gstRateBp: 1800, hsnCode: "2201", openingStockMilli: 24000, lowStockThresholdMilli: 6000, aliases: ["Water", "Paani", "पानी"] },
];

const SALON_SAMPLES: SampleProduct[] = [
  { name: "Haircut", category: "Services", unit: "service", purchasePricePaise: 0, sellingPricePaise: 15000, gstRateBp: 1800, hsnCode: "999721", openingStockMilli: 0, lowStockThresholdMilli: 0, trackStock: false, aliases: ["Cutting", "Hair cut", "बाल कटिंग"] },
  { name: "Beard Trim", category: "Services", unit: "service", purchasePricePaise: 0, sellingPricePaise: 8000, gstRateBp: 1800, hsnCode: "999721", openingStockMilli: 0, lowStockThresholdMilli: 0, trackStock: false, aliases: ["Shave", "Dadhi", "Beard"] },
  { name: "Hair Oil 100ml", category: "Retail", unit: "bottle", purchasePricePaise: 6700, sellingPricePaise: 9900, mrpPaise: 9900, gstRateBp: 1800, hsnCode: "3305", openingStockMilli: 12000, lowStockThresholdMilli: 3000, aliases: ["Oil", "Tel"] },
];

const STATIONERY_SAMPLES: SampleProduct[] = [
  { name: "Classmate Notebook 172pg", category: "Notebooks", brand: "Classmate", unit: "pcs", purchasePricePaise: 4170, sellingPricePaise: 5500, mrpPaise: 5500, gstRateBp: 1200, hsnCode: "4820", openingStockMilli: 50000, lowStockThresholdMilli: 10000, aliases: ["Notebook", "Copy", "कॉपी"] },
  { name: "Reynolds Blue Pen", category: "Pens", brand: "Reynolds", unit: "pcs", purchasePricePaise: 680, sellingPricePaise: 1000, mrpPaise: 1000, gstRateBp: 1800, hsnCode: "9608", openingStockMilli: 100000, lowStockThresholdMilli: 20000, aliases: ["Pen", "Blue pen", "पेन"] },
  { name: "Apsara Pencil", category: "Pencils", brand: "Apsara", unit: "pcs", purchasePricePaise: 380, sellingPricePaise: 500, mrpPaise: 500, gstRateBp: 1200, hsnCode: "9609", openingStockMilli: 100000, lowStockThresholdMilli: 20000, aliases: ["Pencil", "पेंसिल"] },
];

const PAAN_SAMPLES: SampleProduct[] = [
  { name: "Meetha Paan", category: "Paan", unit: "pcs", purchasePricePaise: 1200, sellingPricePaise: 3000, gstRateBp: 0, openingStockMilli: 0, lowStockThresholdMilli: 0, trackStock: false, aliases: ["Meetha", "Sweet paan", "मीठा पान"] },
  { name: "Saada Paan", category: "Paan", unit: "pcs", purchasePricePaise: 800, sellingPricePaise: 2000, gstRateBp: 0, openingStockMilli: 0, lowStockThresholdMilli: 0, trackStock: false, aliases: ["Sada paan", "सादा पान"] },
  { name: "Rajnigandha Pan Masala 4g", category: "Pan Masala", brand: "Rajnigandha", unit: "packet", purchasePricePaise: 400, sellingPricePaise: 500, mrpPaise: 500, gstRateBp: 2800, hsnCode: "2106", openingStockMilli: 200000, lowStockThresholdMilli: 50000, aliases: ["Rajnigandha", "Pan masala"] },
  { name: "Mint Candy", category: "Confectionery", unit: "pcs", purchasePricePaise: 70, sellingPricePaise: 100, mrpPaise: 100, gstRateBp: 1800, hsnCode: "1704", openingStockMilli: 300000, lowStockThresholdMilli: 50000, aliases: ["Candy", "Toffee", "टॉफी"] },
  { name: "Bisleri Water 1L", category: "Beverages", brand: "Bisleri", unit: "bottle", purchasePricePaise: 1350, sellingPricePaise: 2000, mrpPaise: 2000, gstRateBp: 1800, hsnCode: "2201", openingStockMilli: 24000, lowStockThresholdMilli: 6000, aliases: ["Water", "Paani", "पानी"] },
];

const ELECTRONICS_SAMPLES: SampleProduct[] = [
  { name: "USB-C Charger 25W", category: "Chargers", unit: "pcs", purchasePricePaise: 45000, sellingPricePaise: 79900, mrpPaise: 99900, gstRateBp: 1800, hsnCode: "8504", openingStockMilli: 15000, lowStockThresholdMilli: 3000, aliases: ["Charger", "Type C charger", "चार्जर"] },
  { name: "USB-C Cable 1m", category: "Cables", unit: "pcs", purchasePricePaise: 9000, sellingPricePaise: 19900, mrpPaise: 29900, gstRateBp: 1800, hsnCode: "8544", openingStockMilli: 40000, lowStockThresholdMilli: 10000, aliases: ["Cable", "Data cable", "Type C cable"] },
  { name: "Wired Earphones", category: "Audio", unit: "pcs", purchasePricePaise: 12000, sellingPricePaise: 24900, mrpPaise: 39900, gstRateBp: 1800, hsnCode: "8518", openingStockMilli: 25000, lowStockThresholdMilli: 5000, aliases: ["Earphone", "Handsfree", "हेडफ़ोन"] },
  { name: "LED Bulb 9W", category: "Lighting", brand: "Philips", unit: "pcs", purchasePricePaise: 6500, sellingPricePaise: 9900, mrpPaise: 12000, gstRateBp: 1200, hsnCode: "8539", openingStockMilli: 50000, lowStockThresholdMilli: 10000, aliases: ["Bulb", "LED", "बल्ब"] },
  { name: "AA Battery (pair)", category: "Batteries", brand: "Duracell", unit: "pack", purchasePricePaise: 6000, sellingPricePaise: 8500, mrpPaise: 9000, gstRateBp: 1800, hsnCode: "8506", openingStockMilli: 30000, lowStockThresholdMilli: 8000, aliases: ["Battery", "Cell", "सेल"] },
];

const GARMENT_SAMPLES: SampleProduct[] = [
  { name: "Cotton T-Shirt (M)", category: "T-Shirts", unit: "pcs", purchasePricePaise: 18000, sellingPricePaise: 39900, mrpPaise: 49900, gstRateBp: 500, hsnCode: "6109", openingStockMilli: 20000, lowStockThresholdMilli: 5000, aliases: ["T shirt", "Tee", "टी-शर्ट"] },
  { name: "Denim Jeans (32)", category: "Jeans", unit: "pcs", purchasePricePaise: 55000, sellingPricePaise: 119900, mrpPaise: 149900, gstRateBp: 1200, hsnCode: "6203", openingStockMilli: 12000, lowStockThresholdMilli: 3000, aliases: ["Jeans", "जीन्स"] },
  { name: "Cotton Kurta (L)", category: "Ethnic", unit: "pcs", purchasePricePaise: 40000, sellingPricePaise: 89900, mrpPaise: 99900, gstRateBp: 500, hsnCode: "6211", openingStockMilli: 10000, lowStockThresholdMilli: 3000, aliases: ["Kurta", "कुर्ता"] },
  { name: "Socks (pair)", category: "Accessories", unit: "pack", purchasePricePaise: 4000, sellingPricePaise: 9900, mrpPaise: 12000, gstRateBp: 500, hsnCode: "6115", openingStockMilli: 60000, lowStockThresholdMilli: 15000, aliases: ["Socks", "Moze", "मोज़े"] },
];

export function samplesFor(businessType: string | null | undefined): SampleProduct[] {
  switch (businessType) {
    case "cafe":
      return CAFE_SAMPLES;
    case "salon":
      return SALON_SAMPLES;
    case "stationery":
      return STATIONERY_SAMPLES;
    case "paan":
      return PAAN_SAMPLES;
    case "electronics":
      return ELECTRONICS_SAMPLES;
    case "garments":
      return GARMENT_SAMPLES;
    default:
      return KIRANA_SAMPLES;
  }
}
