import { Request, Response, NextFunction } from 'express';

/** Global error handler */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[API] Error:', err.message);
  res.status(500).json({ error: err.message });
}

/** Request logging (lightweight, replaces morgan for API routes) */
export function requestLogger(req: Request, _res: Response, next: NextFunction): void {
  console.log(`[API] ${req.method} ${req.path}`);
  next();
}
