import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { q, nowIso } from '../db/connection.js';
import { verifyPassword, DUMMY_HASH } from '../auth/password.js';
import { signSession, cookieOptions, toSessionUser, accessibleStations, publicUser } from '../auth/session.js';
import { authenticate, loginLimiter } from '../http/auth.js';
import { tooMany, unauthorized } from '../http/errors.js';
import { audit } from '../services/audit.js';
import { changeOwnPassword } from '../services/users.js';
import { getRestaurant, toSettings } from '../services/restaurant.js';
import { toStationDto } from '../services/stations.js';

const router = Router();

function sessionPayload(user) {
  return {
    user: publicUser(user),
    stations: accessibleStations(user).map(toStationDto),
    restaurant: toSettings(getRestaurant(user.restaurantId)),
  };
}

const loginSchema = z.strictObject({
  username: z.string().trim().min(1, 'نام کاربری را وارد کنید').max(60),
  password: z.string().min(1, 'رمز عبور را وارد کنید').max(200),
});

router.post('/login', (req, res) => {
  const { username, password } = loginSchema.parse(req.body);
  if (!loginLimiter.check(username, req.ip)) throw tooMany('تعداد تلاش‌های ناموفق زیاد است؛ چند دقیقه بعد دوباره تلاش کنید');

  const row = q.get(
    `SELECT u.*, r.code AS role_code, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ?`,
    username,
  );
  const passwordOk = verifyPassword(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !passwordOk || !row.is_active) {
    loginLimiter.fail(username, req.ip);
    if (row) {
      audit(null, {
        restaurantId: row.restaurant_id,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: row.id,
        summary: `ورود ناموفق برای ${row.username}${passwordOk && !row.is_active ? ' (حساب غیرفعال)' : ''}`,
        ip: req.ip,
      });
    }
    throw unauthorized('نام کاربری یا رمز عبور اشتباه است');
  }

  loginLimiter.reset(username, req.ip);
  q.run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), row.id);
  const user = toSessionUser(row);
  audit({ ...user, ip: req.ip }, { action: 'auth.login', entityType: 'user', entityId: user.id, summary: `${user.name} وارد سیستم شد` });
  res.cookie(config.cookieName, signSession(row), cookieOptions());
  res.json(sessionPayload(user));
});

router.post('/logout', (req, res) => {
  res.clearCookie(config.cookieName, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', authenticate, (req, res) => {
  res.json(sessionPayload(req.user));
});

const passwordSchema = z.strictObject({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, 'باید حداقل ۸ کاراکتر باشد').max(200),
});

router.post('/change-password', authenticate, (req, res) => {
  const row = changeOwnPassword(req.user, passwordSchema.parse(req.body));
  // Other devices are signed out (token version bumped); keep this one signed in.
  res.cookie(config.cookieName, signSession(row), cookieOptions());
  res.json({ ok: true });
});

export default router;
