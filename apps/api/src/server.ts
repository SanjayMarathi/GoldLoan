import { loadEnvFiles } from './db/loadEnv.ts';
import { loadConfig } from './config.ts';
import { buildContainer } from './container.ts';
import { createApp } from './http/app.ts';
import { createLogger } from './lib/logger.ts';
import { createRepositories } from './repositories/factory.ts';

async function main(): Promise<void> {
  loadEnvFiles();
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const repositories = await createRepositories(config, logger);
  const container = buildContainer(config, { logger, repositories });
  const app = createApp(container);

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, storage: repositories.kind, assistant: container.agent.providerName },
      `GoldLoan API listening on http://localhost:${config.port}`,
    );
  });
  server.keepAliveTimeout = 65_000; // longer than typical proxy idle timeouts

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    server.close(() => {
      repositories
        .close()
        .catch((error: unknown) => logger.error({ err: error }, 'error while closing storage'))
        .finally(() => process.exit(0));
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled promise rejection'));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
