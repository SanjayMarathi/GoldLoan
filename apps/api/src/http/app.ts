import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import type { Container } from '../container.ts';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.ts';
import { requestContext } from './middleware/requestContext.ts';
import { catalogRouter } from './routes/catalog.ts';
import { chatRouter } from './routes/chat.ts';
import { leadsRouter } from './routes/leads.ts';
import { quotesRouter } from './routes/quotes.ts';

const WEB_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../../web/dist');

export function createApp(c: Container): Express {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestContext(c.logger));
  // Framing is refused unless an origin is allowed (Hugging Face Spaces shows the app in an iframe on huggingface.co).
  const embed = c.config.frameAncestors;
  app.use(
    helmet({
      frameguard: embed.length > 0 ? false : { action: 'sameorigin' },
      contentSecurityPolicy: { directives: { frameAncestors: ["'self'", ...embed] } },
    }),
  );
  app.use(
    cors({
      origin: c.config.webOrigin,
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['Idempotent-Replayed', 'Retry-After', 'X-Request-Id'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '50kb' }));

  app.use('/api/v1', catalogRouter(c), quotesRouter(c), leadsRouter(c), chatRouter(c));

  // Production: serve the built React app from the same origin (no CORS, one container).
  if (existsSync(resolve(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(WEB_DIST, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(createErrorHandler(c.logger));
  return app;
}
