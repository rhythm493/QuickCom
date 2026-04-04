import { v4 as uuidv4 } from 'uuid';
import { BaseProvider } from '../base-provider';
import { SessionManager } from '../session-manager';
import { Location, UnifiedProduct } from '../types';
import { BrowserPool } from '../../browser/pool';
import { config } from '../../config';
import { parseBlinkitProducts } from './parser';
import type { Page } from 'puppeteer';

/**
 * Blinkit auth_key: a public app constant embedded in Blinkit's JS bundle.
 * It is not user-specific or session-specific — the same value is used for all
 * anonymous (unauthenticated) requests. It lives in localStorage.authKey after
 * any page load on blinkit.com.
 *
 * How we know: intercepted from a real browser session (see research/api-logs/).
 * Cloudflare blocks direct HTTP clients (axios) via TLS fingerprinting, so we
 * must execute the API call inside a Puppeteer page context using page.evaluate().
 */
const BLINKIT_AUTH_KEY = 'c761ec3633c22afad934fb17a66385c1c06c5472b4898b866b7306186d0bb477';

interface BlinkitCredentials {
  deviceId: string;
  authKey: string;
  /** Cookie string captured from the session page — used for session continuity */
  cookies: string;
}

export class BlinkitProvider extends BaseProvider<BlinkitCredentials> {
  readonly name = 'blinkit';
  /**
   * We need Puppeteer for each search because Cloudflare's TLS fingerprinting
   * blocks direct axios calls (returns 403). The fetch() call must originate
   * from inside an actual Chrome page context.
   */
  readonly needsPuppeteerForSearch = true;

  private sessionUuid = uuidv4();

  constructor(browserPool: BrowserPool) {
    super(
      new SessionManager<BlinkitCredentials>(
        'blinkit',
        config.sessionsDir,
        24 * 7, // 1 week — credentials are stable app constants
        creds => !!(creds.deviceId)
      ),
      browserPool
    );
  }

  protected async initializeFromBrowser(page: Page): Promise<void> {
    // Set location cookies before navigating
    if (this.location) {
      await page.setCookie(
        { name: 'gr_1_lat', value: String(this.location.lat), domain: 'blinkit.com' },
        { name: 'gr_1_lon', value: String(this.location.lon), domain: 'blinkit.com' },
      );
    }

    // Navigate to homepage — this lets Cloudflare verify we're a real browser
    // and also lets Blinkit's JS run to set localStorage (authKey, deviceId)
    await page.goto('https://blinkit.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });

    // Wait for JS to execute and populate localStorage
    await new Promise(r => setTimeout(r, 1500));

    // Extract auth values from the page (set by Blinkit's own JS bundle).
    // We cast to `any` inside evaluate() because the callback runs in browser
    // context (where `localStorage` exists), not in the Node.js type environment.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authKey: string = await page.evaluate((): string => (globalThis as any).localStorage?.getItem?.('authKey') ?? '').catch(() => '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deviceId: string = await page.evaluate((): string => (globalThis as any).localStorage?.getItem?.('deviceId') ?? '').catch(() => '');

    const browserCookies = await page.cookies();

    this.credentials = {
      authKey: authKey || BLINKIT_AUTH_KEY,
      deviceId: deviceId || this.generateDeviceId(),
      cookies: browserCookies.map(c => `${c.name}=${c.value}`).join('; '),
    };

    this.log(`Initialized: authKey=${this.credentials.authKey ? 'present' : 'missing'}, deviceId=${this.credentials.deviceId}`);
    await this.saveSession();
  }

  protected async resolveStore(location: Location): Promise<string | null> {
    // Blinkit uses lat/lon headers directly — no store ID needed
    return `blinkit_${location.lat}_${location.lon}`;
  }

  protected async doSearch(query: string): Promise<UnifiedProduct[]> {
    if (!this.location) {
      throw new Error('Location not set');
    }
    if (!this.page || this.page.isClosed()) {
      throw new Error('No active Puppeteer page');
    }

    const authKey = this.credentials?.authKey || BLINKIT_AUTH_KEY;
    const deviceId = this.credentials?.deviceId || this.generateDeviceId();
    const sessionUuid = this.sessionUuid;
    const lat = String(this.location.lat);
    const lon = String(this.location.lon);

    // Execute the API call from within the browser page context.
    // This is required because Cloudflare's bot protection (403) blocks
    // direct Node.js HTTP clients, but passes fetch() calls from a real Chrome page.
    const result = await this.page.evaluate(
      async (query: string, lat: string, lon: string, authKey: string, deviceId: string, sessionUuid: string) => {
        try {
          const resp = await fetch(
            `https://blinkit.com/v1/layout/search?q=${encodeURIComponent(query)}&search_type=type_to_search`,
            {
              method: 'POST',
              headers: {
                'lat': lat,
                'lon': lon,
                'auth_key': authKey,
                'device_id': deviceId,
                'session_uuid': sessionUuid,
                'app_client': 'consumer_web',
                'app_version': '1010101010',
                'web_app_version': '1008010016',
                'rn_bundle_version': '1009003012',
                'content-type': 'application/json',
                'access_token': 'null',
                'accept': '*/*',
                'referer': `https://blinkit.com/s/?q=${encodeURIComponent(query)}`,
              },
              body: JSON.stringify({
                applied_filters: null,
                monet_assets: [{ name: 'ads_vertical_banner', processed: 0, total: 0 }],
                postback_meta: {
                  processedGroupIds: [],
                  pageMeta: { scrollMeta: [{ entitiesCount: 0 }] },
                },
                previous_search_query: query,
                processed_rails: {},
                similar_entities: null,
                sort: '',
                vertical_cards_processed: 0,
              }),
            }
          );

          if (!resp.ok) {
            return { error: `HTTP ${resp.status}`, data: null };
          }

          const data = await resp.json();
          return { error: null, data };
        } catch (e: unknown) {
          return { error: e instanceof Error ? e.message : String(e), data: null };
        }
      },
      query, lat, lon, authKey, deviceId, sessionUuid
    );

    if (result.error) {
      this.log(`Search API error: ${result.error}`, 'error');
      throw new Error(`Blinkit search failed: ${result.error}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data as any;
    if (!data?.is_success) {
      this.log(`API returned is_success=false`, 'error');
      throw new Error('Blinkit API returned unsuccessful response');
    }

    const products = parseBlinkitProducts(data);
    if (products.length === 0) {
      this.log(`No products parsed from ${data?.response?.snippets?.length ?? 0} snippets`);
    }
    return products;
  }

  private generateDeviceId(): string {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
