import { q, transaction, nowIso, bool } from '../db/connection.js';
import { audit } from './audit.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { notify, resyncStationRooms, rooms } from '../realtime/hub.js';
import { accessibleStations } from '../auth/session.js';

export const toStationDto = (s) => ({
  id: s.id,
  code: s.code,
  name: s.name,
  roleId: s.role_id,
  roleCode: s.role_code ?? null,
  autoReady: !!s.auto_ready,
  sortOrder: s.sort_order,
  isActive: !!s.is_active,
});

const SELECT = 'SELECT s.*, r.code AS role_code FROM stations s LEFT JOIN roles r ON r.id = s.role_id';

export function listStations(actor, { includeInactive = false } = {}) {
  return q
    .all(`${SELECT} WHERE s.restaurant_id = ? ${includeInactive ? '' : 'AND s.is_active = 1'} ORDER BY s.sort_order, s.id`, actor.restaurantId)
    .map(toStationDto);
}

export function getStation(actor, id) {
  const s = q.get(`${SELECT} WHERE s.id = ? AND s.restaurant_id = ?`, id, actor.restaurantId);
  if (!s) throw notFound('محل آماده‌سازی یافت نشد');
  return s;
}

function roleIdFor(code) {
  if (code === null || code === undefined) return null;
  const role = q.get("SELECT id FROM roles WHERE code = ? AND code IN ('KITCHEN','BAR')", code);
  if (!role) throw badRequest('مسئول ایستگاه فقط می‌تواند نقش آشپزخانه یا بار باشد');
  return role.id;
}

const stationRoomsFor = (user) => accessibleStations(user).map((s) => rooms.station(user.restaurantId, s.id));

export function createStation(actor, input) {
  const result = transaction(() => {
    if (q.get('SELECT 1 AS x FROM stations WHERE restaurant_id = ? AND code = ?', actor.restaurantId, input.code)) {
      throw conflict('ایستگاهی با این کد وجود دارد');
    }
    const now = nowIso();
    const { lastInsertRowid } = q.run(
      `INSERT INTO stations (restaurant_id, code, name, role_id, auto_ready, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      actor.restaurantId,
      input.code,
      input.name,
      roleIdFor(input.roleCode),
      bool(input.autoReady),
      input.sortOrder ?? 0,
      now,
      now,
    );
    const id = Number(lastInsertRowid);
    audit(actor, { action: 'station.create', entityType: 'station', entityId: id, summary: `${actor.name} ایستگاه ${input.name} را ایجاد کرد` });
    return toStationDto(getStation(actor, id));
  });
  resyncStationRooms(actor.restaurantId, stationRoomsFor);
  notify.menuChanged(actor.restaurantId);
  return result;
}

export function updateStation(actor, id, input) {
  const result = transaction(() => {
    const current = getStation(actor, id);
    if (input.isActive === false && current.is_active) {
      const items = q.get('SELECT COUNT(*) AS n FROM menu_items WHERE station_id = ? AND deleted_at IS NULL', id).n;
      if (items > 0) throw conflict(`ابتدا ${items} آیتم منوی این ایستگاه را به ایستگاه دیگری منتقل کنید`);
      const open = q.get(
        "SELECT COUNT(*) AS n FROM order_items WHERE station_id = ? AND status IN ('PENDING','PREPARING','READY')",
        id,
      ).n;
      if (open > 0) throw conflict('این ایستگاه هنوز اقلام سفارش باز دارد');
    }
    q.run(
      `UPDATE stations SET name = ?, role_id = ?, auto_ready = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?`,
      input.name ?? current.name,
      input.roleCode !== undefined ? roleIdFor(input.roleCode) : current.role_id,
      input.autoReady !== undefined ? bool(input.autoReady) : current.auto_ready,
      input.sortOrder ?? current.sort_order,
      input.isActive !== undefined ? bool(input.isActive) : current.is_active,
      nowIso(),
      id,
    );
    audit(actor, {
      action: 'station.update',
      entityType: 'station',
      entityId: id,
      summary: `${actor.name} ایستگاه ${current.name} را ویرایش کرد`,
      metadata: input,
    });
    return toStationDto(getStation(actor, id));
  });
  resyncStationRooms(actor.restaurantId, stationRoomsFor);
  notify.menuChanged(actor.restaurantId);
  return result;
}
