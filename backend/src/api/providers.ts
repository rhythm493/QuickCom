import { Router, Request, Response } from 'express';
import { ProviderRegistry } from '../providers/registry';

export function createProvidersRouter(registry: ProviderRegistry): Router {
  const router = Router();

  /** GET /api/providers — list all providers with status */
  router.get('/', (_req: Request, res: Response) => {
    const statuses = registry.getAll().map(p => p.getStatus());
    res.json({ providers: statuses });
  });

  /** POST /api/providers/:name/init — force re-initialize a provider */
  router.post('/:name/init', async (req: Request, res: Response) => {
    const name = req.params.name as string;
    const provider = registry.get(name);
    if (!provider) {
      res.status(404).json({ error: `Provider '${name}' not found` });
      return;
    }

    try {
      await provider.teardown();
      await provider.initialize();
      res.json(provider.getStatus());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
