import { q, transaction, nowIso } from '../db/connection.js';
import { audit } from './audit.js';
import { conflict, notFound } from '../http/errors.js';
import { notify } from '../realtime/hub.js';
import { deriveTableStatus } from './statusRules.js';
import { joinFa } from './labels.js';

/** Tables with their live order summary and derived floor status. */
export function listFloor(actor) {
  const rows = q.all(
    `SELECT t.id, t.name, t.capacity, t.area, t.sort_order,
            o.id AS order_id, o.order_number, o.lifecycle, o.status AS order_status, o.guest_count, o.subtotal,
            o.opened_at, o.ordering_until, o.version AS order_version, o.paid_amount, o.payment_status,
            w.id AS waiter_id, w.name AS waiter_name, ou.name AS ordering_user_name,
            COALESCE(SUM(CASE WHEN oi.status = 'PENDING'   THEN 1 ELSE 0 END), 0) AS c_pending,
            COALESCE(SUM(CASE WHEN oi.status = 'PREPARING' THEN 1 ELSE 0 END), 0) AS c_preparing,
            COALESCE(SUM(CASE WHEN oi.status = 'READY'     THEN 1 ELSE 0 END), 0) AS c_ready,
            COALESCE(SUM(CASE WHEN oi.status = 'DELIVERED' THEN 1 ELSE 0 END), 0) AS c_delivered
       FROM dining_tables t
       LEFT JOIN orders o ON o.table_id = t.id AND o.released_at IS NULL
       LEFT JOIN users w ON w.id = o.waiter_id
       LEFT JOIN users ou ON ou.id = o.ordering_user_id
       LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE t.restaurant_id = ? AND t.is_active = 1
      GROUP BY t.id
      ORDER BY t.sort_order, t.id`,
    actor.restaurantId,
  );
  const now = new Date();
  return rows.map((r) => {
    const live = r.order_id
      ? {
          lifecycle: r.lifecycle,
          orderingUntil: r.ordering_until,
          counts: { PENDING: r.c_pending, PREPARING: r.c_preparing, READY: r.c_ready, DELIVERED: r.c_delivered },
        }
      : null;
    return {
      id: r.id,
      name: r.name,
      capacity: r.capacity,
      area: r.area,
      sortOrder: r.sort_order,
      status: deriveTableStatus(live, now),
      order: live
        ? {
            id: r.order_id,
            orderNumber: r.order_number,
            lifecycle: r.lifecycle,
            status: r.order_status,
            guestCount: r.guest_count,
            subtotal: r.subtotal,
            paidAmount: r.paid_amount,
            paymentStatus: r.payment_status,
            openedAt: r.opened_at,
            orderingUntil: r.ordering_until,
            orderingUserName: r.ordering_user_name,
            waiter: { id: r.waiter_id, name: r.waiter_name },
            counts: live.counts,
            version: r.order_version,
          }
        : null,
    };
  });
}

export function getTable(actor, id, { includeInactive = false } = {}) {
  const t = q.get(
    `SELECT * FROM dining_tables WHERE id = ? AND restaurant_id = ? ${includeInactive ? '' : 'AND is_active = 1'}`,
    id,
    actor.restaurantId,
  );
  if (!t) throw notFound('میز یافت نشد');
  return t;
}

function assertNameFree(actor, name, exceptId = 0) {
  if (q.get('SELECT 1 AS x FROM dining_tables WHERE restaurant_id = ? AND is_active = 1 AND name = ? COLLATE NOCASE AND id != ?', actor.restaurantId, name, exceptId)) {
    throw conflict(`میزی با نام «${name}» وجود دارد`);
  }
}

export function createTable(actor, input) {
  const result = transaction(() => {
    assertNameFree(actor, input.name);
    const now = nowIso();
    const sortOrder = input.sortOrder ?? (q.get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM dining_tables WHERE restaurant_id = ?', actor.restaurantId).n);
    const { lastInsertRowid } = q.run(
      `INSERT INTO dining_tables (restaurant_id, name, capacity, area, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      actor.restaurantId,
      input.name,
      input.capacity,
      input.area ?? '',
      sortOrder,
      now,
      now,
    );
    const id = Number(lastInsertRowid);
    audit(actor, { action: 'table.create', entityType: 'table', entityId: id, summary: `${actor.name} ${input.name} (${input.capacity} نفره) را ایجاد کرد` });
    return getTable(actor, id);
  });
  notify.tablesChanged(actor.restaurantId);
  return result;
}

export function updateTable(actor, id, input) {
  const result = transaction(() => {
    const current = getTable(actor, id);
    if (input.name) assertNameFree(actor, input.name, id);
    q.run(
      'UPDATE dining_tables SET name = ?, capacity = ?, area = ?, sort_order = ?, updated_at = ? WHERE id = ?',
      input.name ?? current.name,
      input.capacity ?? current.capacity,
      input.area ?? current.area,
      input.sortOrder ?? current.sort_order,
      nowIso(),
      id,
    );
    const changes = [];
    if (input.name && input.name !== current.name) changes.push(`نام از «${current.name}» به «${input.name}»`);
    if (input.capacity && input.capacity !== current.capacity) changes.push(`ظرفیت از ${current.capacity} به ${input.capacity}`);
    if (input.area !== undefined && input.area !== current.area) changes.push('بخش');
    if (changes.length) {
      audit(actor, { action: 'table.update', entityType: 'table', entityId: id, summary: `${actor.name} ${current.name} را ویرایش کرد: ${joinFa(changes)}` });
    }
    return getTable(actor, id);
  });
  notify.tablesChanged(actor.restaurantId);
  return result;
}

export function deleteTable(actor, id) {
  const result = transaction(() => {
    const table = getTable(actor, id);
    if (q.get('SELECT 1 AS x FROM orders WHERE table_id = ? AND released_at IS NULL', id)) {
      throw conflict('این میز سفارش باز دارد؛ ابتدا آن را تکمیل یا لغو کنید');
    }
    const hasHistory = q.get('SELECT 1 AS x FROM orders WHERE table_id = ? LIMIT 1', id);
    if (hasHistory) {
      q.run('UPDATE dining_tables SET is_active = 0, updated_at = ? WHERE id = ?', nowIso(), id);
    } else {
      q.run('DELETE FROM dining_tables WHERE id = ?', id);
    }
    audit(actor, { action: 'table.delete', entityType: 'table', entityId: id, summary: `${actor.name} ${table.name} را حذف کرد` });
    return { id, archived: !!hasHistory };
  });
  notify.tablesChanged(actor.restaurantId);
  return result;
}

/** Free a table whose order has been completed (guests left, table cleaned). */
export function releaseTable(actor, id) {
  const result = transaction(() => {
    const table = getTable(actor, id);
    const order = q.get('SELECT id, order_number, lifecycle FROM orders WHERE table_id = ? AND released_at IS NULL', id);
    if (!order) throw conflict('این میز از قبل آزاد است');
    if (order.lifecycle !== 'COMPLETED') throw conflict('ابتدا سفارش را تکمیل کنید، سپس میز را آزاد کنید');
    q.run('UPDATE orders SET released_at = ?, updated_at = ?, version = version + 1 WHERE id = ?', nowIso(), nowIso(), order.id);
    audit(actor, {
      action: 'table.release',
      entityType: 'table',
      entityId: id,
      summary: `${actor.name} ${table.name} را آزاد کرد (سفارش #${order.order_number})`,
    });
    return { tableId: id, orderId: order.id };
  });
  notify.orderChanged(actor.restaurantId, { orderId: result.orderId, tableId: id });
  return result;
}
