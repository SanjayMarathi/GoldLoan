import { Router } from 'express';
import { ChatConfirmRequestSchema, ChatMessageRequestSchema } from '@gold/shared/schemas';
import type { Container } from '../../container.ts';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { validateBody } from '../middleware/validate.ts';

/** The AI Loan Assist agent. The browser only ever talks to these two endpoints – never to an LLM. */
export function chatRouter(c: Container): Router {
  const router = Router();

  router.post(
    '/chat',
    rateLimit(c.limiters.chat),
    validateBody(ChatMessageRequestSchema),
    asyncHandler(async (req, res) => {
      const reply = await c.agent.handleMessage(req.body.sessionId, req.body.message);
      res.set('Cache-Control', 'no-store').json(reply);
    }),
  );

  /** The confirmation step: only a click on the summary card can file an application. */
  router.post(
    '/chat/confirm',
    rateLimit(c.limiters.chat),
    validateBody(ChatConfirmRequestSchema),
    asyncHandler(async (req, res) => {
      const reply = await c.agent.handleConfirmation(req.body.sessionId, req.body.actionId, req.body.decision);
      res.set('Cache-Control', 'no-store').json(reply);
    }),
  );

  return router;
}
