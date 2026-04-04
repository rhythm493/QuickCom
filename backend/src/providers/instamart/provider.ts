import { BaseProvider } from '../base-provider';
import { SessionManager } from '../session-manager';
import { Location, UnifiedProduct } from '../types';
import { BrowserPool } from '../../browser/pool';
import { config } from '../../config';
import { parseInstamartProducts } from './parser';
import type { Page } from 'puppeteer';

interface InstamartCredentials {
  deviceId: string;
  tid: string;
  sid: string;
  awsWafToken: string;
  matcher: string;
  buildVersion: string;
  storeId: string;
  primaryStoreId: string;
  secondaryStoreId: string;
  cookies: string;
}

interface StoreInfo {
  storeId: string;
  primaryStoreId: string;
  secondaryStoreId: string;
}

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export class InstamartProvider extends BaseProvider<InstamartCredentials> {
  readonly name = 'instamart';
  readonly needsPuppeteerForSearch = true;

  constructor(browserPool: BrowserPool) {
    super(
      new SessionManager<InstamartCredentials>(
        'instamart',
        config.sessionsDir,
        6, // 6h expiry — cookies expire faster
        creds => !!(creds.deviceId && creds.cookies && creds.matcher)
      ),
      browserPool
    );
  }

  /**
   * Initialize by loading the Instamart homepage.
   * This gives us:
   *   - Session cookies (deviceId, tid, sid, aws-waf-token)
   *   - The `matcher` header (captured from outgoing requests)
   *   - The `x-build-version` header
   *   - Store IDs (primaryStoreId, secondaryStoreId — from the home API URL)
   */
  protected async initializeFromBrowser(page: Page): Promise<void> {
    let capturedMatcher = '';
    let capturedBuildVersion = '2.328.0';
    const capturedStoreInfo: StoreInfo = { storeId: '', primaryStoreId: '', secondaryStoreId: '' };

    // Listen for outgoing requests to capture matcher and store IDs
    const requestHandler = (req: any) => {
      const url: string = req.url();
      if (!url.includes('swiggy.com/api/instamart')) return;

      const headers = req.headers();
      if (headers['matcher']) capturedMatcher = headers['matcher'];
      if (headers['x-build-version']) capturedBuildVersion = headers['x-build-version'];

      // Extract store IDs from the home API URL params
      if (url.includes('/home/v2') && url.includes('storeId=')) {
        try {
          const u = new URL(url);
          const sid = u.searchParams.get('storeId') || '';
          const pid = u.searchParams.get('primaryStoreId') || '';
          const secid = u.searchParams.get('secondaryStoreId') || '';
          if (sid || pid) {
            capturedStoreInfo.storeId = sid;
            capturedStoreInfo.primaryStoreId = pid;
            capturedStoreInfo.secondaryStoreId = secid;
          }
        } catch { /* ignore URL parse error */ }
      }
    };

    page.on('request', requestHandler);

    try {
      await page.goto('https://www.swiggy.com/instamart', {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });
      // Brief pause to let any remaining requests fire
      await new Promise(r => setTimeout(r, 1000));
    } finally {
      page.off('request', requestHandler);
    }

    const browserCookies = await page.cookies();
    const deviceCookie = browserCookies.find(c => c.name === 'deviceId');
    const tidCookie = browserCookies.find(c => c.name === 'tid');
    const sidCookie = browserCookies.find(c => c.name === 'sid');
    const wafCookie = browserCookies.find(c => c.name === 'aws-waf-token');

    this.credentials = {
      deviceId: deviceCookie?.value || '',
      tid: tidCookie?.value || '',
      sid: sidCookie?.value || '',
      awsWafToken: wafCookie?.value || '',
      matcher: capturedMatcher,
      buildVersion: capturedBuildVersion,
      storeId: capturedStoreInfo.storeId,
      primaryStoreId: capturedStoreInfo.primaryStoreId,
      secondaryStoreId: capturedStoreInfo.secondaryStoreId,
      cookies: browserCookies.map(c => `${c.name}=${c.value}`).join('; '),
    };

    await this.saveSession();
    this.log(`Initialized: matcher=${capturedMatcher}, storeId=${capturedStoreInfo.primaryStoreId}, cookies=${browserCookies.length}`);
  }

  protected async resolveStore(location: Location): Promise<string | null> {
    // Set location in the browser's localStorage so the SPA picks it up
    if (this.page && !this.page.isClosed()) {
      try {
        const lat = String(location.lat);
        const lng = String(location.lon);
        await this.page.evaluate(`try { localStorage.setItem('lat','${lat}'); localStorage.setItem('lng','${lng}'); } catch {}`);

        // Reload to apply the new location
        await this.page.reload({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 1000));
        this.log(`Location set in browser localStorage: ${location.lat}, ${location.lon}`);
      } catch {
        this.log('Failed to set location in localStorage', 'error');
      }
    }

    return `instamart_${location.lat}_${location.lon}`;
  }

  protected async doSearch(query: string): Promise<UnifiedProduct[]> {
    if (!this.page || this.page.isClosed()) throw new Error('No Puppeteer page available');
    return this.searchViaNavigation(query);
  }

  /**
   * Search by navigating to the search URL and capturing the API response.
   *
   * Why not page.evaluate(fetch(...))?
   *   Swiggy's AWS WAF blocks fetch() calls even from within the page context
   *   (returns 403 with empty body). But when the SPA's own JS fires the search
   *   request via its React router, the WAF accepts it — likely because the SPA
   *   includes a JS-generated challenge token that our manual fetch doesn't have.
   *
   * So we let the SPA do the work: navigate to the search URL, and capture
   * the response from the network layer.
   */
  private async searchViaNavigation(query: string): Promise<UnifiedProduct[]> {
    return new Promise<UnifiedProduct[]>((resolve) => {
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) { resolved = true; resolve([]); }
      }, 20000);

      const handler = async (response: any) => {
        try {
          const url: string = response.url();
          if (url.includes('/api/instamart/search/v2') && response.status() === 200) {
            const data = await response.json();
            const products = parseInstamartProducts(data);
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(products);
            }
          }
        } catch { /* ignore non-json responses */ }
      };

      this.page!.on('response', handler);

      const searchUrl = `https://www.swiggy.com/instamart/search?custom_back=true&query=${encodeURIComponent(query)}`;
      this.page!.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {
        if (!resolved) { resolved = true; clearTimeout(timeout); resolve([]); }
      });
    });
  }
}
