/**
 * Counter ordering: the guest orders at the cashier and pays before anything is cooked.
 *
 *   COUNTER_TABLE   they then sit down and a waiter brings the food. The cashier may pick a
 *                   free table straight away, or leave it empty and let whoever spots the
 *                   guest attach the table afterwards.
 *   COUNTER_PICKUP  they wait at the counter; there is no table and no waiter. Handing the
 *                   order over closes it.
 *
 * Money first, on purpose: the order, its items and the payment are written in one
 * transaction, so the kitchen never receives an unpaid counter order and a half-finished
 * counter order cannot exist. A repeated submit (double tap, retry after a timeout) is
 * recognised by clientRequestId and returns the original order instead of a second one.
 */
import { q, transaction, nowIso } from '../db/connection.js';
import { audit } from './audit.js';
import { badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { PERMISSIONS, roleHas } from '../auth/permissions.js';
import { notify } from '../realtime/hub.js';
import { getRestaurant, serviceModes } from './restaurant.js';
import { businessDate } from './time.js';
import { formatMoney } from './money.js';
import { getTable } from './tables.js';
import { SERVICE_MODE_FA, placeLabel } from './labels.js';
import { deliverReady, completeOrder, getOrderDetail, insertBatchInTx, readyPayload, recomputeOrder } from './orders.js';
import { recordPaymentInTx } from './payments.js';

const COUNTER_MODES = ['COUNTER_TABLE', 'COUNTER_PICKUP'];

/** A cashier may only touch counter orders; a waiter or manager may touch any. */
export function assertMayHandle(actor, order) {
  if (roleHas(actor.roleCode, PERMISSIONS.ORDER_WRITE)) return;
  if (!COUNTER_MODES.includes(order.service_mode)) throw forbidden('این سفارش سر میز ثبت شده است و تغییر آن با گارسون است');
}

function loadCounterOrder(actor, orderId) {
  const order = q.get('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?', orderId, actor.restaurantId);
  if (!order) throw notFound('سفارش یافت نشد');
  return order;
}

/**
 * Take a counter order and its payment in one step.
 * `payment.amount` must settle the whole order — that is what "pay first" means here.
 */
export function createCounterOrder(actor, input) {
  const { mode, tableId = null, customerName = '', guestCount = 1, note = '', items, payment, clientRequestId } = input;

  const outcome = transaction(() => {
    const existing = q.get('SELECT id FROM orders WHERE restaurant_id = ? AND client_request_id = ?', actor.restaurantId, clientRequestId);
    if (existing) return { duplicate: true, orderId: existing.id, tableId: null, stationIds: [], readyItems: [], change: 0 };

    const restaurant = getRestaurant(actor.restaurantId);
    const modes = serviceModes(restaurant);
    if (!COUNTER_MODES.includes(mode)) throw badRequest('روش سفارش نامعتبر است');
    if (!modes[mode]) throw conflict(`روش «${SERVICE_MODE_FA[mode]}» در این رستوران فعال نیست`);

    let table = null;
    if (tableId !== null && tableId !== undefined) {
      if (mode !== 'COUNTER_TABLE') throw badRequest('سفارش بیرون‌بر میز ندارد');
      table = getTable(actor, tableId);
      const busy = q.get('SELECT order_number FROM orders WHERE table_id = ? AND released_at IS NULL', tableId);
      if (busy) throw conflict(`${table.name} سفارش باز #${busy.order_number} دارد`);
    }

    const { order_seq: orderNumber } = q.get('UPDATE restaurants SET order_seq = order_seq + 1 WHERE id = ? RETURNING order_seq', actor.restaurantId);
    const now = new Date();
    const iso = now.toISOString();
    const orderId = Number(
      q.run(
        `INSERT INTO orders (restaurant_id, order_number, table_id, waiter_id, service_mode, customer_name, client_request_id,
                             guest_count, note, business_date, opened_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        actor.restaurantId,
        orderNumber,
        table ? table.id : null,
        actor.id,
        mode,
        customerName,
        clientRequestId,
        guestCount,
        note,
        businessDate(restaurant, now),
        iso,
        iso,
      ).lastInsertRowid,
    );
    const order = q.get('SELECT * FROM orders WHERE id = ?', orderId);
    const { created } = insertBatchInTx(actor, order, { clientRequestId: `${clientRequestId}-items`, items });

    const total = q.get('SELECT subtotal FROM orders WHERE id = ?', orderId).subtotal;
    if (total <= 0) throw badRequest('سفارش خالی است');
    if (payment.amount !== total) {
      throw badRequest(`سفارش پیشخوان باید کامل پرداخت شود: مبلغ صورتحساب ${formatMoney(restaurant, total)} است`, { total });
    }
    const fresh = q.get('SELECT * FROM orders WHERE id = ?', orderId);
    const { change } = recordPaymentInTx(actor, fresh, { ...payment, clientRequestId }, restaurant);

    audit(actor, {
      action: 'order.create',
      entityType: 'order',
      entityId: orderId,
      summary:
        `${actor.name} سفارش #${orderNumber} را در پیشخوان ثبت و دریافت کرد ` +
        `(${SERVICE_MODE_FA[mode]}${table ? ` · ${table.name}` : ''}${customerName ? ` · ${customerName}` : ''})`,
      metadata: { serviceMode: mode, tableId: table ? table.id : null, customerName: customerName || undefined, total },
    });

    return {
      duplicate: false,
      orderId,
      tableId: table ? table.id : null,
      change,
      stationIds: created.filter((c) => c.status === 'PENDING').map((c) => c.station_id),
      readyItems: created.filter((c) => c.status === 'READY'),
    };
  });

  if (!outcome.duplicate) {
    notify.orderChanged(actor.restaurantId, outcome);
    notify.stationsChanged(actor.restaurantId, outcome.stationIds);
    // items from a no-preparation station (bottled water…) are ready the moment they are ordered
    if (outcome.readyItems.length) notify.itemsReady(actor.restaurantId, readyPayload(outcome.orderId, outcome.readyItems));
  }
  return { duplicate: outcome.duplicate, change: outcome.change, order: getOrderDetail(actor, outcome.orderId) };
}

/** Attach (or move) the table of a counter order after the guest has sat down. */
export function assignTable(actor, orderId, { tableId }) {
  const outcome = transaction(() => {
    const order = loadCounterOrder(actor, orderId);
    assertMayHandle(actor, order);
    if (order.lifecycle !== 'ACTIVE') throw conflict(`سفارش #${order.order_number} دیگر باز نیست`);
    if (order.service_mode === 'COUNTER_PICKUP') throw conflict('سفارش بیرون‌بر میز ندارد');

    const previous = order.table_id;
    let table = null;
    if (tableId !== null && tableId !== undefined) {
      table = getTable(actor, tableId);
      const busy = q.get('SELECT order_number FROM orders WHERE table_id = ? AND released_at IS NULL AND id <> ?', tableId, orderId);
      if (busy) throw conflict(`${table.name} سفارش باز #${busy.order_number} دارد`);
    }
    q.run('UPDATE orders SET table_id = ?, version = version + 1, updated_at = ? WHERE id = ?', table ? table.id : null, nowIso(), orderId);
    recomputeOrder(orderId);
    audit(actor, {
      action: 'order.update',
      entityType: 'order',
      entityId: orderId,
      summary: table
        ? `${actor.name} سفارش #${order.order_number} را به ${table.name} نسبت داد`
        : `${actor.name} میز سفارش #${order.order_number} را برداشت`,
      metadata: { from: previous, to: table ? table.id : null },
    });
    return { orderId, tableId: table ? table.id : null, previousTableId: previous };
  });
  notify.orderChanged(actor.restaurantId, outcome);
  return getOrderDetail(actor, orderId);
}

/**
 * Hand a pickup order to the guest waiting at the counter: everything ready is delivered and,
 * since there is no table to clear and it is already paid, the order closes itself.
 */
export function handOver(actor, orderId) {
  const order = loadCounterOrder(actor, orderId);
  assertMayHandle(actor, order);
  if (order.service_mode !== 'COUNTER_PICKUP') throw conflict('این سفارش بیرون‌بر نیست؛ تحویل آن با گارسون است');
  deliverReady(actor, orderId);
  const after = getOrderDetail(actor, orderId);
  return after.canComplete ? completeOrder(actor, orderId) : after;
}

/**
 * The counter's own queue: paid counter orders still being prepared or waiting to be handed
 * over, plus counter orders that are still looking for a table.
 */
export function counterQueue(actor) {
  const rows = q.all(
    `SELECT o.id, o.order_number, o.service_mode, o.customer_name, o.subtotal, o.opened_at, o.status,
            t.id AS table_id, t.name AS table_name,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status IN ('PENDING','PREPARING')) AS working,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'READY') AS ready
       FROM orders o
       LEFT JOIN dining_tables t ON t.id = o.table_id
      WHERE o.restaurant_id = ? AND o.lifecycle = 'ACTIVE' AND o.service_mode IN ('COUNTER_TABLE','COUNTER_PICKUP')
      ORDER BY o.opened_at`,
    actor.restaurantId,
  );
  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    serviceMode: r.service_mode,
    serviceModeLabel: SERVICE_MODE_FA[r.service_mode],
    customerName: r.customer_name,
    table: r.table_id ? { id: r.table_id, name: r.table_name } : null,
    place: placeLabel(r),
    needsTable: r.service_mode === 'COUNTER_TABLE' && !r.table_id,
    total: r.subtotal,
    status: r.status,
    openedAt: r.opened_at,
    working: r.working,
    ready: r.ready,
    canHandOver: r.service_mode === 'COUNTER_PICKUP' && r.ready > 0,
  }));
}
