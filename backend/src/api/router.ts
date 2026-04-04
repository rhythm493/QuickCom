import { Router } from 'express';
import { ProviderRegistry } from '../providers/registry';
import { Location } from '../providers/types';
import { createSearchRouter } from './search';
import { createLocationRouter } from './location';
import { createProvidersRouter } from './providers';
import { createCacheRouter } from './cache';

export function createApiRouter(
  registry: ProviderRegistry,
  getCurrentLocation: () => Location | null,
  setCurrentLocation: (loc: Location) => void
): Router {
  const router = Router();

  // Health check
  router.get('/health', (_req, res) => {
    const providers = registry.getAll().map(p => ({
      name: p.name,
      ready: p.isReady(),
      status: p.getStatus(),
    }));

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      location: getCurrentLocation(),
      providers,
    });
  });

  // Mount sub-routers
  router.use('/search', createSearchRouter(registry));
  router.use('/location', createLocationRouter(registry, getCurrentLocation, setCurrentLocation));
  router.use('/providers', createProvidersRouter(registry));
  router.use('/cache', createCacheRouter());

  return router;
}
