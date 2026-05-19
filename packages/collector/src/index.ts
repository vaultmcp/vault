import { createServer } from './server.js';
import { createInMemoryStore } from './store.js';

function parseEnv(): {
  port: number;
  host: string;
  secret?: string;
  capacity: number;
  corsOrigin?: string;
} {
  const port = Number.parseInt(process.env.PORT ?? '8787', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  const secret = process.env.COLLECTOR_SECRET;
  const capacity = Number.parseInt(process.env.COLLECTOR_CAPACITY ?? '10000', 10);
  const corsOrigin = process.env.COLLECTOR_CORS_ORIGIN;
  return { port, host, secret, capacity, corsOrigin };
}

function main(): void {
  const env = parseEnv();
  const store = createInMemoryStore({ capacity: env.capacity });
  const server = createServer({
    store,
    secret: env.secret,
    corsOrigin: env.corsOrigin,
  });

  server.listen(env.port, env.host, () => {
    process.stderr.write(
      `vault-collector: listening on ${env.host}:${env.port} (capacity=${env.capacity}` +
        (env.secret ? ', auth=on' : ', auth=off') +
        (env.corsOrigin ? `, cors=${env.corsOrigin}` : '') +
        ')\n',
    );
  });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      server.close(() => process.exit(0));
    });
  }
}

main();
