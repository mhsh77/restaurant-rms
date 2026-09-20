import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import { config } from './config.js';
import { authenticate, sameOriginGuard } from './http/auth.js';
import { errorHandler, notFound } from './http/errors.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import floorRoutes from './routes/floor.js';
import reportRoutes from './routes/reports.js';
import cashierRoutes from './routes/cashier.js';

// Validation messages in Persian.
z.config(z.locales.fa());

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'"],
          // Allow plain-HTTP LAN installs (restaurant tablets on local Wi-Fi).
          'upgrade-insecure-requests': config.cookieSecure ? [] : null,
        },
      },
      strictTransportSecurity: config.cookieSecure,
    }),
  );
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(sameOriginGuard);
  api.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  api.use('/auth', authRoutes);
  api.use(authenticate);
  api.use('/', adminRoutes);
  api.use('/', floorRoutes);
  api.use('/', cashierRoutes);
  api.use('/reports', reportRoutes);
  api.use((_req, _res, next) => next(notFound('مسیر API نامعتبر است')));

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }, api);

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', fallthrough: false, index: false }));

  // Serve the built SPA. Checked per request, so a rebuild while the server runs (dist is
  // emptied and refilled) never leaves the server without routes.
  const indexHtml = path.join(config.clientDist, 'index.html');
  app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
  app.get('/{*splat}', (_req, res) => {
    if (!fs.existsSync(indexHtml)) {
      return res.status(503).type('text/plain; charset=utf-8').send('رابط کاربری هنوز ساخته نشده است. دستور npm run build را اجرا کنید.');
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });

  app.use(errorHandler);
  return app;
}
