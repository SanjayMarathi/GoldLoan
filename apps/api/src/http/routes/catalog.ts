import { Router } from 'express';
import type { GoldRateResponse } from '@gold/shared/types';
import type { Container } from '../../container.ts';
import { asyncHandler } from '../middleware/asyncHandler.ts';

/** GET /loan-schemes, GET /gold-rate, GET /health */
export function catalogRouter(c: Container): Router {
  const router = Router();

  router.get(
    '/loan-schemes',
    asyncHandler(async (_req, res) => {
      const schemes = await c.quoteService.listSchemes();
      res.set('Cache-Control', 'public, max-age=30').json({ data: schemes.map((s) => s.toDto()) });
    }),
  );

  router.get(
    '/gold-rate',
    asyncHandler(async (_req, res) => {
      const rate = await c.quoteService.currentRate();
      const body: GoldRateResponse = {
        ratePerGram24kPaise: rate.ratePerGram24kPaise,
        source: rate.source,
        asOf: rate.asOf.toISOString(),
      };
      res.set('Cache-Control', 'public, max-age=30').json(body);
    }),
  );

  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const dbUp = await c.repositories.ping();
      res.status(dbUp ? 200 : 503).json({
        status: dbUp ? 'ok' : 'degraded',
        storage: c.repositories.kind,
        assistant: c.agent.providerName,
        uptimeSeconds: Math.round(process.uptime()),
      });
    }),
  );

  return router;
}
