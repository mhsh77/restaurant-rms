import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');

const env = process.env;
const isProduction = env.NODE_ENV === 'production';
const dataDir = path.join(SERVER_ROOT, 'data');

function resolveJwtSecret() {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  if (isProduction) {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
  // Development: persist a generated secret so sessions survive `--watch` restarts.
  const file = path.join(dataDir, '.dev-jwt-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

export const config = {
  isProduction,
  port: Number(env.PORT || 4000),
  host: env.HOST || '0.0.0.0',
  dbFile: env.DB_FILE ? (env.DB_FILE === ':memory:' ? ':memory:' : path.resolve(env.DB_FILE)) : path.join(dataDir, 'rms.sqlite'),
  uploadDir: env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : path.join(SERVER_ROOT, 'uploads'),
  clientDist: path.resolve(SERVER_ROOT, '..', 'client', 'dist'),
  jwtSecret: resolveJwtSecret(),
  sessionHours: Number(env.SESSION_HOURS || 12),
  cookieName: 'rms_session',
  // Behind HTTPS the cookie must be Secure; LAN-only HTTP installs can set COOKIE_SECURE=false.
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction,
  loginMaxAttempts: Number(env.LOGIN_MAX_ATTEMPTS || 10),
};
