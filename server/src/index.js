import http from 'node:http';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { q, closeDb } from './db/connection.js';
import { createApp } from './app.js';
import { createSocketServer } from './realtime/socket.js';

migrate();

if (!q.get('SELECT id FROM restaurants LIMIT 1')) {
  console.warn('\n  Database has no restaurant yet. Run `npm run db:reset` (demo data) or `npm run db:init` first.\n');
}

const app = createApp();
const server = http.createServer(app);
createSocketServer(server);

server.listen(config.port, config.host, () => {
  console.log(`RMS server listening on http://localhost:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
