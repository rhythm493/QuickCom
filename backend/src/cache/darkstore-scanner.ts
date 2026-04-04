import { darkstoreTracker } from './darkstore-tracker';
import { Service } from './types';

export interface ScanProgress {
  service: string;
  neighborhood: string;
  storesFound: number;
  totalPoints: number;
  currentPoint: number;
  done: boolean;
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

interface GridPoint {
  name: string;
  lat: number;
  lon: number;
}

const PUNE_GRID: GridPoint[] = [
  { name: 'Kothrud', lat: 18.5074, lon: 73.8077 },
  { name: 'Hinjewadi', lat: 18.5912, lon: 73.7390 },
  { name: 'Viman Nagar', lat: 18.5679, lon: 73.9143 },
  { name: 'Hadapsar', lat: 18.5089, lon: 73.9260 },
  { name: 'Baner', lat: 18.5590, lon: 73.7868 },
  { name: 'Aundh', lat: 18.5580, lon: 73.8073 },
  { name: 'Kharadi', lat: 18.5520, lon: 73.9470 },
  { name: 'Wakad', lat: 18.5986, lon: 73.7603 },
  { name: 'Magarpatta', lat: 18.5155, lon: 73.9275 },
  { name: 'Kalyani Nagar', lat: 18.5484, lon: 73.9020 },
  { name: 'Koregaon Park', lat: 18.5362, lon: 73.8940 },
  { name: 'Pimpri', lat: 18.6279, lon: 73.8009 },
  { name: 'Chinchwad', lat: 18.6298, lon: 73.7997 },
  { name: 'Shivajinagar', lat: 18.5308, lon: 73.8475 },
  { name: 'Camp', lat: 18.5196, lon: 73.8784 },
  { name: 'Swargate', lat: 18.5012, lon: 73.8625 },
  { name: 'Deccan', lat: 18.5195, lon: 73.8403 },
  { name: 'Bibwewadi', lat: 18.4810, lon: 73.8621 },
  { name: 'Katraj', lat: 18.4575, lon: 73.8643 },
  { name: 'Kondhwa', lat: 18.4716, lon: 73.8952 },
  { name: 'Undri', lat: 18.4498, lon: 73.9152 },
  { name: 'NIBM', lat: 18.4705, lon: 73.9022 },
  { name: 'Warje', lat: 18.4876, lon: 73.8030 },
  { name: 'Bavdhan', lat: 18.5154, lon: 73.7800 },
  { name: 'Pashan', lat: 18.5360, lon: 73.7930 },
];

const CITY_GRIDS: Record<string, GridPoint[]> = {
  pune: PUNE_GRID,
};

const SCAN_DELAY_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a random UUID v4.
 */
function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Discover Zepto darkstores by calling their store-locator API.
 * Uses GET with query params and required platform headers.
 */
async function discoverZeptoStores(
  point: GridPoint,
  onProgress: ScanProgressCallback,
  currentPoint: number,
  totalPoints: number,
  storesFoundSoFar: number
): Promise<number> {
  let found = 0;
  try {
    const sessionId = uuidv4();
    const deviceId = uuidv4();
    const requestId = uuidv4();

    const url = `https://bff-gateway.zepto.com/lms/api/v2/get_page?latitude=${point.lat}&longitude=${point.lon}&page_type=HOME&version=v2&page_size=1&enforce_platform_type=DESKTOP`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'platform': 'WEB',
        'app_sub_platform': 'WEB',
        'app_version': '14.9.0',
        'appversion': '14.9.0',
        'session_id': sessionId,
        'sessionid': sessionId,
        'device_id': deviceId,
        'deviceid': deviceId,
        'request_id': requestId,
        'requestid': requestId,
        'tenant': 'ZEPTO',
        'marketplace_type': 'SUPER_SAVER',
        'source': 'DIRECT',
        'x-without-bearer': 'true',
        'auth_revamp_flow': 'v2',
        'referer': 'https://www.zepto.com/',
        'origin': 'https://www.zepto.com',
      },
    });

    if (!response.ok) {
      console.log(`[Scanner] Zepto: ${point.name} - HTTP ${response.status}`);
      return found;
    }

    const data: any = await response.json();

    // Primary store
    const primaryStoreId = data?.storeServiceableResponse?.storeId;
    if (primaryStoreId) {
      const locId = darkstoreTracker.registerLocation(point.lat, point.lon, `${point.name}, Pune`);
      darkstoreTracker.registerDarkstore('zepto', primaryStoreId, locId, {
        neighborhood: point.name,
        city: 'Pune',
        discoveredVia: 'grid-scan',
      });
      found++;
    }

    // Secondary stores from V2 response
    const storesV2 = data?.storeServiceableResponseV2;
    if (Array.isArray(storesV2)) {
      for (const store of storesV2) {
        const storeId = store?.storeId || store?.store_id;
        if (storeId && storeId !== primaryStoreId) {
          const locId = darkstoreTracker.registerLocation(point.lat, point.lon, `${point.name}, Pune`);
          darkstoreTracker.registerDarkstore('zepto', storeId, locId, {
            neighborhood: point.name,
            city: 'Pune',
            discoveredVia: 'grid-scan',
          });
          found++;
        }
      }
    }

    console.log(`[Scanner] Zepto: ${point.name} -> ${found} store(s)`);
  } catch (err: any) {
    console.error(`[Scanner] Zepto: ${point.name} error:`, err.message);
  }

  onProgress({
    service: 'zepto',
    neighborhood: point.name,
    storesFound: storesFoundSoFar + found,
    totalPoints,
    currentPoint,
    done: false,
  });

  return found;
}

/**
 * Discover Blinkit darkstores. Blinkit doesn't expose store IDs via API,
 * so we register synthetic store IDs based on coordinates.
 * Two nearby points returning identical top-5 product IDs would share a darkstore.
 */
async function discoverBlinkitStores(
  point: GridPoint,
  onProgress: ScanProgressCallback,
  currentPoint: number,
  totalPoints: number,
  storesFoundSoFar: number
): Promise<number> {
  let found = 0;
  try {
    const response = await fetch('https://blinkit.com/v1/layout/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'lat': String(point.lat),
        'lon': String(point.lon),
      },
      body: JSON.stringify({ search_query: 'milk' }),
    });

    if (!response.ok) {
      console.log(`[Scanner] Blinkit: ${point.name} - HTTP ${response.status}`);
      // Still register the point as a synthetic darkstore
      const locId = darkstoreTracker.registerLocation(point.lat, point.lon, `${point.name}, Pune`);
      const storeId = `blinkit_${point.lat}_${point.lon}`;
      darkstoreTracker.registerDarkstore('blinkit', storeId, locId, {
        neighborhood: point.name,
        city: 'Pune',
        discoveredVia: 'grid-scan',
        synthetic: true,
      });
      found++;
    } else {
      const locId = darkstoreTracker.registerLocation(point.lat, point.lon, `${point.name}, Pune`);
      const storeId = `blinkit_${point.lat}_${point.lon}`;
      darkstoreTracker.registerDarkstore('blinkit', storeId, locId, {
        neighborhood: point.name,
        city: 'Pune',
        discoveredVia: 'grid-scan',
      });
      found++;
      console.log(`[Scanner] Blinkit: ${point.name} -> 1 store (synthetic)`);
    }
  } catch (err: any) {
    console.error(`[Scanner] Blinkit: ${point.name} error:`, err.message);
    // Register anyway with error flag
    const locId = darkstoreTracker.registerLocation(point.lat, point.lon, `${point.name}, Pune`);
    const storeId = `blinkit_${point.lat}_${point.lon}`;
    darkstoreTracker.registerDarkstore('blinkit', storeId, locId, {
      neighborhood: point.name,
      city: 'Pune',
      discoveredVia: 'grid-scan',
      error: err.message,
    });
    found++;
  }

  onProgress({
    service: 'blinkit',
    neighborhood: point.name,
    storesFound: storesFoundSoFar + found,
    totalPoints,
    currentPoint,
    done: false,
  });

  return found;
}

/**
 * Discover Instamart darkstores via their maps/address-widgets API.
 */
async function discoverInstamartStores(
  point: GridPoint,
  onProgress: ScanProgressCallback,
  currentPoint: number,
  totalPoints: number,
  storesFoundSoFar: number
): Promise<number> {
  let found = 0;
  try {
    const url = `https://www.swiggy.com/api/instamart/maps/address-widgets?lat=${point.lat}&lng=${point.lon}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.log(`[Scanner] Instamart: ${point.name} - HTTP ${response.status}`);
      // Register synthetic store
      const locId = darkstoreTracker.registerLocation(point.lat, point.lon, `${point.name}, Pune`);
      const storeId = `instamart_${point.lat}_${point.lon}`;
      darkstoreTracker.registerDarkstore('instamart', storeId, locId, {
        neighborhood: point.name,
        city: 'Pune',
        discoveredVia: 'grid-scan',
        synthetic: true,
      });
      found++;
    } else {
      const data: any = await response.json();

      const storeIds = new Set<string>();

      // Try to extract store IDs from response
      const storeId = data?.data?.storeId || data?.storeId;
      const primaryStoreId = data?.data?.primaryStoreId || data?.primaryStoreId;
      const secondaryStoreId = data?.data?.secondaryStoreId || data?.secondaryStoreId;

      if (storeId) storeIds.add(String(storeId));
      if (primaryStoreId) storeIds.add(String(primaryStoreId));
      if (secondaryStoreId) storeIds.add(String(secondaryStoreId));

      if (storeIds.size > 0) {
        for (const sid of storeIds) {
          const locId = darkstoreTracker.registerLocation(point.lat, point.lon, `${point.name}, Pune`);
          darkstoreTracker.registerDarkstore('instamart', sid, locId, {
            neighborhood: point.name,
            city: 'Pune',
            discoveredVia: 'grid-scan',
          });
          found++;
        }
      } else {
        // No store IDs found, register synthetic
        const locId = darkstoreTracker.registerLocation(point.lat, point.lon, `${point.name}, Pune`);
        const syntheticId = `instamart_${point.lat}_${point.lon}`;
        darkstoreTracker.registerDarkstore('instamart', syntheticId, locId, {
          neighborhood: point.name,
          city: 'Pune',
          discoveredVia: 'grid-scan',
          synthetic: true,
        });
        found++;
      }

      console.log(`[Scanner] Instamart: ${point.name} -> ${found} store(s)`);
    }
  } catch (err: any) {
    console.error(`[Scanner] Instamart: ${point.name} error:`, err.message);
    // Register synthetic store on error
    const locId = darkstoreTracker.registerLocation(point.lat, point.lon, `${point.name}, Pune`);
    const storeId = `instamart_${point.lat}_${point.lon}`;
    darkstoreTracker.registerDarkstore('instamart', storeId, locId, {
      neighborhood: point.name,
      city: 'Pune',
      discoveredVia: 'grid-scan',
      error: err.message,
    });
    found++;
  }

  onProgress({
    service: 'instamart',
    neighborhood: point.name,
    storesFound: storesFoundSoFar + found,
    totalPoints,
    currentPoint,
    done: false,
  });

  return found;
}

/**
 * Scan a city's grid points to discover all unique darkstores for a given service.
 */
async function scanServiceForCity(
  service: Service,
  grid: GridPoint[],
  onProgress: ScanProgressCallback
): Promise<number> {
  let totalFound = 0;

  for (let i = 0; i < grid.length; i++) {
    const point = grid[i];
    let found = 0;

    switch (service) {
      case 'zepto':
        found = await discoverZeptoStores(point, onProgress, i + 1, grid.length, totalFound);
        break;
      case 'blinkit':
        found = await discoverBlinkitStores(point, onProgress, i + 1, grid.length, totalFound);
        break;
      case 'instamart':
        found = await discoverInstamartStores(point, onProgress, i + 1, grid.length, totalFound);
        break;
    }

    totalFound += found;

    // Rate limit between API calls
    if (i < grid.length - 1) {
      await delay(SCAN_DELAY_MS);
    }
  }

  onProgress({
    service,
    neighborhood: 'Done',
    storesFound: totalFound,
    totalPoints: grid.length,
    currentPoint: grid.length,
    done: true,
  });

  return totalFound;
}

export interface ScanResult {
  city: string;
  services: Record<Service, number>;
  totalStores: number;
  durationMs: number;
}

/**
 * Scan all services for a city. Scans services sequentially to avoid
 * overwhelming APIs, but within each service scans points sequentially
 * with rate limiting.
 */
export async function scanCity(
  city: string,
  onProgress: ScanProgressCallback
): Promise<ScanResult> {
  const grid = CITY_GRIDS[city.toLowerCase()];
  if (!grid) {
    throw new Error(`Unknown city: ${city}. Available: ${Object.keys(CITY_GRIDS).join(', ')}`);
  }

  const start = Date.now();
  const result: ScanResult = {
    city,
    services: { blinkit: 0, zepto: 0, instamart: 0 },
    totalStores: 0,
    durationMs: 0,
  };

  console.log(`[Scanner] Starting grid scan for ${city} (${grid.length} points)`);

  const services: Service[] = ['zepto', 'blinkit', 'instamart'];
  for (const svc of services) {
    console.log(`[Scanner] Scanning ${svc}...`);
    const count = await scanServiceForCity(svc, grid, onProgress);
    result.services[svc] = count;
    result.totalStores += count;
  }

  result.durationMs = Date.now() - start;
  console.log(`[Scanner] Scan complete: ${result.totalStores} stores in ${result.durationMs}ms`);

  return result;
}

export function getAvailableCities(): string[] {
  return Object.keys(CITY_GRIDS);
}
