import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.ts';
import { openDb } from './db/client.ts';

const db = openDb();
const app = createApp(db);

const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(webDist)) {
  app.use('/*', serveStatic({ root: webDist }));
  const indexHtml = readFileSync(`${webDist}/index.html`, 'utf8');
  app.get('*', (c) => c.html(indexHtml));
}

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
serve({ fetch: app.fetch, port, hostname: host }, () => {
  console.log(`live-chat-eval server: http://${host}:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    db.close();
    process.exit(0);
  });
}
