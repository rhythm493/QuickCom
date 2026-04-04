# QuickCom

Grocery price comparison API for Indian quick-commerce platforms — Blinkit, Zepto, and Swiggy Instamart.

QuickCom provides a unified REST API that aggregates product data, pricing, and availability across multiple grocery delivery services. Built for programmatic consumption, it handles session management, anti-detection, caching, and data normalization so your application doesn't have to.

A lightweight React frontend is included as a reference implementation, but the primary product is the API.

## What It Does

- **Unified Search** — Query once, get results from all providers in a single response
- **Normalized Data** — Every product follows the same `UnifiedProduct` schema regardless of source
- **Cache-First** — SQLite-backed cache with category-aware TTLs and stale-while-revalidate
- **Auto-Refresh** — Background scheduler keeps popular queries fresh across all darkstores
- **Per-Unit Pricing** — Automatic quantity parsing and per-unit price computation for accurate comparisons
- **Extensible** — Provider pattern makes adding new services (BigBasket, JioMart, etc.) straightforward

## Quick Start

```bash
# Install & build
pnpm install --filter backend
cd backend && npx tsc

# Run
PORT=5000 node dist/src/index.js

# Test
curl -X POST http://localhost:5000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"milk"}'
```

See [CLAUDE.md](./CLAUDE.md) for full API reference, architecture details, and provider documentation.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/health` | Health check + provider statuses |
| `POST` | `/api/search` | Search products across all providers |
| `POST` | `/api/location` | Set delivery location |
| `GET`  | `/api/location` | Get current location |
| `GET`  | `/api/providers` | List provider statuses |
| `GET`  | `/api/cache/stats` | Cache statistics |
| `GET`  | `/api/price-history` | Historical price data |
| `GET`  | `/api/best-price` | Cheapest option across services |
| `GET`  | `/api/darkstores` | List darkstores |
| `POST` | `/api/scan-city` | Discover darkstores via grid scan (SSE) |

## Project Structure

```
QuickCom/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Express bootstrap, background init
│   │   ├── config.ts             # Env-based configuration
│   │   ├── providers/            # Provider pattern (Blinkit, Zepto, Instamart)
│   │   ├── browser/pool.ts       # Shared Chrome instance, multi-page
│   │   ├── cache/                # SQLite cache, scheduler, darkstore scanner
│   │   └── api/                  # Express routes
│   ├── .env.example
│   └── package.json
├── frontend/                     # Optional reference UI
│   └── src/
├── CLAUDE.md                     # Detailed architecture & API docs
└── README.md
```

## Technology Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js, TypeScript |
| API | Express.js (REST) |
| Automation | Puppeteer (shared BrowserPool) |
| Cache | SQLite (WAL mode), stale-while-revalidate |
| Frontend | React, TypeScript, Tailwind CSS, Vite |
| Package Manager | pnpm workspaces |
| Container | Docker (multi-stage build) |

## Configuration

Copy `backend/.env.example` to `backend/.env` and adjust:

```env
PORT=5000
DEFAULT_LAT=18.5204
DEFAULT_LON=73.8567
DEFAULT_LOCATION=Kothrud, Pune
CHROME_PATH=/usr/bin/google-chrome-stable
NODE_ENV=development
```

## Docker

```bash
docker build -t quickcom .
docker run -p 5000:5000 quickcom
```

## Frontend (Optional)

The included React app is a reference consumer for the API. It's not required to use QuickCom — any HTTP client can integrate with the REST endpoints.

```bash
cd frontend
pnpm install
pnpm dev
```

## License

MIT
