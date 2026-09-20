import { config } from '../config.js';
import { userFromToken } from '../auth/session.js';
import { roleHas } from '../auth/permissions.js';
import { forbidden, unauthorized } from './errors.js';

/** Require a valid session; attaches req.user. */
export function authenticate(req, res, next) {
  const user = userFromToken(req.cookies?.[config.cookieName]);
  if (!user) {
    if (req.cookies?.[config.cookieName]) res.clearCookie(config.cookieName, { path: '/' });
    throw unauthorized();
  }
  user.ip = req.ip;
  req.user = user;
  next();
}

/** Require every listed permission. */
export function requirePermission(...permissions) {
  return (req, _res, next) => {
    if (!permissions.every((p) => roleHas(req.user.roleCode, p))) throw forbidden();
    next();
  };
}

/** Require at least one of the listed permissions. */
export function requireAnyPermission(...permissions) {
  return (req, _res, next) => {
    if (!permissions.some((p) => roleHas(req.user.roleCode, p))) throw forbidden();
    next();
  };
}

/**
 * CSRF defence in depth (the cookie is already SameSite=Strict): state-changing requests
 * must not come from a foreign Origin.
 */
export function sameOriginGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      throw forbidden('مبدأ درخواست نامعتبر است');
    }
    const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
    if (!allowed.includes(host)) throw forbidden('درخواست از مبدأ دیگر پذیرفته نمی‌شود');
  }
  next();
}

/** In-memory login throttle: N failures per username+IP per window. */
export function createLoginLimiter({ max = 10, windowMs = 15 * 60_000 } = {}) {
  const attempts = new Map();
  const keyOf = (username, ip) => `${String(username).toLowerCase()}|${ip}`;
  return {
    check(username, ip) {
      const entry = attempts.get(keyOf(username, ip));
      if (!entry) return true;
      if (Date.now() - entry.first > windowMs) {
        attempts.delete(keyOf(username, ip));
        return true;
      }
      return entry.count < max;
    },
    fail(username, ip) {
      const k = keyOf(username, ip);
      const entry = attempts.get(k);
      if (!entry || Date.now() - entry.first > windowMs) attempts.set(k, { count: 1, first: Date.now() });
      else entry.count++;
    },
    reset(username, ip) {
      attempts.delete(keyOf(username, ip));
    },
  };
}

export const loginLimiter = createLoginLimiter({ max: config.loginMaxAttempts });
