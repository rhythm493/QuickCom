# QuickCom

Grocery price comparison service for Indian quick-commerce (Blinkit, Zepto, Swiggy Instamart). REST API consumed by the Nexus Go server via HTTP MCP bridge.

## Status: Refactored (v2.0), deployed

Previous: 1521-line monolith server.js with WebSocket, 90% code duplication across 3 providers.
Current: Clean TypeScript, provider pattern, REST API, SQLite cache with spread snapshots.

Running on `trading-eu` (Contabo, France) with all provider egress tunnelled to Pune, India
via a Tailscale exit node — see [Deployment](#deployment-trading-eu-vmi3461756).

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
| GET | `/api/cache/price-history` | Price history for a product (`?name=`&store_id=`) |
| GET | `/api/cache/best-price` | Cheapest across services |
| GET | `/api/cache/darkstores` | Darkstore listing |
| GET | `/api/cache/darkstores/stats` | Darkstore count/coverage |
| GET | `/api/cache/scan-cities` | Cities already scanned |
| POST | `/api/cache/scan-city` | Grid scan for darkstores (SSE stream) |

> All cache read endpoints live under the `/api/cache/*` prefix. The frontend calls
> them from `AnalyticsView.tsx` and `CacheStatsCard.tsx` — keep the paths in sync.

### Response shape contract (consumed by Nexus)

`POST /api/search` returns `{ results: { <provider>: SearchResult }, searchTimeMs }`
where `SearchResult` is `{ products: UnifiedProduct[], totalFound, searchTimeMs, cached, stale }`.

`UnifiedProduct` money fields are **integers in paise**: `pricePaise`, `mrpPaise`,
`perUnitPricePaise`, plus string convenience fields `priceDisplay`/`mrpDisplay`,
and `quantityValue`/`quantityUnit`.

**Both the live-miss branch and the cache-hit branch of `api/search.ts` MUST return
`UnifiedProduct`-shaped objects.** The cache stores a narrower `CachedProduct` row
(string `price`/`originalPrice`/`savings`), so `api/search.ts` maps it back through
`toUnifiedProduct()`. This was a real bug: Nexus's Go client only models the
`UnifiedProduct` field names, so any cache hit decoded to `pricePaise: 0` and an empty
`priceDisplay` — i.e. grocery results showed price 0 to the user *and* to the LLM.
If you touch the cache schema, re-check `CachedProduct` (`cache/types.ts`) vs
`UnifiedProduct` (`providers/types.ts`).

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
CHROME_PATH=/usr/bin/google-chrome-stable      # local dev only
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium   # container (Alpine chromium package)
DATA_DIR=/app/data
SESSIONS_DIR=/app/.sessions
DB_PATH=/app/data/quickcom.db
NODE_ENV=development
```

`DATA_DIR` / `SESSIONS_DIR` / `DB_PATH` **must be set in the container**. The defaults in
`config.ts` resolve relative to `__dirname`, which under the Dockerfile is `/app/dist/src`
— i.e. `/app/dist/data`, while the compose stack mounts `/app/data`. Without the env vars
the SQLite cache is silently discarded on every container recreate. This is why the
`Dockerfile` must keep the two paths in sync with `stacks/quickcom-trading-eu.yml`.

## Deployment: trading-eu (`vmi3461756`)

Live deployment (no Portainer — plain `docker compose`):

| Item | Value |
|------|-------|
| Host | Contabo `vmi3461756`, public `169.58.66.151`, Tailscale `100.94.48.41` (Lauterbourg, France) |
| Source clone | `/opt/quickcom/src` (git clone of `rhythm493/QuickCom`) |
| Compose file | `/opt/quickcom/docker-compose.yml` (from `stacks/quickcom-trading-eu.yml`) |
| Images | `quickcom:local`, `tailscale/tailscale:v1.102.3` — built on-host, **not** pulled from GHCR |
| Containers | `quickcom` (healthy), `ts-quickcom` (exit-node sidecar) |
| Port | `127.0.0.1:10000` only — not publicly exposed; reached over `nexus_net` |
| Egress | Tailscale exit node → `100.124.244.55` (dietpi, Pune, IN, `122.167.113.141`) |

```bash
ssh trading-eu
cd /opt/quickcom && sudo docker compose up -d
sudo docker exec quickcom node -e "fetch('http://127.0.0.1:10000/api/health').then(r=>r.text()).then(console.log)"
```

### Why the Tailscale exit-node sidecar is mandatory

All three providers are geo-fenced to India, and the host is in France:

| Provider | From France | From Pune (via exit node) |
|----------|-------------|---------------------------|
| Blinkit | 200 with data (works either way) | works |
| Zepto | CloudFront `403 Request blocked` | works |
| Instamart | AWS WAF `We'll be back shortly` | works |

Blinkit succeeding from France is a **trap**: it makes the deployment look healthy while
Zepto and Instamart silently return zero products. Zepto is also not serviceable in Pune
at all, so it will legitimately return nothing regardless of egress.

`ts-quickcom` is a Tailscale sidecar (`NET_ADMIN` + `NET_RAW`, `/dev/net/tun`,
`TS_STATE_DIR=/state`, state persisted at `/srv/quickcom/tailscale`) that runs
`tailscale up --exit-node=100.124.244.55 --exit-node-allow-lan-access`. The `quickcom`
container joins it with `network_mode: "service:ts-quickcom"`, so both share a netns and
QuickCom's TCP/UDP egresses from Pune.

Two things about the sidecar's `entrypoint` supervisor are load-bearing — do not
"simplify" them back to `containerboot`:

1. **No `containerboot`.** It enforces a 60s interactive-login deadline and then exits,
   which restarts the container and *rotates the netns*, silently orphaning `quickcom`
   (which is bound to the old netns via `network_mode: service:`). The supervisor runs
   `tailscaled` directly and keeps the netns stable across re-auth.
2. **The fail-closed guard is installed BEFORE `tailscaled` starts, in a background
   subshell.** It runs `ip route replace unreachable default table 9999` plus a
   bridge-local route for `172.30.0.0/24`, and a loop that adds
   `ip rule add pref 5265 uidrange 1000-1000 lookup 9999` whenever `ip route show
   table 52` has no `default` (removing it when the default appears). The app runs as
   `uid 1000` (`node`, from `USER node` in the Dockerfile); `tailscaled` runs as root.
   Net effect: **QuickCom can never fall back to `eth0`** — if the tunnel is down, search
   returns `{"results":{}}` rather than silently querying Indian stores from a French IP.

   Note the *older* `ts-arr` sidecar in `/opt/arr/docker-compose.yml` sequences the guard
   **after** `tailscale up`. That is a latent bug there (masked today because ts-arr is
   already authenticated), not a pattern to copy.

The sidecar still needs a one-time interactive login. Until it is authorized the node
prints a URL of the form `https://login.tailscale.com/a/<hex>`; the sidecar keeps
retrying and QuickCom correctly returns zero results until that is done.

Host-level complement: `/usr/local/sbin/qbt-egress.sh` (systemd unit `qbt-egress.service`)
installs a `QBT-EGRESS` chain in `DOCKER-USER` that drops unmarked traffic from the
`ts-arr` and `ts-quickcom` netns (v4 + v6) while allowing the tailnet, Docker bridges,
and `tailscaled`'s own control-plane traffic out. It guards the *host*, the `ip rule`
guard guards the *netns*.

### Notes / gotchas

- **`pnpm-workspace.yaml` must be a real YAML list.** pnpm 10+ aborts the install with
  `ERR_PNPM_IGNORED_BUILDS` unless every dependency that needs a build script is
  allowlisted. `backend/pnpm-workspace.yaml` must contain
  `onlyBuiltDependencies:` / `  - better-sqlite3` as separate lines — a quoted flow
  string like `onlyBuiltDependencies: '['better-sqlite3']'` is silently ignored. The
  Dockerfile also pins `npm install -g pnpm@10` in all three stages.
- **`npx tsc --noEmit` fails locally** with
  `TS5108: Option 'moduleResolution=node10' has been removed` — the locally installed
  TypeScript is newer than `tsconfig.json` expects. Pre-existing, not a regression; the
  Docker build pins its own TS and is unaffected.
- `chromium` in the image needs `--no-sandbox` (already passed via `BrowserPool`) and
  `shm_size: 1gb`, otherwise Chrome crashes on shared-memory exhaustion.
- No API keys are required by QuickCom. The only "google" hits in the repo are Google
  Analytics beacons inside captured Blinkit research logs.

## Known issues (unfixed, deliberate)

- **The frontend still speaks WebSocket; the backend is REST-only.** `frontend/src/App.tsx`
  (~lines 100–432: `getWebsocketUrl`, `initializeWebSocket`, auto-reconnect, message
  parsing) opens `new WebSocket(...)` and sends `{type:"search"|"set-location", ...}`
  frames. The v2.0 backend has no WS server, so the bundled UI cannot search. The backend
  and the Nexus integration are unaffected. Fixing this is a ~300-line protocol rewrite.
- **`frontend/.env.production` is stale and never reaches the image.** It sets
  `VITE_WS_URL=wss://quickcom.onrender.com` (a dead Render host), sets no `VITE_API_URL`,
  and is excluded by `.dockerignore`. Components therefore fall back to
  `http://localhost:5000` while the container serves `10000`.
- **No test suite and no CI lint/test job.** `.github/workflows/docker.yml` only builds
  and pushes `ghcr.io/rhythm493/quickcom:main`; there is nothing to catch a regression.
- **GHCR package looks private** (anonymous manifest request returns 401). Since
  trading-eu builds locally this is not currently biting, but a consumer pulling
  `ghcr.io/rhythm493/quickcom` needs registry credentials.
- The workflow pushes but never deploys; the trading-eu stack is updated manually.

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
