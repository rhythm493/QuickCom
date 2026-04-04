import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { BrowserPool } from './browser/pool';
import { ProviderRegistry } from './providers/registry';
import { Location } from './providers/types';
import { BlinkitProvider } from './providers/blinkit/provider';
import { ZeptoProvider } from './providers/zepto/provider';
import { InstamartProvider } from './providers/instamart/provider';
import { createApiRouter } from './api/router';
import { errorHandler, requestLogger } from './api/middleware';
import { getDb, closeDb } from './cache/database';
import { scheduler } from './cache/scheduler';
import { darkstoreTracker } from './cache/darkstore-tracker';
import { scanCity, getAvailableCities } from './cache/darkstore-scanner';

// --- State ---
let currentLocation: Location | null = null;

function getCurrentLocation(): Location | null {
  return currentLocation;
}

function setCurrentLocation(loc: Location): void {
  currentLocation = loc;
}

// --- Bootstrap ---
async function main(): Promise<void> {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use('/api', requestLogger);

  // Initialize cache database
  try {
    getDb();
    console.log('[QuickCom] Cache database initialized');
  } catch (err) {
    console.error('[QuickCom] Cache database failed to initialize:', err);
  }

  // Shared browser pool
  const browserPool = new BrowserPool();

  // Provider registry
  const registry = new ProviderRegistry();
  registry.register(new BlinkitProvider(browserPool));
  registry.register(new ZeptoProvider(browserPool));
  registry.register(new InstamartProvider(browserPool));

  // API routes
  app.use('/api', createApiRouter(registry, getCurrentLocation, setCurrentLocation));

  // Serve frontend (if built)
  const frontendPath = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
  app.use(express.static(frontendPath));
  app.get('*', (_req, res, next) => {
    // Only serve index.html for non-API routes
    if (_req.path.startsWith('/api')) return next();
    res.sendFile(path.join(frontendPath, 'index.html'), err => {
      if (err) next(); // No frontend build, that's fine
    });
  });

  // Error handler
  app.use(errorHandler);

  // Start server immediately
  const server = app.listen(config.port, () => {
    console.log(`[QuickCom] Server listening on port ${config.port}`);
    console.log(`[QuickCom] Providers: ${registry.getNames().join(', ')}`);
  });

  // Background init: set default location + initialize providers
  currentLocation = config.defaultLocation;
  console.log(`[QuickCom] Default location: ${currentLocation.label} (${currentLocation.lat}, ${currentLocation.lon})`);

  // Initialize providers in background (non-blocking)
  (async () => {
    console.log('[QuickCom] Background init: starting provider initialization...');
    await registry.initializeAll();

    // Set location on all initialized providers
    console.log('[QuickCom] Background init: setting location on providers...');
    const results = await registry.setLocationAll(currentLocation!);
    for (const [name, result] of Object.entries(results)) {
      if (result.success) {
        console.log(`[QuickCom] ${name}: location set`);
      } else {
        console.error(`[QuickCom] ${name}: location failed - ${result.error}`);
      }
    }

    console.log('[QuickCom] Background init complete');
    const ready = registry.getReady();
    console.log(`[QuickCom] Ready providers: ${ready.map(p => p.name).join(', ') || 'none'}`);

    // Auto-scan for darkstores if none exist (first boot)
    const existingDarkstores = darkstoreTracker.getActiveDarkstores();
    if (existingDarkstores.length === 0) {
      const cities = getAvailableCities();
      if (cities.length > 0) {
        console.log(`[QuickCom] No darkstores found — running first-time scan for: ${cities.join(', ')}`);
        for (const city of cities) {
          try {
            const result = await scanCity(city, (p) => {
              if (p.done) console.log(`[QuickCom] Scan ${p.service}: ${p.storesFound} stores`);
            });
            console.log(`[QuickCom] ${city} scan complete: ${result.totalStores} darkstores in ${Math.round(result.durationMs / 1000)}s`);
          } catch (err) {
            console.error(`[QuickCom] Scan failed for ${city}:`, err);
          }
        }
      }
    } else {
      console.log(`[QuickCom] ${existingDarkstores.length} active darkstores found, skipping scan`);
    }

    // Register providers with scheduler and start
    for (const provider of registry.getAll()) {
      scheduler.registerProvider(provider);
    }

    // Pre-warm cache with popular queries
    await scheduler.preWarm();

    // Start spread snapshots + hourly cleanup
    scheduler.start();
  })().catch(err => {
    console.error('[QuickCom] Background init failed:', err);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[QuickCom] ${signal} received, shutting down...`);
    server.close();
    scheduler.stop();
    await registry.teardownAll();
    await browserPool.closeAll();
    closeDb();
    console.log('[QuickCom] Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  console.error('[QuickCom] Fatal error:', err);
  process.exit(1);
});
