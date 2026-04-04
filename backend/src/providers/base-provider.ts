import { IProvider, Location, ProviderStatus, UnifiedProduct } from './types';
import { SessionManager } from './session-manager';
import { BrowserPool } from '../browser/pool';
import { config } from '../config';
import type { Page } from 'puppeteer';

/**
 * Abstract base provider — shared lifecycle, session management, and logging.
 * Each service (Blinkit, Zepto, Instamart) extends this.
 */
export abstract class BaseProvider<TCredentials> implements IProvider {
  abstract readonly name: string;
  abstract readonly needsPuppeteerForSearch: boolean;

  protected location: Location | null = null;
  protected storeId: string | null = null;
  protected credentials: TCredentials | null = null;
  protected page: Page | null = null;
  protected _initialized = false;
  protected _initializing = false;
  protected _error: string | null = null;

  constructor(
    protected session: SessionManager<TCredentials>,
    protected browserPool: BrowserPool
  ) {}

  async initialize(): Promise<void> {
    if (this._initialized || this._initializing) return;
    this._initializing = true;
    this._error = null;

    try {
      // Try saved session first (fast path)
      const savedCreds = await this.session.load();
      if (savedCreds) {
        this.credentials = savedCreds;
        this.log('Restored from saved session');

        // If this provider can work without Puppeteer, we're done
        if (!this.needsPuppeteerForSearch) {
          this._initialized = true;
          this._initializing = false;
          return;
        }
      }

      // Need Puppeteer: get a page from the shared pool
      if (this.needsPuppeteerForSearch || !this.credentials) {
        this.log('Initializing with Puppeteer...');
        this.page = await this.browserPool.getPage(this.name);
        await this.initializeFromBrowser(this.page);
        this.log('Puppeteer initialization complete');
      }

      this._initialized = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this._error = msg;
      this.log(`Initialization failed: ${msg}`, 'error');
    } finally {
      this._initializing = false;
    }
  }

  async setLocation(location: Location): Promise<void> {
    this.location = location;
    this.log(`Setting location: ${location.label || `${location.lat},${location.lon}`}`);
    this.storeId = await this.resolveStore(location);
    this.log(`Store resolved: ${this.storeId || 'none'}`);
  }

  async search(query: string): Promise<UnifiedProduct[]> {
    if (!this.isReady()) {
      throw new Error(`${this.name} is not ready. Call initialize() and setLocation() first.`);
    }
    const start = Date.now();
    const products = await this.doSearch(query);
    this.log(`Search "${query}": ${products.length} products in ${Date.now() - start}ms`);
    return products;
  }

  isReady(): boolean {
    return this._initialized && this.location !== null && !this._error;
  }

  getStatus(): ProviderStatus {
    return {
      name: this.name,
      initialized: this._initialized,
      initializing: this._initializing,
      sessionValid: this.credentials !== null,
      sessionExpiresAt: null, // Filled by subclass if needed
      location: this.location,
      storeId: this.storeId,
      needsPuppeteer: this.needsPuppeteerForSearch,
      error: this._error,
    };
  }

  async teardown(): Promise<void> {
    if (this.page) {
      await this.browserPool.releasePage(this.name);
      this.page = null;
    }
    this._initialized = false;
    this.credentials = null;
    this.log('Torn down');
  }

  // --- Abstract methods each provider must implement ---

  /** Initialize credentials from a Puppeteer page (navigate, capture tokens, etc.) */
  protected abstract initializeFromBrowser(page: Page): Promise<void>;

  /** Resolve store ID for a location (API call or header-based) */
  protected abstract resolveStore(location: Location): Promise<string | null>;

  /** Execute a product search — return normalized products */
  protected abstract doSearch(query: string): Promise<UnifiedProduct[]>;

  // --- Helpers ---

  protected log(message: string, level: 'info' | 'error' = 'info'): void {
    const prefix = `[${this.name}]`;
    if (level === 'error') {
      console.error(prefix, message);
    } else {
      console.log(prefix, message);
    }
  }

  /** Save current credentials to disk */
  protected async saveSession(): Promise<void> {
    if (this.credentials) {
      await this.session.save(this.credentials);
    }
  }
}
