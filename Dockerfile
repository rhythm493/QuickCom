# Multi-stage build for QuickCom

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml* ./
COPY frontend/pnpm-workspace.yaml ./
RUN npm install -g pnpm@10 && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

# Stage 2: Build backend TypeScript
FROM node:20-alpine AS backend-build
WORKDIR /app
COPY backend/package.json backend/pnpm-lock.yaml* ./
# pnpm-workspace.yaml carries the onlyBuiltDependencies allowlist. Without it in
# the build context pnpm silently skips every postinstall script, and
# better-sqlite3 ships without its compiled .node binding -- the cache then dies
# at boot with "Could not locate the bindings file" instead of failing the build.
COPY backend/pnpm-workspace.yaml ./
RUN npm install -g pnpm@10 && pnpm install --frozen-lockfile
COPY backend/src/ ./src/
COPY backend/tsconfig.json ./
RUN npx tsc

# Stage 3: Production runtime with Chromium (ARM64 compatible)
FROM node:20

# Install Chromium + Puppeteer deps (works on both amd64 and arm64)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdrm2 \
    libfontconfig1 \
    libgbm1 \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    wget \
    curl \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN chromium --version

WORKDIR /app

# Install production deps only
COPY backend/package.json backend/pnpm-lock.yaml* ./
COPY backend/pnpm-workspace.yaml ./
# --prod must NOT be combined with --ignore-scripts here: the runtime is the only
# stage whose better-sqlite3 copy is actually loaded, so this is where the native
# binding must be compiled. Verify with the assertion below.
RUN npm install -g pnpm@10 && pnpm install --prod --frozen-lockfile \
 && node -e "const D=require('better-sqlite3');new D(':memory:').exec('create table t(a)');console.log('better-sqlite3 native binding OK')"

# Copy compiled backend
COPY --from=backend-build /app/dist ./dist

# Copy frontend build (code expects it at /app/frontend/dist from __dirname)
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create writable dirs. Running as non-root (uid 1000) is required for the
# fail-closed Tailscale exit-node route guard, which identifies app traffic by
# uidrange 1000-1000 in the shared network namespace. It also lets Chromium
# use its own sandbox and gives it a writable HOME for the profile dir.
RUN mkdir -p /app/data /app/.sessions && chown -R node:node /app
USER node

# Environment
ENV NODE_ENV=production
ENV PORT=10000
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:10000/api/health || exit 1

CMD ["node", "dist/src/index.js"]
