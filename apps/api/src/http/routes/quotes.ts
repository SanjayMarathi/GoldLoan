import { Router } from 'express';
import { QuoteRequestSchema } from '@gold/shared/schemas';
import type { Container } from '../../container.ts';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { validateBody } from '../middleware/validate.ts';

/** POST /quotes – a pure calculation, no database write. */
export function quotesRouter(c: Container): Router {
  const router = Router();

  router.post(
    '/quotes',
    validateBody(QuoteRequestSchema),
    asyncHandler(async (req, res) => {
      const quote = await c.quoteService.quote(req.body);
      res.set('Cache-Control', 'no-store').json(quote);
    }),
  );

  return router;
}
