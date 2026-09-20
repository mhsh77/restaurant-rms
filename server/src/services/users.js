import { q, transaction, nowIso, bool } from '../db/connection.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { ROLES } from '../auth/permissions.js';
import { audit } from './audit.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { notify } from '../realtime/hub.js';
import { joinFa } from './labels.js';

const SELECT = `SELECT u.id, u.name, u.username, u.is_active, u.last_login_at, u.created_at, u.updated_at,
                       r.id AS role_id, r.code AS role_code, r.name AS role_name
                  FROM users u JOIN roles r ON r.id = u.role_id`;

const toDto = (u) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  isActive: !!u.is_active,
  role: { id: u.role_id, code: u.role_code, name: u.role_name },
  lastLoginAt: u.last_login_at,
  createdAt: u.created_at,
});

export function listRoles() {
  return q.all('SELECT id, code, name, description FROM roles ORDER BY id');
}

export function listUsers(actor, { q: search, roleCode, active } = {}) {
  const where = ['u.restaurant_id = ?'];
  const params = [actor.restaurantId];
  if (search) {
    where.push('(u.name LIKE ? OR u.username LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (roleCode) {
    where.push('r.code = ?');
    params.push(roleCode);
  }
  if (active !== undefined) {
    where.push('u.is_active = ?');
    params.push(bool(active));
  }
  return q.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY u.is_active DESC, r.id, u.name`, ...params).map(toDto);
}

function roleByCode(code) {
  const role = q.get('SELECT * FROM roles WHERE code = ?', code);
  if (!role) throw badRequest('نقش نامعتبر است');
  return role;
}

function assertUsernameFree(username, exceptId = 0) {
  if (q.get('SELECT id FROM users WHERE username = ? AND id != ?', username, exceptId)) {
    throw conflict('این نام کاربری قبلاً استفاده شده است');
  }
}

export function createUser(actor, input) {
  return transaction(() => {
    const role = roleByCode(input.roleCode);
    assertUsernameFree(input.username);
    const now = nowIso();
    const { lastInsertRowid } = q.run(
      `INSERT INTO users (restaurant_id, role_id, name, username, password_hash, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      actor.restaurantId,
      role.id,
      input.name,
      input.username,
      hashPassword(input.password),
      bool(input.isActive ?? true),
      now,
      now,
    );
    const id = Number(lastInsertRowid);
    audit(actor, {
      action: 'user.create',
      entityType: 'user',
      entityId: id,
      summary: `${actor.name} کاربر ${input.name} (${input.username}، ${role.name}) را ایجاد کرد`,
    });
    return getUser(actor, id);
  });
}

export function getUser(actor, id) {
  const row = q.get(`${SELECT} WHERE u.id = ? AND u.restaurant_id = ?`, id, actor.restaurantId);
  if (!row) throw notFound('کاربر یافت نشد');
  return toDto(row);
}

function activeManagerCount(restaurantId) {
  return q.get(
    `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.restaurant_id = ? AND u.is_active = 1 AND r.code = 'MANAGER'`,
    restaurantId,
  ).n;
}

export function updateUser(actor, id, input) {
  let revoke = false;
  const result = transaction(() => {
    const current = q.get(`${SELECT} WHERE u.id = ? AND u.restaurant_id = ?`, id, actor.restaurantId);
    if (!current) throw notFound('کاربر یافت نشد');

    const role = input.roleCode ? roleByCode(input.roleCode) : null;
    const roleChanges = role && role.id !== current.role_id;
    const deactivates = input.isActive === false && current.is_active;
    const passwordChanges = !!input.password;

    if (id === actor.id && (roleChanges || deactivates)) {
      throw badRequest('نمی‌توانید نقش خود را تغییر دهید یا حساب خود را غیرفعال کنید');
    }
    if (current.role_code === ROLES.MANAGER && current.is_active && (deactivates || roleChanges) && activeManagerCount(actor.restaurantId) <= 1) {
      throw conflict('حداقل یک مدیر فعال لازم است');
    }
    if (input.username && input.username.toLowerCase() !== current.username.toLowerCase()) assertUsernameFree(input.username, id);

    revoke = roleChanges || deactivates || passwordChanges;
    q.run(
      `UPDATE users SET name = ?, username = ?, role_id = ?, is_active = ?,
              password_hash = COALESCE(?, password_hash),
              token_version = token_version + ?, updated_at = ?
        WHERE id = ?`,
      input.name ?? current.name,
      input.username ?? current.username,
      role ? role.id : current.role_id,
      input.isActive === undefined ? current.is_active : bool(input.isActive),
      passwordChanges ? hashPassword(input.password) : null,
      revoke ? 1 : 0,
      nowIso(),
      id,
    );

    const changes = [];
    if (input.name && input.name !== current.name) changes.push('نام');
    if (input.username && input.username !== current.username) changes.push('نام کاربری');
    if (roleChanges) changes.push(`نقش از ${current.role_name} به ${role.name}`);
    if (input.isActive !== undefined && bool(input.isActive) !== current.is_active) changes.push(input.isActive ? 'فعال شد' : 'غیرفعال شد');
    if (passwordChanges) changes.push('رمز عبور بازنشانی شد');
    if (changes.length) {
      audit(actor, {
        action: 'user.update',
        entityType: 'user',
        entityId: id,
        summary: `${actor.name} کاربر ${current.name} را ویرایش کرد: ${joinFa(changes)}`,
      });
    }
    return getUser(actor, id);
  });
  if (revoke) notify.revokeUser(id);
  return result;
}

export function changeOwnPassword(actor, { currentPassword, newPassword }) {
  transaction(() => {
    const row = q.get('SELECT password_hash FROM users WHERE id = ?', actor.id);
    if (!row || !verifyPassword(currentPassword, row.password_hash)) throw badRequest('رمز عبور فعلی اشتباه است');
    q.run(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?',
      hashPassword(newPassword),
      nowIso(),
      actor.id,
    );
    audit(actor, { action: 'auth.password_change', entityType: 'user', entityId: actor.id, summary: `${actor.name} رمز عبور خود را تغییر داد` });
  });
  return q.get(
    `SELECT u.*, r.code AS role_code, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    actor.id,
  );
}
