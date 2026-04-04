import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { BaseProvider } from '../base-provider';
import { SessionManager } from '../session-manager';
import { Location, UnifiedProduct } from '../types';
import { BrowserPool } from '../../browser/pool';
import { config } from '../../config';
import { parseZeptoProducts } from './parser';
import type { Page } from 'puppeteer';

interface ZeptoCredentials {
  sessionId: string;
  deviceId: string;
  storeId: string;
  storeIds: string;
  storeEtas: string;
  // XSRF and cookies are optional — direct API works without them
  xsrfToken: string;
  csrfSecret: string;
  cookies: string;
  appVersion: string;
}

// Current app version — captured from live browser requests
// Update this if requests start failing with version-related errors
const APP_VERSION = '14.30.1';

const COMPATIBLE_COMPONENTS =
  'CONVENIENCE_FEE,RAIN_FEE,EXTERNAL_COUPONS,STANDSTILL,BUNDLE,MULTI_SELLER_ENABLED,NEW_FEE_STRUCTURE,NEW_BILL_INFO,ZEPTO_PASS,CART_REDESIGN_ENABLED,HOMEPAGE_V2,SUPER_SAVER:1,HP_V4_FEED';

// Force IPv4 — bff-gateway.zepto.com has IPv6 addresses that are unreachable
// from many environments, causing ETIMEDOUT errors when Node tries IPv6 first.
const ipv4Agent = new https.Agent({ family: 4 });

export class ZeptoProvider extends BaseProvider<ZeptoCredentials> {
  readonly name = 'zepto';

  // No longer needs Puppeteer for search — direct API works without XSRF tokens.
  // Puppeteer is only used during initialization to capture the live session if
  // the saved session doesn't have a storeId yet.
  readonly needsPuppeteerForSearch = false;

  private httpClient: AxiosInstance;

  constructor(browserPool: BrowserPool) {
    super(
      new SessionManager<ZeptoCredentials>(
        'zepto',
        config.sessionsDir,
        // Sessions stay valid for 7 days (store IDs don't change frequently)
        7 * 24,
        creds => !!(creds.sessionId && creds.storeId)
      ),
      browserPool
    );

    this.httpClient = axios.create({
      baseURL: 'https://bff-gateway.zepto.com',
      timeout: 15000,
      httpsAgent: ipv4Agent, // Force IPv4 to avoid ETIMEDOUT on IPv6 addresses
    });
  }

  /**
   * Initialize from browser: capture app version and session cookies.
   *
   * This is only called when no valid saved session exists. We use Puppeteer
   * to navigate to zepto.com and capture the real app_version and cookies
   * from a live search request, which ensures we have up-to-date values.
   *
   * The critical insight: Zepto's search API does NOT require XSRF tokens
   * when called server-side — only store_id and basic session identifiers
   * are needed. We capture them here for completeness / future use.
   */
  protected async initializeFromBrowser(page: Page): Promise<void> {
    this.log('Capturing session from browser...');

    // Enable request interception so we can read request headers
    // (without interception, response.json() can fail on preflight responses)
    await page.setRequestInterception(true);

    let capturedHeaders: Record<string, string> | null = null;

    page.on('request', (request: any) => {
      const url: string = request.url();
      if (
        url.includes('user-search-service/api/v3/search') &&
        !url.includes('filters') &&
        !url.includes('autosuggest') &&
        request.method() === 'POST'
      ) {
        capturedHeaders = request.headers() as Record<string, string>;
      }
      request.continue();
    });

    // Visit homepage to establish session cookies
    this.log('Visiting zepto.com homepage...');
    await page.goto('https://www.zepto.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await new Promise(r => setTimeout(r, 1000));

    // Navigate to search to trigger the search API call
    // Use domcontentloaded (not networkidle2) to avoid 30s wait; the API
    // call fires well before the page finishes all network activity.
    this.log('Triggering search to capture headers...');
    page.goto(`https://www.zepto.com/search?query=milk`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }).catch(() => {/* navigation errors are expected during interception */});

    // Wait up to 15s for the search request to be captured
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (capturedHeaders) { clearInterval(interval); resolve(); }
      }, 200);
      setTimeout(() => { clearInterval(interval); resolve(); }, 15000);
    });

    if (capturedHeaders) {
      const h = capturedHeaders;
      this.credentials = {
        sessionId: h['session_id'] || h['sessionid'] || uuidv4(),
        deviceId: h['device_id'] || h['deviceid'] || uuidv4(),
        storeId: h['store_id'] || h['storeid'] || '',
        storeIds: h['store_ids'] || h['store_id'] || h['storeid'] || '',
        storeEtas: h['store_etas'] || '',
        xsrfToken: h['x-xsrf-token'] || '',
        csrfSecret: h['x-csrf-secret'] || '',
        cookies: '',
        appVersion: h['app_version'] || h['appversion'] || APP_VERSION,
      };
      this.log(`Captured session — storeId: ${this.credentials.storeId}, appVersion: ${this.credentials.appVersion}`);
    } else {
      // Fallback: generate fresh identifiers and rely on resolveStore
      this.log('No search request captured — falling back to generated identifiers');
      const browserCookies = await page.cookies();
      const cookieStr = browserCookies.map(c => `${c.name}=${c.value}`).join('; ');

      const xsrfCookie = browserCookies.find(c => c.name === 'XSRF-TOKEN');
      const xsrfToken = xsrfCookie
        ? (() => { try { return decodeURIComponent(xsrfCookie.value); } catch { return xsrfCookie.value; } })()
        : '';

      this.credentials = {
        sessionId: browserCookies.find(c => c.name === 'session_id')?.value || uuidv4(),
        deviceId: browserCookies.find(c => c.name === 'device_id')?.value || uuidv4(),
        storeId: '',
        storeIds: '',
        storeEtas: '',
        xsrfToken,
        csrfSecret: browserCookies.find(c => c.name === 'csrfSecret')?.value || '',
        cookies: cookieStr,
        appVersion: APP_VERSION,
      };
    }

    await this.saveSession();
  }

  /**
   * Resolve store ID for a given location.
   *
   * Calls the LMS homepage API with lat/lon to get the serving store.
   * Note: Zepto is only available in select Indian cities. If the location
   * is not serviceable, storeId will remain empty and searches will return [].
   */
  protected async resolveStore(location: Location): Promise<string | null> {
    try {
      const creds = this.credentials;
      const headers = this.buildBaseHeaders(creds);

      const response = await this.httpClient.post(
        '/lms/api/v2/get_page',
        { pageType: 'HOME', latitude: location.lat, longitude: location.lon },
        { headers }
      );

      const data = response.data;
      const serviceableResp = data?.storeServiceableResponse;

      if (!serviceableResp?.serviceable) {
        this.log(`Location (${location.lat}, ${location.lon}) is not serviceable by Zepto`);
        return null;
      }

      const storeId = serviceableResp.storeId as string | undefined;
      if (!storeId) {
        this.log('LMS API returned serviceable=true but no storeId');
        return null;
      }

      // Update credentials with the resolved store info
      if (creds) {
        creds.storeId = storeId;
        creds.storeIds = storeId;
        creds.storeEtas = JSON.stringify({ [storeId]: -1 });
        await this.saveSession();
      }

      this.log(`Resolved store: ${storeId}`);
      return storeId;
    } catch (err) {
      this.log(`resolveStore failed: ${err instanceof Error ? err.message : err}`, 'error');
      return null;
    }
  }

  protected async doSearch(query: string): Promise<UnifiedProduct[]> {
    if (!this.storeId) {
      this.log('No storeId — location may not be serviceable by Zepto');
      return [];
    }
    return this.searchViaApi(query);
  }

  /**
   * Direct API search — no Puppeteer needed.
   *
   * Key findings from reverse engineering:
   * - XSRF tokens are NOT required for server-side calls
   * - store_id is required (from resolveStore)
   * - Force IPv4 via httpsAgent to avoid ETIMEDOUT on IPv6
   * - app_version header must match a real value (captured during init)
   */
  private async searchViaApi(query: string): Promise<UnifiedProduct[]> {
    const creds = this.credentials;
    const storeId = this.storeId!;

    const sessionId = creds?.sessionId || uuidv4();
    const requestId = uuidv4();

    const headers = {
      ...this.buildBaseHeaders(creds),
      'store_id': storeId,
      'storeid': storeId,
      'store_ids': creds?.storeIds || storeId,
      'store_etas': creds?.storeEtas || JSON.stringify({ [storeId]: -1 }),
      'request_id': requestId,
      'requestid': requestId,
      // Include auth headers if available (captured from browser)
      ...(creds?.xsrfToken ? {
        'x-xsrf-token': creds.xsrfToken,
        'auth_from_cookie': 'true',
        'auth_revamp_flow': 'v2',
        'x-without-bearer': 'true',
      } : {}),
      ...(creds?.csrfSecret ? { 'x-csrf-secret': creds.csrfSecret } : {}),
      ...(creds?.cookies ? { 'cookie': creds.cookies } : {}),
    };

    const response = await this.httpClient.post(
      '/user-search-service/api/v3/search',
      {
        query,
        pageNumber: 0,
        mode: 'SHOW_ALL_RESULTS',
        userSessionId: sessionId,
      },
      { headers }
    );

    return parseZeptoProducts(response.data);
  }

  /**
   * Build headers that are always needed (without auth or store-specific ones).
   */
  private buildBaseHeaders(creds: ZeptoCredentials | null): Record<string, string> {
    const appVersion = creds?.appVersion || APP_VERSION;
    const sessionId = creds?.sessionId || uuidv4();
    const deviceId = creds?.deviceId || uuidv4();

    return {
      'platform': 'WEB',
      'app_sub_platform': 'WEB',
      'app_version': appVersion,
      'appversion': appVersion,
      'tenant': 'ZEPTO',
      'marketplace_type': 'SUPER_SAVER',
      'source': 'DIRECT',
      'content-type': 'application/json',
      'accept': 'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'referer': 'https://www.zepto.com/',
      'origin': 'https://www.zepto.com',
      'session_id': sessionId,
      'sessionid': sessionId,
      'device_id': deviceId,
      'deviceid': deviceId,
      'compatible_components': COMPATIBLE_COMPONENTS,
    };
  }
}
