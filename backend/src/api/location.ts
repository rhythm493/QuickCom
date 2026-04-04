import { Router, Request, Response } from 'express';
import { ProviderRegistry } from '../providers/registry';
import { Location } from '../providers/types';

export function createLocationRouter(
  registry: ProviderRegistry,
  getCurrentLocation: () => Location | null,
  setCurrentLocation: (loc: Location) => void
): Router {
  const router = Router();

  /**
   * POST /api/location
   * Body: { lat: number, lon: number, label?: string, providers?: string[] }
   */
  router.post('/', async (req: Request, res: Response) => {
    const { lat, lon, label, providers: providerNames } = req.body;

    if (typeof lat !== 'number' || typeof lon !== 'number') {
      res.status(400).json({ error: 'lat and lon are required numbers' });
      return;
    }

    const location: Location = { lat, lon, label };
    setCurrentLocation(location);

    try {
      const results = await registry.setLocationAll(location, providerNames);
      res.json({ location, results });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * GET /api/location
   * Returns current location and per-provider store IDs
   */
  router.get('/', (_req: Request, res: Response) => {
    const location = getCurrentLocation();
    const providers: Record<string, { storeId: string | null }> = {};

    for (const p of registry.getAll()) {
      const status = p.getStatus();
      providers[p.name] = { storeId: status.storeId };
    }

    res.json({ location, providers });
  });

  return router;
}
