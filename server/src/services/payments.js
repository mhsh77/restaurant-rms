/**
 * Cashier: recording money received for an order (cash, card terminal, other), split bills,
 * cash change, voiding mistakes, and the day's collection summary.
 *
 * Not a payment gateway and not accounting: the system records what the cashier took.
 * Safety rules:
 *  - a payment can never exceed what is still due (the cash handed over may, → change);
 *  - clientRequestId makes a double tap / network retry record the payment once;
 *  - payments are never deleted, only voided with a reason (audited);
 *  - the order's paid amount and payment status are recomputed in the same transaction.
 */
import { q, transaction, nowIso } from '../db/connection.js';
import { audit } from './audit.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { containsAny, latinDigits } from '../http/validate.js';
import { notify } from '../realtime/hub.js';
import { getRestaurant } from './restaurant.js';
import { businessDate } from './time.js';
import { formatMoney } from './money.js';
import { canCompleteInTx, completeOrderInTx, getOrderDetail, recomputeOrder } from './orders.js';
import { paymentTotals } from './reports.js';
import { PAYMENT_METHOD_FA } from './labels.js';

export function recordPayment(actor, orderId, input) {
  const outcome = transaction(() => {
    const order = q.get('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?', orderId, actor.restaurantId);
    if (!order) throw notFound('سفارش یافت نشد');
    if (order.lifecycle === 'CANCELLED') throw conflict(`سفارش #${order.order_number} لغو شده است`);

    const duplicate = q.get('SELECT id FROM payments WHERE order_id = ? AND client_request_id = ?', orderId, input.clientRequestId);
    if (duplicate) return { duplicate: true, orderId, tableId: order.table_id, change: 0, completed: false };

    const restaurant = getRestaurant(actor.restaurantId);
    const money = (m) => formatMoney(restaurant, m);
    const remaining = order.subtotal - order.paid_amount;
    if (remaining <= 0) throw conflict(`صورتحساب سفارش #${order.order_number} قبلاً تسویه شده است`);
    if (input.amount > remaining) {
      throw conflict(`مبلغ پرداخت (${money(input.amount)}) بیشتر از مانده صورتحساب (${money(remaining)}) است`, { remaining });
    }

    let received = null;
    if (input.method === 'CASH') {
      received = input.receivedAmount ?? input.amount;
      if (received < input.amount) throw badRequest('مبلغ دریافتی نقدی نمی‌تواند کمتر از مبلغ پرداخت باشد');
    }

    const now = new Date();
    const paymentId = Number(
      q.run(
        `INSERT INTO payments (restaurant_id, order_id, method, amount, received_amount, reference, client_request_id, business_date, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        actor.restaurantId,
        orderId,
        input.method,
        input.amount,
        received,
        input.reference ?? '',
        input.clientRequestId,
        businessDate(restaurant, now),
        actor.id,
        now.toISOString(),
      ).lastInsertRowid,
    );
    recomputeOrder(orderId);

    const change = received !== null ? received - input.amount : 0;
    audit(actor, {
      action: 'payment.create',
      entityType: 'order',
      entityId: orderId,
      summary:
        `${actor.name} مبلغ ${money(input.amount)} (${PAYMENT_METHOD_FA[input.method]}) برای سفارش #${order.order_number} دریافت کرد` +
        (change > 0 ? ` — دریافتی ${money(received)}، باقی ${money(change)}` : ''),
      metadata: { paymentId, method: input.method, amount: input.amount, received, reference: input.reference || undefined },
    });

    // "Pay and complete": only when this payment settled the bill and everything was served.
    let completed = false;
    const after = q.get('SELECT lifecycle, payment_status FROM orders WHERE id = ?', orderId);
    if (input.completeOrder && after.lifecycle === 'ACTIVE' && after.payment_status === 'PAID' && canCompleteInTx(actor, orderId)) {
      completeOrderInTx(actor, order);
      completed = true;
    }
    return { duplicate: false, orderId, tableId: order.table_id, change, completed, paymentId };
  });

  if (!outcome.duplicate) notify.orderChanged(actor.restaurantId, outcome);
  return { ...outcome, order: getOrderDetail(actor, orderId) };
}

export function voidPayment(actor, paymentId, { reason }) {
  const outcome = transaction(() => {
    const payment = q.get(
      `SELECT p.*, o.order_number, o.table_id, o.lifecycle
         FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.id = ? AND p.restaurant_id = ?`,
      paymentId,
      actor.restaurantId,
    );
    if (!payment) throw notFound('پرداخت یافت نشد');
    const now = nowIso();
    const { changes } = q.run('UPDATE payments SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL', now, actor.id, reason, paymentId);
    if (changes === 0) throw conflict('این پرداخت قبلاً باطل شده است');
    recomputeOrder(payment.order_id);
    const restaurant = getRestaurant(actor.restaurantId);
    audit(actor, {
      action: 'payment.void',
      entityType: 'order',
      entityId: payment.order_id,
      summary: `${actor.name} پرداخت ${formatMoney(restaurant, payment.amount)} (${PAYMENT_METHOD_FA[payment.method]}) سفارش #${payment.order_number} را باطل کرد: ${reason}`,
      metadata: { paymentId, amount: payment.amount, method: payment.method, orderLifecycle: payment.lifecycle },
    });
    return { orderId: payment.order_id, tableId: payment.table_id };
  });
  notify.orderChanged(actor.restaurantId, outcome);
  return { order: getOrderDetail(actor, outcome.orderId) };
}

/**
 * Orders for the cashier screen.
 *   due  — not cancelled, has a total, and paid ≠ total (unpaid, partial or overpaid)
 *   paid — fully settled with a payment taken today
 */
export function cashierOrders(actor, { view = 'due', q: search } = {}) {
  const restaurant = getRestaurant(actor.restaurantId);
  const where = ['o.restaurant_id = ?', "o.lifecycle != 'CANCELLED'", 'o.subtotal > 0'];
  const params = [actor.restaurantId];
  if (view === 'due') {
    where.push('o.paid_amount != o.subtotal');
  } else {
    where.push("o.payment_status = 'PAID'", 'EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.voided_at IS NULL AND p.business_date = ?)');
    params.push(businessDate(restaurant));
  }
  if (search) {
    const text = String(search).trim();
    const digits = latinDigits(text).replace(/^#/, '');
    if (/^\d+$/.test(digits)) where.push('CAST(o.order_number AS TEXT) LIKE ?'), params.push(`${digits}%`);
    else {
      const match = containsAny(['t.name', 'w.name'], text);
      where.push(match.sql);
      params.push(...match.params);
    }
  }

  const rows = q.all(
    `SELECT o.id, o.order_number, o.lifecycle, o.status, o.subtotal, o.paid_amount, o.payment_status, o.guest_count, o.opened_at, o.completed_at,
            t.id AS table_id, t.name AS table_name, w.id AS waiter_id, w.name AS waiter_name,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status IN ('PENDING','PREPARING','READY')) AS open_items,
            (SELECT MAX(p.created_at) FROM payments p WHERE p.order_id = o.id AND p.voided_at IS NULL) AS last_payment_at
       FROM orders o
       JOIN dining_tables t ON t.id = o.table_id
       JOIN users w ON w.id = o.waiter_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${view === 'due' ? "(o.lifecycle = 'COMPLETED') DESC, (open_items = 0) DESC, o.opened_at" : 'last_payment_at DESC'}
      LIMIT 200`,
    ...params,
  );
  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    lifecycle: r.lifecycle,
    status: r.status,
    total: r.subtotal,
    paidAmount: r.paid_amount,
    remaining: r.subtotal - r.paid_amount,
    paymentStatus: r.payment_status,
    guestCount: r.guest_count,
    openItems: r.open_items,
    openedAt: r.opened_at,
    completedAt: r.completed_at,
    lastPaymentAt: r.last_payment_at,
    table: { id: r.table_id, name: r.table_name },
    waiter: { id: r.waiter_id, name: r.waiter_name },
  }));
}

/** Today's register: money taken by method, change given, voids, and what is still due. */
export function cashierSummary(actor) {
  const restaurant = getRestaurant(actor.restaurantId);
  const today = businessDate(restaurant);
  const due = q.get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal - paid_amount), 0) AS amount
       FROM orders WHERE restaurant_id = ? AND lifecycle != 'CANCELLED' AND subtotal > 0 AND paid_amount < subtotal`,
    restaurant.id,
  );
  const overpaid = q.get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(paid_amount - subtotal), 0) AS amount
       FROM orders WHERE restaurant_id = ? AND lifecycle != 'CANCELLED' AND paid_amount > subtotal`,
    restaurant.id,
  );
  const paidOrders = q.get(
    `SELECT COUNT(DISTINCT order_id) AS n FROM payments WHERE restaurant_id = ? AND business_date = ? AND voided_at IS NULL`,
    restaurant.id,
    today,
  ).n;
  return {
    businessDate: today,
    ...paymentTotals(restaurant.id, today, today),
    paidOrders,
    due: { count: due.n, amount: due.amount },
    overpaid: { count: overpaid.n, amount: overpaid.amount },
  };
}
