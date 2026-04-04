import puppeteer, { Browser, Page } from 'puppeteer';
import { config } from '../config';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Shared browser pool — one Chromium process, one page per provider.
 * Cuts memory from ~450MB (3 browsers) to ~200MB (1 browser, 3 pages).
 *
 * Anti-detection: uses `headless: 'new'` (less detectable than old headless),
 * hides `navigator.webdriver`, and disables automation-revealing features.
 * This is required because Swiggy's AWS WAF blocks old-style headless Chrome.
 */
export class BrowserPool {
  private browser: Browser | null = null;
  private pages = new Map<string, Page>();
  private launching: Promise<Browser> | null = null;

  /** Get or launch the shared browser */
  async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;

    // Prevent multiple concurrent launches
    if (this.launching) return this.launching;

    this.launching = this.launch();
    try {
      this.browser = await this.launching;
      return this.browser;
    } finally {
      this.launching = null;
    }
  }

  /** Get (or create) a dedicated page for a provider */
  async getPage(providerName: string): Promise<Page> {
    const existing = this.pages.get(providerName);
    if (existing && !existing.isClosed()) return existing;

    const browser = await this.getBrowser();
    const page = await browser.newPage();

    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(DEFAULT_USER_AGENT);

    // Hide webdriver property to pass WAF bot detection
    await page.evaluateOnNewDocument('Object.defineProperty(navigator, "webdriver", { get: () => false })');

    this.pages.set(providerName, page);
    console.log(`[BrowserPool] Created page for ${providerName}`);
    return page;
  }

  /** Release (close) a provider's page */
  async releasePage(providerName: string): Promise<void> {
    const page = this.pages.get(providerName);
    if (page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    this.pages.delete(providerName);
  }

  /** Close everything */
  async closeAll(): Promise<void> {
    for (const [name, page] of this.pages) {
      if (!page.isClosed()) {
        await page.close().catch(() => {});
      }
      this.pages.delete(name);
    }

    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }

    console.log('[BrowserPool] All resources closed');
  }

  private async launch(): Promise<Browser> {
    console.log(`[BrowserPool] Launching Chrome: ${config.chromePath}`);
    const browser = await puppeteer.launch({
      // 'new' headless mode is less detectable by WAFs than the old mode
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headless: 'new' as any,
      executablePath: config.chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
        '--no-first-run',
      ],
    });

    console.log('[BrowserPool] Chrome launched');
    return browser;
  }
}
