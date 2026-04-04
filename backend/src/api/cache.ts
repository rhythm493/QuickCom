import { Router, Request, Response } from 'express';
import { cacheManager } from '../cache/cache-manager';
import { priceTracker } from '../cache/price-tracker';
import { darkstoreTracker } from '../cache/darkstore-tracker';
import { scanCity, getAvailableCities } from '../cache/darkstore-scanner';

export function createCacheRouter(): Router {
  const router = Router();

  /** GET /api/cache/stats */
  router.get('/stats', (_req: Request, res: Response) => {
    res.json(cacheManager.getStats());
  });

  /** GET /api/price-history?service=X&productId=Y&days=N */
  router.get('/price-history', (req: Request, res: Response) => {
    const service = req.query.service as string;
    const productId = req.query.productId as string;
    const days = parseInt(req.query.days as string || '30', 10);

    if (!service || !productId) {
      res.status(400).json({ error: 'service and productId are required' });
      return;
    }

    const history = priceTracker.getHistory(service, productId, days);
    res.json({ service, productId, days, history });
  });

  /** GET /api/best-price?query=X&locationId=Y */
  router.get('/best-price', (req: Request, res: Response) => {
    const query = req.query.query as string;
    const locationId = parseInt(req.query.locationId as string || '1', 10);

    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const results = priceTracker.getBestPrice(query, locationId);
    res.json({ query, locationId, results });
  });

  /** GET /api/darkstores?city=X&locationId=N */
  router.get('/darkstores', (req: Request, res: Response) => {
    const city = req.query.city as string | undefined;
    if (city) {
      res.json(darkstoreTracker.getDarkstoresByCity(city));
    } else {
      res.json(darkstoreTracker.getAllDarkstoresWithLocation());
    }
  });

  /** GET /api/darkstores/stats */
  router.get('/darkstores/stats', (_req: Request, res: Response) => {
    res.json(darkstoreTracker.getDarkstoreStats());
  });

  /** GET /api/scan-cities — list available city grids */
  router.get('/scan-cities', (_req: Request, res: Response) => {
    res.json({ cities: getAvailableCities() });
  });

  /** POST /api/scan-city — scan a city for darkstores (SSE stream) */
  router.post('/scan-city', (req: Request, res: Response) => {
    const { city } = req.body;
    if (!city) {
      res.status(400).json({ error: 'city is required' });
      return;
    }

    const available = getAvailableCities();
    if (!available.includes(city.toLowerCase())) {
      res.status(400).json({ error: `Unknown city. Available: ${available.join(', ')}` });
      return;
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    scanCity(city, (progress) => {
      res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
    }).then(result => {
      res.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
    }).catch(err => {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

    req.on('close', () => { /* client disconnected, scan continues in background */ });
  });

  return router;
}
