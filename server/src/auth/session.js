import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { q } from '../db/connection.js';
import { ROLES, permissionsFor } from './permissions.js';

export function signSession(user) {
  return jwt.sign({ sub: user.id, tv: user.token_version }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: `${config.sessionHours}h`,
  });
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionHours * 3_600_000,
  };
}

/**
 * Verify a token and reload the user. Returns null unless the token is valid, the user is
 * active and the token's version matches (so revocation takes effect immediately).
 */
export function userFromToken(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const row = q.get(
    `SELECT u.id, u.restaurant_id, u.role_id, u.name, u.username, u.is_active, u.token_version, r.code AS role_code, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    Number(payload.sub),
  );
  if (!row || !row.is_active || row.token_version !== payload.tv) return null;
  return toSessionUser(row);
}

export function toSessionUser(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    name: row.name,
    username: row.username,
  };
}

/** Stations the user may work at / watch. Managers see all active stations. */
export function accessibleStations(user) {
  if (user.roleCode === ROLES.MANAGER) {
    return q.all('SELECT * FROM stations WHERE restaurant_id = ? AND is_active = 1 ORDER BY sort_order, id', user.restaurantId);
  }
  return q.all(
    'SELECT * FROM stations WHERE restaurant_id = ? AND is_active = 1 AND role_id = ? ORDER BY sort_order, id',
    user.restaurantId,
    user.roleId,
  );
}

export function worksStation(user, stationId) {
  const station = q.get('SELECT restaurant_id, role_id FROM stations WHERE id = ?', stationId);
  if (!station || station.restaurant_id !== user.restaurantId) return false;
  return user.roleCode === ROLES.MANAGER || station.role_id === user.roleId;
}

export function publicUser(user) {
  return { ...user, permissions: permissionsFor(user.roleCode) };
}

/** Minimal cookie header parser (socket handshake has no cookie-parser). */
export function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
