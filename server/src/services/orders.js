/**
 * Order lifecycle: opening a table, submitting rounds (batches), routing items to stations,
 * item status transitions, delivery, completion, cancellation, receipts and search.
 *
 * Concurrency rules (docs/ARCHITECTURE.md §4):
 *  - every write runs in a BEGIN IMMEDIATE transaction;
 *  - item transitions are conditional updates (`WHERE status = :from`) → 409 on a lost race;
 *  - edits carry the row version (`WHERE version = :version`) → 409 instead of overwrite;
 *  - batch submits are idempotent via clientRequestId;
 *  - one live order per table is enforced by a partial unique index.
 * Notifications are emitted only after the transaction has committed.
 */
import { q, transaction, nowIso } from '../db/connection.js';
import { ROLES } from '../auth/permissions.js';
import { worksStation } from '../auth/session.js';
import { audit } from './audit.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { containsAny, latinDigits } from '../http/validate.js';
import { notify } from '../realtime/hub.js';
import { getRestaurant } from './restaurant.js';
import { businessDate } from './time.js';
import { formatMoney } from './money.js';
import { ITEM, PAYMENT, canTransition, deriveOrderStatus, derivePaymentStatus } from './statusRules.js';
import { getTable } from './tables.js';
import { ITEM_STATUS_FA, LIFECYCLE_FA, joinFa } from './labels.js';

const ORDERING_PRESENCE_MS = 90_000;
const OPEN_ITEM_STATUSES = [ITEM.PENDING, ITEM.PREPARING, ITEM.READY];
const st = (s) => `«${ITEM_STATUS_FA[s] ?? s}»`;

/* ───────────────────────────── helpers ───────────────────────────── */

function loadOrder(actor, orderId) {
  const order = q.get('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?', orderId, actor.restaurantId);
  if (!order) throw notFound('سفارش یافت نشد');
  return order;
}

function assertActive(order) {
  if (order.lifecycle !== 'ACTIVE') throw conflict(`سفارش #${order.order_number} ${LIFECYCLE_FA[order.lifecycle]} است`);
}

/**
 * Recompute cached subtotal, derived order status and payment state.
 * Must run inside the caller's transaction, after any item or payment change.
 */
export function recomputeOrder(orderId) {
  const order = q.get('SELECT lifecycle FROM orders WHERE id = ?', orderId);
  const items = q.all('SELECT status, quantity, unit_price FROM order_items WHERE order_id = ?', orderId);
  const status = deriveOrderStatus(order.lifecycle, items);
  const subtotal = items.filter((i) => i.status !== ITEM.CANCELLED).reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
  const paid = q.get('SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE order_id = ? AND voided_at IS NULL', orderId).n;
  q.run(
    'UPDATE orders SET status = ?, subtotal = ?, paid_amount = ?, payment_status = ?, version = version + 1, updated_at = ? WHERE id = ?',
    status,
    subtotal,
    paid,
    derivePaymentStatus(subtotal, paid),
    nowIso(),
    orderId,
  );
}

/**
 * Move one item to `to`. Conditional on the item still being in `item.status`, so a
 * concurrent change makes this throw 409 instead of overwriting.
 */
function moveItem(actor, item, to, now, { reason = null } = {}) {
  const from = item.status;
  const sets = ['status = ?', 'version = version + 1', 'updated_at = ?'];
  const params = [to, now];
  const forward = !(from === ITEM.PREPARING && to === ITEM.PENDING) && !(from === ITEM.READY && to === ITEM.PREPARING);

  if (forward) {
    if (to === ITEM.PREPARING) sets.push('started_at = ?'), params.push(now);
    if (to === ITEM.READY) sets.push('ready_at = ?'), params.push(now);
    if (to === ITEM.DELIVERED) sets.push('delivered_at = ?'), params.push(now);
    if (to === ITEM.CANCELLED) {
      sets.push('cancelled_at = ?', 'cancelled_by = ?', 'cancel_reason = ?');
      params.push(now, actor.id, reason);
    }
  } else if (to === ITEM.PENDING) {
    sets.push('started_at = NULL');
  } else {
    sets.push('ready_at = NULL');
  }

  const { changes } = q.run(`UPDATE order_items SET ${sets.join(', ')} WHERE id = ? AND status = ?`, ...params, item.id, from);
  if (changes === 0) {
    const current = q.get('SELECT status FROM order_items WHERE id = ?', item.id);
    throw conflict(`وضعیت ${item.item_name} قبلاً به ${st(current?.status)} تغییر کرده است`, { itemId: item.id, status: current?.status });
  }
  q.run('INSERT INTO order_item_status_history (order_item_id, from_status, to_status, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)', item.id, from, to, actor.id, now);
  item.status = to;
}

const describeItems = (items) => joinFa(items.map((i) => `${i.item_name} ×${i.quantity}`));

function readyPayload(orderId, items) {
  const o = q.get(
    `SELECT o.id, o.order_number, o.table_id, o.waiter_id, t.name AS table_name
       FROM orders o JOIN dining_tables t ON t.id = o.table_id WHERE o.id = ?`,
    orderId,
  );
  return {
    orderId: o.id,
    orderNumber: o.order_number,
    tableId: o.table_id,
    tableName: o.table_name,
    waiterId: o.waiter_id,
    count: items.length,
    items: items.map((i) => ({ id: i.id, name: i.item_name, quantity: i.quantity })),
  };
}

/**
 * Why an ACTIVE order cannot be completed right now (null when it can).
 * `order` must carry lifecycle, payment_status; `counts` the item status counts.
 */
function completeBlockedReason(restaurant, order, counts) {
  if (order.lifecycle !== 'ACTIVE') return `سفارش ${LIFECYCLE_FA[order.lifecycle]} است`;
  const open = counts.PENDING + counts.PREPARING + counts.READY;
  if (open > 0) return `${open} آیتم هنوز تحویل نشده است؛ ابتدا آن‌ها را تحویل یا لغو کنید`;
  if (counts.DELIVERED === 0) return 'در این سفارش چیزی سرو نشده است؛ به‌جای تکمیل، آن را لغو کنید';
  if (restaurant.require_payment_to_complete && order.payment_status !== PAYMENT.PAID) {
    if (order.payment_status === PAYMENT.OVERPAID) return 'مبلغ پرداختی بیشتر از صورتحساب است؛ ابتدا اضافه پرداخت را در صندوق اصلاح کنید';
    return `مبلغ ${formatMoney(restaurant, order.subtotal - order.paid_amount)} هنوز پرداخت نشده است؛ ابتدا صورتحساب را در صندوق تسویه کنید`;
  }
  return null;
}

function itemCounts(orderId) {
  const counts = { PENDING: 0, PREPARING: 0, READY: 0, DELIVERED: 0, CANCELLED: 0 };
  for (const r of q.all('SELECT status, COUNT(*) AS n FROM order_items WHERE order_id = ? GROUP BY status', orderId)) counts[r.status] = r.n;
  return counts;
}

/* ───────────────────────────── queries ───────────────────────────── */

const toPaymentDto = (p) => ({
  id: p.id,
  method: p.method,
  amount: p.amount,
  receivedAmount: p.received_amount,
  change: p.received_amount !== null && p.received_amount !== undefined ? p.received_amount - p.amount : 0,
  reference: p.reference,
  createdAt: p.created_at,
  createdByName: p.created_by_name,
  voidedAt: p.voided_at,
  voidedByName: p.voided_by_name,
  voidReason: p.void_reason,
});

export function listOrderPayments(orderId) {
  return q
    .all(
      `SELECT p.*, u.name AS created_by_name, vu.name AS voided_by_name
         FROM payments p
         JOIN users u ON u.id = p.created_by
         LEFT JOIN users vu ON vu.id = p.voided_by
        WHERE p.order_id = ? ORDER BY p.created_at, p.id`,
      orderId,
    )
    .map(toPaymentDto);
}

export function getOrderDetail(actor, orderId) {
  const order = q.get(
    `SELECT o.*, t.name AS table_name, w.name AS waiter_name, ou.name AS ordering_user_name
       FROM orders o
       JOIN dining_tables t ON t.id = o.table_id
       JOIN users w ON w.id = o.waiter_id
       LEFT JOIN users ou ON ou.id = o.ordering_user_id
      WHERE o.id = ? AND o.restaurant_id = ?`,
    orderId,
    actor.restaurantId,
  );
  if (!order) throw notFound('سفارش یافت نشد');

  const batches = q.all(
    `SELECT b.id, b.batch_no, b.submitted_at, u.name AS created_by_name
       FROM order_batches b JOIN users u ON u.id = b.created_by
      WHERE b.order_id = ? ORDER BY b.batch_no`,
    orderId,
  );
  const items = q.all(
    `SELECT oi.*, s.name AS station_name, s.code AS station_code
       FROM order_items oi JOIN stations s ON s.id = oi.station_id
      WHERE oi.order_id = ? ORDER BY oi.batch_id, oi.id`,
    orderId,
  );
  const counts = { PENDING: 0, PREPARING: 0, READY: 0, DELIVERED: 0, CANCELLED: 0 };
  for (const i of items) counts[i.status]++;
  const restaurant = getRestaurant(actor.restaurantId);
  const blocked = order.lifecycle === 'ACTIVE' ? completeBlockedReason(restaurant, order, counts) : null;

  return {
    id: order.id,
    orderNumber: order.order_number,
    table: { id: order.table_id, name: order.table_name },
    waiter: { id: order.waiter_id, name: order.waiter_name },
    guestCount: order.guest_count,
    note: order.note,
    lifecycle: order.lifecycle,
    status: order.status,
    subtotal: order.subtotal,
    total: order.subtotal,
    paidAmount: order.paid_amount,
    remaining: order.subtotal - order.paid_amount,
    paymentStatus: order.payment_status,
    paymentRequired: !!restaurant.require_payment_to_complete,
    payments: listOrderPayments(orderId),
    businessDate: order.business_date,
    openedAt: order.opened_at,
    completedAt: order.completed_at,
    cancelledAt: order.cancelled_at,
    cancelReason: order.cancel_reason,
    releasedAt: order.released_at,
    orderingUntil: order.ordering_until,
    orderingUserName: order.ordering_user_name,
    receiptPrintCount: order.receipt_print_count,
    version: order.version,
    counts,
    canComplete: order.lifecycle === 'ACTIVE' && !blocked,
    completeBlockedReason: blocked,
    batches: batches.map((b) => ({
      id: b.id,
      batchNo: b.batch_no,
      submittedAt: b.submitted_at,
      createdByName: b.created_by_name,
      items: items.filter((i) => i.batch_id === b.id).map(toOrderItemDto),
    })),
  };
}

const toOrderItemDto = (i) => ({
  id: i.id,
  menuItemId: i.menu_item_id,
  name: i.item_name,
  unitPrice: i.unit_price,
  quantity: i.quantity,
  lineTotal: i.unit_price * i.quantity,
  note: i.note,
  status: i.status,
  version: i.version,
  station: { id: i.station_id, name: i.station_name, code: i.station_code },
  submittedAt: i.submitted_at,
  startedAt: i.started_at,
  readyAt: i.ready_at,
  deliveredAt: i.delivered_at,
  cancelledAt: i.cancelled_at,
  cancelReason: i.cancel_reason,
});

export function searchOrders(actor, filters) {
  const where = ['o.restaurant_id = ?'];
  const params = [actor.restaurantId];
  if (filters.q) {
    const text = String(filters.q).trim();
    const digits = latinDigits(text).replace(/^#/, '');
    if (/^\d+$/.test(digits)) {
      where.push('CAST(o.order_number AS TEXT) LIKE ?');
      params.push(`${digits}%`);
    } else {
      const match = containsAny(['t.name', 'w.name'], text);
      where.push(match.sql);
      params.push(...match.params);
    }
  }
  if (filters.tableId) where.push('o.table_id = ?'), params.push(filters.tableId);
  if (filters.waiterId) where.push('o.waiter_id = ?'), params.push(filters.waiterId);
  if (filters.status) where.push('o.status = ?'), params.push(filters.status);
  if (filters.paymentStatus) where.push('o.payment_status = ?'), params.push(filters.paymentStatus);
  if (filters.from) where.push('o.business_date >= ?'), params.push(filters.from);
  if (filters.to) where.push('o.business_date <= ?'), params.push(filters.to);

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  const base = `FROM orders o JOIN dining_tables t ON t.id = o.table_id JOIN users w ON w.id = o.waiter_id WHERE ${where.join(' AND ')}`;
  const total = q.get(`SELECT COUNT(*) AS n ${base}`, ...params).n;
  const rows = q.all(
    `SELECT o.id, o.order_number, o.status, o.lifecycle, o.subtotal, o.paid_amount, o.payment_status, o.guest_count, o.business_date, o.opened_at, o.completed_at,
            t.id AS table_id, t.name AS table_name, w.id AS waiter_id, w.name AS waiter_name,
            (SELECT COALESCE(SUM(quantity), 0) FROM order_items oi WHERE oi.order_id = o.id AND oi.status != 'CANCELLED') AS item_count
       ${base}
      ORDER BY o.opened_at DESC
      LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize,
  );
  return {
    page,
    pageSize,
    total,
    orders: rows.map((r) => ({
      id: r.id,
      orderNumber: r.order_number,
      status: r.status,
      lifecycle: r.lifecycle,
      total: r.subtotal,
      paidAmount: r.paid_amount,
      paymentStatus: r.payment_status,
      guestCount: r.guest_count,
      itemCount: r.item_count,
      businessDate: r.business_date,
      openedAt: r.opened_at,
      completedAt: r.completed_at,
      table: { id: r.table_id, name: r.table_name },
      waiter: { id: r.waiter_id, name: r.waiter_name },
    })),
  };
}

/** Items waiting at the pass, grouped by order — drives the waiter's notification bell. */
export function readySummary(actor) {
  const rows = q.all(
    `SELECT oi.id, oi.item_name, oi.quantity, oi.note, oi.ready_at, s.name AS station_name,
            o.id AS order_id, o.order_number, o.waiter_id, w.name AS waiter_name, t.id AS table_id, t.name AS table_name
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN dining_tables t ON t.id = o.table_id
       JOIN users w ON w.id = o.waiter_id
       JOIN stations s ON s.id = oi.station_id
      WHERE o.restaurant_id = ? AND o.lifecycle = 'ACTIVE' AND oi.status = 'READY'
      ORDER BY oi.ready_at`,
    actor.restaurantId,
  );
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.order_id)) {
      groups.set(r.order_id, {
        orderId: r.order_id,
        orderNumber: r.order_number,
        table: { id: r.table_id, name: r.table_name },
        waiter: { id: r.waiter_id, name: r.waiter_name },
        oldestReadyAt: r.ready_at,
        items: [],
      });
    }
    groups.get(r.order_id).items.push({ id: r.id, name: r.item_name, quantity: r.quantity, note: r.note, readyAt: r.ready_at, stationName: r.station_name });
  }
  return [...groups.values()];
}

/* ───────────────────────────── commands ───────────────────────────── */

export function openOrder(actor, { tableId, guestCount, note = '' }) {
  const result = transaction(() => {
    const table = getTable(actor, tableId);
    const existing = q.get('SELECT id, order_number FROM orders WHERE table_id = ? AND released_at IS NULL', tableId);
    if (existing) throw conflict(`${table.name} سفارش باز #${existing.order_number} دارد`, { orderId: existing.id });

    const restaurant = getRestaurant(actor.restaurantId);
    const { order_seq: orderNumber } = q.get('UPDATE restaurants SET order_seq = order_seq + 1 WHERE id = ? RETURNING order_seq', actor.restaurantId);
    const now = new Date();
    const iso = now.toISOString();
    const { lastInsertRowid } = q.run(
      `INSERT INTO orders (restaurant_id, order_number, table_id, waiter_id, guest_count, note, business_date, opened_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      actor.restaurantId,
      orderNumber,
      tableId,
      actor.id,
      guestCount,
      note,
      businessDate(restaurant, now),
      iso,
      iso,
    );
    const orderId = Number(lastInsertRowid);
    audit(actor, {
      action: 'order.create',
      entityType: 'order',
      entityId: orderId,
      summary: `${actor.name} سفارش #${orderNumber} را برای ${table.name} (${guestCount} مهمان) ثبت کرد`,
    });
    return { orderId, tableId };
  });
  notify.orderChanged(actor.restaurantId, result);
  return getOrderDetail(actor, result.orderId);
}

export function updateOrder(actor, orderId, { guestCount, note, version }) {
  const result = transaction(() => {
    const order = loadOrder(actor, orderId);
    assertActive(order);
    const { changes } = q.run(
      'UPDATE orders SET guest_count = ?, note = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
      guestCount ?? order.guest_count,
      note ?? order.note,
      nowIso(),
      orderId,
      version,
    );
    if (changes === 0) throw conflict('سفارش توسط کاربر دیگری تغییر کرده است؛ صفحه را به‌روز کنید و دوباره تلاش کنید');
    audit(actor, { action: 'order.update', entityType: 'order', entityId: orderId, summary: `${actor.name} اطلاعات سفارش #${order.order_number} را ویرایش کرد` });
    return { orderId, tableId: order.table_id };
  });
  notify.orderChanged(actor.restaurantId, result);
  return getOrderDetail(actor, orderId);
}

/** Submit a round of items. Routing to stations happens here, from each menu item's station. */
export function submitBatch(actor, orderId, { clientRequestId, items }) {
  const outcome = transaction(() => {
    const order = loadOrder(actor, orderId);
    assertActive(order);

    const duplicate = q.get('SELECT id FROM order_batches WHERE order_id = ? AND client_request_id = ?', orderId, clientRequestId);
    if (duplicate) return { duplicate: true, orderId, tableId: order.table_id, stationIds: [], readyItems: [] };

    const ids = [...new Set(items.map((i) => i.menuItemId))];
    const menu = q.all(
      `SELECT mi.id, mi.name, mi.price, mi.category_id, mi.station_id, mi.is_active, mi.is_available, mi.deleted_at,
              s.auto_ready, s.is_active AS station_active
         FROM menu_items mi JOIN stations s ON s.id = mi.station_id
        WHERE mi.restaurant_id = ? AND mi.id IN (${ids.map(() => '?').join(',')})`,
      actor.restaurantId,
      ...ids,
    );
    const byId = new Map(menu.map((m) => [m.id, m]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) throw badRequest('آیتم منو نامعتبر است', { menuItemIds: missing });
    const unavailable = menu.filter((m) => m.deleted_at || !m.is_active || !m.is_available || !m.station_active);
    if (unavailable.length) {
      throw conflict(`این اقلام در حال حاضر موجود نیستند: ${joinFa(unavailable.map((m) => m.name))}`, {
        unavailable: unavailable.map((m) => ({ menuItemId: m.id, name: m.name })),
      });
    }

    const now = nowIso();
    const batchNo = q.get('SELECT COALESCE(MAX(batch_no), 0) + 1 AS n FROM order_batches WHERE order_id = ?', orderId).n;
    const batchId = Number(
      q.run('INSERT INTO order_batches (order_id, batch_no, created_by, client_request_id, submitted_at) VALUES (?, ?, ?, ?, ?)', orderId, batchNo, actor.id, clientRequestId, now)
        .lastInsertRowid,
    );

    const created = [];
    for (const line of items) {
      const m = byId.get(line.menuItemId);
      const status = m.auto_ready ? ITEM.READY : ITEM.PENDING;
      const itemId = Number(
        q.run(
          `INSERT INTO order_items (order_id, batch_id, menu_item_id, station_id, category_id, item_name, unit_price, quantity, note, status,
                                    created_by, submitted_at, started_at, ready_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          orderId,
          batchId,
          m.id,
          m.station_id,
          m.category_id,
          m.name,
          m.price,
          line.quantity,
          line.note ?? '',
          status,
          actor.id,
          now,
          m.auto_ready ? now : null,
          m.auto_ready ? now : null,
          now,
        ).lastInsertRowid,
      );
      q.run('INSERT INTO order_item_status_history (order_item_id, from_status, to_status, changed_by, changed_at) VALUES (?, NULL, ?, ?, ?)', itemId, status, actor.id, now);
      created.push({ id: itemId, item_name: m.name, quantity: line.quantity, station_id: m.station_id, status });
    }

    q.run('UPDATE orders SET ordering_user_id = NULL, ordering_until = NULL WHERE id = ?', orderId);
    recomputeOrder(orderId);
    audit(actor, {
      action: 'order.items_add',
      entityType: 'order',
      entityId: orderId,
      summary: `${actor.name} ${describeItems(created)} را به سفارش #${order.order_number} اضافه کرد${batchNo > 1 ? ` (مرحله ${batchNo})` : ''}`,
      metadata: { batchNo, items: created.map((c) => ({ id: c.id, name: c.item_name, quantity: c.quantity })) },
    });

    return {
      duplicate: false,
      orderId,
      tableId: order.table_id,
      stationIds: created.filter((c) => c.status === ITEM.PENDING).map((c) => c.station_id),
      readyItems: created.filter((c) => c.status === ITEM.READY),
    };
  });

  if (!outcome.duplicate) {
    notify.orderChanged(actor.restaurantId, outcome);
    notify.stationsChanged(actor.restaurantId, outcome.stationIds);
    if (outcome.readyItems.length) notify.itemsReady(actor.restaurantId, readyPayload(orderId, outcome.readyItems));
  }
  return { duplicate: outcome.duplicate, order: getOrderDetail(actor, orderId) };
}

/** Edit quantity / note of an item that nobody has started yet. */
export function editItem(actor, itemId, { quantity, note, version }) {
  const outcome = transaction(() => {
    const item = q.get(
      `SELECT oi.*, o.order_number, o.lifecycle, o.table_id, o.restaurant_id
         FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ?`,
      itemId,
    );
    if (!item || item.restaurant_id !== actor.restaurantId) throw notFound('آیتم سفارش یافت نشد');
    if (item.lifecycle !== 'ACTIVE') throw conflict(`سفارش #${item.order_number} ${LIFECYCLE_FA[item.lifecycle]} است`);
    if (item.status !== ITEM.PENDING) throw conflict(`${item.item_name} در وضعیت ${st(item.status)} است و دیگر قابل ویرایش نیست`, { status: item.status });

    const { changes } = q.run(
      `UPDATE order_items SET quantity = ?, note = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ? AND status = 'PENDING'`,
      quantity ?? item.quantity,
      note ?? item.note,
      nowIso(),
      itemId,
      version,
    );
    if (changes === 0) throw conflict(`${item.item_name} توسط کاربر دیگری تغییر کرده است؛ دوباره تلاش کنید`);
    recomputeOrder(item.order_id);
    const parts = [];
    if (quantity !== undefined && quantity !== item.quantity) parts.push(`تعداد از ${item.quantity} به ${quantity}`);
    if (note !== undefined && note !== item.note) parts.push(`توضیح «${note}»`);
    audit(actor, {
      action: 'order_item.update',
      entityType: 'order_item',
      entityId: itemId,
      summary: `${actor.name} ${item.item_name} در سفارش #${item.order_number} را تغییر داد: ${joinFa(parts) || 'بدون تغییر'}`,
    });
    return { orderId: item.order_id, tableId: item.table_id, stationId: item.station_id };
  });
  notify.orderChanged(actor.restaurantId, outcome);
  notify.stationsChanged(actor.restaurantId, [outcome.stationId]);
  return getOrderDetail(actor, outcome.orderId);
}

/** Single item transition, permission-checked against role and station. */
export function changeItemStatus(actor, itemId, { from, to, reason }) {
  const outcome = transaction(() => {
    const item = q.get(
      `SELECT oi.*, o.order_number, o.lifecycle, o.table_id, o.restaurant_id
         FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = ?`,
      itemId,
    );
    if (!item || item.restaurant_id !== actor.restaurantId) throw notFound('آیتم سفارش یافت نشد');

    const isStationRole = actor.roleCode === ROLES.KITCHEN || actor.roleCode === ROLES.BAR;
    const staffOfStation = worksStation(actor, item.station_id);
    // Station staff cannot see items of other stations at all.
    if (isStationRole && !staffOfStation) throw notFound('آیتم سفارش یافت نشد');
    if (item.lifecycle !== 'ACTIVE') throw conflict(`سفارش #${item.order_number} ${LIFECYCLE_FA[item.lifecycle]} است`);
    if (item.status !== from) {
      throw conflict(`${item.item_name} در حال حاضر ${st(item.status)} است`, { itemId, status: item.status });
    }
    if (!canTransition(actor.roleCode, from, to, { worksStation: staffOfStation })) {
      throw forbidden(`نقش شما نمی‌تواند وضعیت را از ${st(from)} به ${st(to)} تغییر دهد`);
    }

    moveItem(actor, item, to, nowIso(), { reason });
    recomputeOrder(item.order_id);
    audit(actor, {
      action: to === ITEM.CANCELLED ? 'order_item.cancel' : 'order_item.status',
      entityType: 'order_item',
      entityId: itemId,
      summary: `${actor.name} وضعیت ${item.item_name} ×${item.quantity} (سفارش #${item.order_number}) را از ${st(from)} به ${st(to)} تغییر داد${reason ? `: ${reason}` : ''}`,
      metadata: { from, to, orderId: item.order_id },
    });
    return { orderId: item.order_id, tableId: item.table_id, stationId: item.station_id, item, to };
  });

  notify.orderChanged(actor.restaurantId, outcome);
  notify.stationsChanged(actor.restaurantId, [outcome.stationId]);
  if (outcome.to === ITEM.READY) notify.itemsReady(actor.restaurantId, readyPayload(outcome.orderId, [outcome.item]));
  return { orderId: outcome.orderId, itemId, status: outcome.to };
}

/**
 * Bulk transition for one station ticket (order batch × station):
 *   PREPARING — start every pending item
 *   READY     — finish every pending/preparing item (pending ones pass through PREPARING)
 *   DELIVERED — hand over every ready item
 */
export function advanceTicket(actor, stationId, batchId, { to }) {
  const outcome = transaction(() => {
    const station = q.get('SELECT * FROM stations WHERE id = ? AND restaurant_id = ?', stationId, actor.restaurantId);
    if (!station || !worksStation(actor, stationId)) throw notFound('ایستگاه یافت نشد');
    const batch = q.get(
      `SELECT b.*, o.order_number, o.lifecycle, o.table_id, o.id AS order_id
         FROM order_batches b JOIN orders o ON o.id = b.order_id
        WHERE b.id = ? AND o.restaurant_id = ?`,
      batchId,
      actor.restaurantId,
    );
    if (!batch) throw notFound('فیش سفارش یافت نشد');
    if (batch.lifecycle !== 'ACTIVE') throw conflict(`سفارش #${batch.order_number} ${LIFECYCLE_FA[batch.lifecycle]} است`);

    const items = q.all('SELECT * FROM order_items WHERE batch_id = ? AND station_id = ? ORDER BY id', batchId, stationId);
    const now = nowIso();
    const moved = [];
    for (const item of items) {
      const steps =
        to === ITEM.PREPARING ? (item.status === ITEM.PENDING ? [ITEM.PREPARING] : [])
        : to === ITEM.READY ? (item.status === ITEM.PENDING ? [ITEM.PREPARING, ITEM.READY] : item.status === ITEM.PREPARING ? [ITEM.READY] : [])
        : to === ITEM.DELIVERED ? (item.status === ITEM.READY ? [ITEM.DELIVERED] : [])
        : null;
      if (steps === null) throw badRequest('عملیات نامعتبر است');
      if (steps.length === 0) continue;
      for (const step of steps) {
        if (!canTransition(actor.roleCode, item.status, step, { worksStation: true })) throw forbidden();
        moveItem(actor, item, step, now);
      }
      moved.push(item);
    }
    if (moved.length === 0) throw conflict('این فیش قبلاً به‌روزرسانی شده است', { batchId });

    recomputeOrder(batch.order_id);
    audit(actor, {
      action: 'order_item.status',
      entityType: 'order',
      entityId: batch.order_id,
      summary: `${actor.name} ${describeItems(moved)} را ${st(to)} کرد (سفارش #${batch.order_number}، ${station.name})`,
      metadata: { to, batchId, stationId, itemIds: moved.map((m) => m.id) },
    });
    return { orderId: batch.order_id, tableId: batch.table_id, moved };
  });

  notify.orderChanged(actor.restaurantId, outcome);
  notify.stationsChanged(actor.restaurantId, [stationId]);
  if (to === ITEM.READY) notify.itemsReady(actor.restaurantId, readyPayload(outcome.orderId, outcome.moved));
  return { orderId: outcome.orderId, moved: outcome.moved.length };
}

/** Waiter hands over everything that is ready for the order. */
export function deliverReady(actor, orderId) {
  const outcome = transaction(() => {
    const order = loadOrder(actor, orderId);
    assertActive(order);
    const items = q.all("SELECT * FROM order_items WHERE order_id = ? AND status = 'READY'", orderId);
    if (items.length === 0) throw conflict('آیتم آماده‌ای برای تحویل وجود ندارد');
    const now = nowIso();
    for (const item of items) moveItem(actor, item, ITEM.DELIVERED, now);
    recomputeOrder(orderId);
    audit(actor, {
      action: 'order_item.status',
      entityType: 'order',
      entityId: orderId,
      summary: `${actor.name} ${describeItems(items)} را تحویل داد (سفارش #${order.order_number})`,
    });
    return { orderId, tableId: order.table_id, stationIds: items.map((i) => i.station_id) };
  });
  notify.orderChanged(actor.restaurantId, outcome);
  notify.stationsChanged(actor.restaurantId, outcome.stationIds);
  return getOrderDetail(actor, orderId);
}

export function completeOrder(actor, orderId) {
  const outcome = transaction(() => {
    const order = loadOrder(actor, orderId);
    assertActive(order);
    return completeOrderInTx(actor, order);
  });
  notify.orderChanged(actor.restaurantId, outcome);
  return getOrderDetail(actor, orderId);
}

/**
 * Close an ACTIVE order: everything served and, when the restaurant requires it, fully paid.
 * Runs inside the caller's transaction (also used by the cashier's "pay and complete").
 */
export function completeOrderInTx(actor, order) {
  const fresh = q.get('SELECT * FROM orders WHERE id = ?', order.id);
  const restaurant = getRestaurant(actor.restaurantId);
  const blocked = completeBlockedReason(restaurant, fresh, itemCounts(fresh.id));
  if (blocked) throw conflict(blocked);

  const now = nowIso();
  q.run(
    `UPDATE orders SET lifecycle = 'COMPLETED', completed_at = ?, completed_by = ?, ordering_user_id = NULL, ordering_until = NULL, updated_at = ?
      WHERE id = ?`,
    now,
    actor.id,
    now,
    fresh.id,
  );
  recomputeOrder(fresh.id);
  audit(actor, {
    action: 'order.complete',
    entityType: 'order',
    entityId: fresh.id,
    summary: `${actor.name} سفارش #${fresh.order_number} را تکمیل کرد`,
    metadata: { total: fresh.subtotal, paid: fresh.paid_amount },
  });
  return { orderId: fresh.id, tableId: fresh.table_id };
}

/** Can this order be completed right now? Used by the cashier's "pay and complete". */
export function canCompleteInTx(actor, orderId) {
  const fresh = q.get('SELECT * FROM orders WHERE id = ?', orderId);
  return !completeBlockedReason(getRestaurant(actor.restaurantId), fresh, itemCounts(orderId));
}

export function cancelOrder(actor, orderId, { reason }) {
  const outcome = transaction(() => {
    const order = loadOrder(actor, orderId);
    assertActive(order);
    const payments = q.get('SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND voided_at IS NULL', orderId).n;
    if (payments > 0) throw conflict('برای این سفارش پرداخت ثبت شده است؛ ابتدا پرداخت‌ها را در صندوق باطل کنید');
    const items = q.all("SELECT * FROM order_items WHERE order_id = ? AND status NOT IN ('CANCELLED','DELIVERED')", orderId);
    if (actor.roleCode !== ROLES.MANAGER) {
      const started = q.get("SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND status NOT IN ('PENDING','CANCELLED')", orderId).n;
      if (started > 0) throw forbidden('اقلام این سفارش در حال آماده‌سازی یا سرو شده‌اند؛ لغو آن فقط توسط مدیر ممکن است');
    }
    const now = nowIso();
    for (const item of items) moveItem(actor, item, ITEM.CANCELLED, now, { reason });
    q.run(
      `UPDATE orders SET lifecycle = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, released_at = ?,
              ordering_user_id = NULL, ordering_until = NULL, updated_at = ?
        WHERE id = ?`,
      now,
      actor.id,
      reason,
      now,
      now,
      orderId,
    );
    recomputeOrder(orderId);
    audit(actor, {
      action: 'order.cancel',
      entityType: 'order',
      entityId: orderId,
      summary: `${actor.name} سفارش #${order.order_number} را لغو کرد: ${reason}`,
    });
    return { orderId, tableId: order.table_id, stationIds: items.map((i) => i.station_id) };
  });
  notify.orderChanged(actor.restaurantId, outcome);
  notify.stationsChanged(actor.restaurantId, outcome.stationIds);
  return getOrderDetail(actor, orderId);
}

/** "A waiter is composing items for this table" presence, shown on the floor plan. */
export function setOrderingPresence(actor, orderId, active) {
  const outcome = transaction(() => {
    const order = loadOrder(actor, orderId);
    if (order.lifecycle !== 'ACTIVE') return { changed: false };
    const now = Date.now();
    const wasActive = order.ordering_until && new Date(order.ordering_until).getTime() > now;
    if (active) {
      q.run('UPDATE orders SET ordering_user_id = ?, ordering_until = ? WHERE id = ?', actor.id, new Date(now + ORDERING_PRESENCE_MS).toISOString(), orderId);
      return { changed: !wasActive || order.ordering_user_id !== actor.id, orderId, tableId: order.table_id };
    }
    if (order.ordering_user_id !== actor.id) return { changed: false };
    q.run('UPDATE orders SET ordering_user_id = NULL, ordering_until = NULL WHERE id = ?', orderId);
    return { changed: !!wasActive, orderId, tableId: order.table_id };
  });
  if (outcome.changed) notify.orderChanged(actor.restaurantId, outcome);
  return { ok: true };
}

/* ───────────────────────────── receipt ───────────────────────────── */

export function getReceipt(actor, orderId) {
  const order = getOrderDetail(actor, orderId);
  const restaurant = getRestaurant(actor.restaurantId);
  const lines = new Map();
  for (const batch of order.batches) {
    for (const item of batch.items) {
      if (item.status === ITEM.CANCELLED) continue;
      const k = `${item.menuItemId}|${item.unitPrice}|${item.name}`;
      const line = lines.get(k) ?? { name: item.name, unitPrice: item.unitPrice, quantity: 0, lineTotal: 0 };
      line.quantity += item.quantity;
      line.lineTotal += item.lineTotal;
      lines.set(k, line);
    }
  }
  const validPayments = order.payments.filter((p) => !p.voidedAt);
  return {
    restaurant: {
      name: restaurant.name,
      address: restaurant.address,
      phone: restaurant.phone,
      footer: restaurant.receipt_footer,
      currencySymbol: restaurant.currency_symbol,
      currencyDecimals: restaurant.currency_decimals,
      timezone: restaurant.timezone,
    },
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      table: order.table.name,
      waiter: order.waiter.name,
      guestCount: order.guestCount,
      openedAt: order.openedAt,
      completedAt: order.completedAt,
      lifecycle: order.lifecycle,
      status: order.status,
    },
    lines: [...lines.values()],
    itemCount: [...lines.values()].reduce((n, l) => n + l.quantity, 0),
    total: order.total,
    payments: validPayments.map((p) => ({ method: p.method, amount: p.amount, receivedAmount: p.receivedAmount, change: p.change, reference: p.reference })),
    paidAmount: order.paidAmount,
    remaining: order.remaining,
    paymentStatus: order.paymentStatus,
    changeGiven: validPayments.reduce((n, p) => n + p.change, 0),
    printedAt: nowIso(),
    printCount: order.receiptPrintCount,
  };
}

export function markReceiptPrinted(actor, orderId) {
  transaction(() => {
    const order = loadOrder(actor, orderId);
    q.run('UPDATE orders SET receipt_print_count = receipt_print_count + 1, updated_at = ? WHERE id = ?', nowIso(), orderId);
    audit(actor, {
      action: 'order.receipt_print',
      entityType: 'order',
      entityId: orderId,
      summary: `${actor.name} فیش سفارش #${order.order_number} را چاپ کرد${order.receipt_print_count > 0 ? ` (نسخه ${order.receipt_print_count + 1})` : ''}`,
    });
  });
  return { ok: true };
}
