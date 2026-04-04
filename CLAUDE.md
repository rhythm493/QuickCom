# QuickCom

Grocery price comparison service for Indian quick-commerce (Blinkit, Zepto, Swiggy Instamart). REST API consumed by the Nexus Go server via HTTP MCP bridge.

## Status: Refactored (v2.0)

Previous: 1521-line monolith server.js with WebSocket, 90% code duplication across 3 providers.
Current: Clean TypeScript, provider pattern, REST API, SQLite cache with spread snapshots.

## Architecture

```
QuickCom/backend/
├── src/
│   ├── index.ts                    # Express bootstrap, background init
│   ├── config.ts                   # Env-based config
│   ├── providers/
│   │   ├── types.ts                # IProvider, UnifiedProduct, parseQuantity, computePerUnitPrice
│   │   ├── base-provider.ts        # Abstract base with session lifecycle
│   │   ├── session-manager.ts      # Generic SessionManager<T>
│   │   ├── registry.ts             # ProviderRegistry
│   │   ├── blinkit/provider.ts     # page.evaluate(fetch) — Cloudflare bypass
│   │   ├── zepto/provider.ts       # Direct HTTP API — no Puppeteer for search
│   │   └── instamart/provider.ts   # SPA navigation + response capture
│   ├── browser/pool.ts             # Shared BrowserPool (1 Chrome, N pages)
│   ├── cache/                      # SQLite cache system
│   │   ├── cache-manager.ts        # Lookup/store with stale-while-revalidate
│   │   ├── scheduler.ts            # Spread snapshots, pre-warm, cleanup
│   │   ├── darkstore-scanner.ts    # City grid scanning (25 Pune neighborhoods)
│   │   └── config.ts               # TTLs (6h-48h), 48 popular queries
│   └── api/                        # Express routes
│       ├── search.ts               # POST /api/search (with cache integration)
│       ├── location.ts             # POST/GET /api/location
│       ├── providers.ts            # GET /api/providers
│       └── cache.ts                # Stats, price history, darkstores, scan-city
```

## Provider Pattern

Every grocery service implements `IProvider`:
```typescript
interface IProvider {
  readonly name: string;
  readonly needsPuppeteerForSearch: boolean;
  initialize(): Promise<void>;
  setLocation(location: Location): Promise<void>;
  search(query: string): Promise<UnifiedProduct[]>;
  isReady(): boolean;
  getStatus(): ProviderStatus;
  teardown(): Promise<void>;
}
```

### Provider Details

| Provider | Search Method | Auth | Notes |
|----------|-------------|------|-------|
| Blinkit | `page.evaluate(fetch(...))` | Public auth_key constant | Cloudflare blocks direct HTTP; must call from Chrome context |
| Zepto | Direct HTTP (axios) | Session + store_id from LMS API | Force IPv4 (`family: 4`); Pune not serviceable |
| Instamart | SPA navigation capture | matcher + cookies from page | AWS WAF blocks manual fetch; let SPA do the work |

### Adding a New Provider
1. Create `src/providers/{name}/provider.ts` extending `BaseProvider<TCredentials>`
2. Create `src/providers/{name}/parser.ts` returning `UnifiedProduct[]`
3. Register in `src/index.ts`: `registry.register(new FooProvider(browserPool))`

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health + provider statuses |
| POST | `/api/search` | Search products (parallel across providers, cache-integrated) |
| POST | `/api/location` | Set location for all providers |
| GET | `/api/location` | Current location + store IDs |
| GET | `/api/providers` | Provider status list |
| POST | `/api/providers/:name/init` | Force re-initialize a provider |
| GET | `/api/cache/stats` | Cache statistics |
| GET | `/api/price-history` | Price history for a product |
| GET | `/api/best-price` | Cheapest across services |
| GET | `/api/darkstores` | Darkstore listing |
| POST | `/api/scan-city` | Grid scan for darkstores (SSE stream) |

## Cache System

- **SQLite + WAL mode**, 9 tables
- **TTLs**: perishable 6h, staple 24h, non-food 48h, other 12h
- **Stale-while-revalidate**: 1h buffer past TTL
- **48 popular queries** seeded (milk, eggs, rice, atta, etc.)
- **Spread snapshots**: tasks distributed evenly across 24h (no cron library)
- **Pre-warm on boot**: skips items with any cached data
- **Auto-scan**: first boot discovers darkstores via city grid (25 Pune neighborhoods)
- **Schema v2**: brand, quantity_value/unit, product_url, discount_pct, per_unit_price_paise

## Configuration

```env
PORT=5000
DEFAULT_LAT=18.5204
DEFAULT_LON=73.8567
DEFAULT_LOCATION=Kothrud, Pune
CHROME_PATH=/usr/bin/google-chrome-stable
NODE_ENV=development
```

## Development

```bash
# Build
pnpm install && npx tsc

# Run
PORT=5000 node dist/src/index.js

# Test search
curl -X POST http://localhost:5000/api/search -H "Content-Type: application/json" -d '{"query":"milk"}'
```

## Key Decisions
- **REST over WebSocket**: Every interaction is request/response, no need for persistent connections
- **Provider pattern**: Extensible for BigBasket, JioMart, etc.
- **Shared BrowserPool**: One Chrome process, multiple pages (~200MB vs 450MB)
- **Background init**: Server starts instantly, providers init async
- **Cache-first search**: Lookup → serve fresh/stale → live search on miss → store
- **Anti-detection**: `headless: 'new'`, hide `navigator.webdriver`, disable automation features
