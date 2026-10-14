import { Router } from 'express';
import { CreateLeadSchema, LeadLookupSchema, ListLeadsQuerySchema, UpdateLeadStatusSchema } from '@gold/shared/schemas';
import type { ListLeadsQuery } from '@gold/shared/schemas';
import type { Container } from '../../container.ts';
import { ValidationError } from '../../lib/errors.ts';
import { toAuditDto } from '../../services/LeadService.ts';
import { asyncHandler } from '../middleware/asyncHandler.ts';
import { rateLimit } from '../middleware/rateLimit.ts';
import { validateBody, validateQuery } from '../middleware/validate.ts';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

function readIdempotencyKey(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const key = header.trim();
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new ValidationError([
      { field: 'Idempotency-Key', message: 'Idempotency-Key must be 8-128 characters: letters, digits and _ . : -' },
    ]);
  }
  return key;
}

/** POST /leads, GET /leads, GET /leads/:id, POST /leads/lookup, plus the status workflow and audit log. */
export function leadsRouter(c: Container): Router {
  const router = Router();

  router.post(
    '/leads',
    rateLimit(c.limiters.leads),
    validateBody(CreateLeadSchema),
    asyncHandler(async (req, res) => {
      const idempotencyKey = readIdempotencyKey(req.header('Idempotency-Key'));
      const result = await c.leadService.submit(req.body, { channel: 'FORM', idempotencyKey });
      if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
      res.status(result.statusCode).json(result.body);
    }),
  );

  router.get(
    '/leads',
    validateQuery(ListLeadsQuerySchema),
    asyncHandler(async (_req, res) => {
      const page = await c.leadService.list(res.locals.query as ListLeadsQuery);
      res.set('Cache-Control', 'no-store').json(page);
    }),
  );

  // Applicant self-service: "track my application". Needs the id AND the mobile it was filed with.
  router.post(
    '/leads/lookup',
    rateLimit(c.limiters.lookup),
    validateBody(LeadLookupSchema),
    asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store').json(await c.leadService.lookup(req.body));
    }),
  );

  // Admin panel totals per status.
  router.get(
    '/leads/summary',
    asyncHandler(async (_req, res) => {
      res.set('Cache-Control', 'no-store').json(await c.leadService.summary());
    }),
  );

  // Admin: one application with its repayment figures and full history.
  router.get(
    '/leads/:applicationId',
    asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store').json(await c.leadService.getDetail(String(req.params.applicationId)));
    }),
  );

  router.patch(
    '/leads/:applicationId/status',
    validateBody(UpdateLeadStatusSchema),
    asyncHandler(async (req, res) => {
      const lead = await c.leadService.transition(String(req.params.applicationId), req.body.status, 'admin');
      res.json(lead);
    }),
  );

  router.get(
    '/leads/:applicationId/audit',
    asyncHandler(async (req, res) => {
      const entries = await c.leadService.getAudit(String(req.params.applicationId));
      res.set('Cache-Control', 'no-store').json({ data: entries.map(toAuditDto) });
    }),
  );

  return router;
}
