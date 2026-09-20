/**
 * Cashier: permissions, split payments, cash change, over-payment protection, idempotency,
 * voiding, items added after payment, cancel protection, the completion rule and reports.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let srv;
let manager, ali, neda, sara;
let menuByName;
let stations;

before(async () => {
  srv = await startServer();
  [manager, ali, neda, sara] = await Promise.all([
    srv.login('manager', 'manager123'),
    srv.login('ali', 'waiter123'),
    srv.login('neda', 'cashier123'),
    srv.login('sara', 'kitchen123'),
  ]);
  menuByName = Object.fromEntries((await ali.get('/api/menu/items')).body.map((i) => [i.name, i]));
  stations = (await manager.get('/api/stations')).body.filter((s) => !s.autoReady);
});

after(async () => {
  await srv.stop();
});

let requestSeq = 0;
const rid = (label) => `${label}-${++requestSeq}-cashier-test`;

/** Waiter orders `lines` on a table; manager finishes every station ticket; waiter delivers. */
async function servedOrder(tableName, lines, existingOrderId) {
  const table = (await ali.get('/api/tables')).body.find((t) => t.name === tableName);
  const orderId = existingOrderId ?? (await ali.post('/api/orders', { tableId: table.id, guestCount: 2 })).body.id;
  const submit = await ali.post(`/api/orders/${orderId}/batches`, {
    clientRequestId: rid('batch'),
    items: lines.map(([name, quantity]) => ({ menuItemId: menuByName[name].id, quantity })),
  });
  assert.equal(submit.status, 201);
  for (const station of stations) {
    for (const ticket of (await manager.get(`/api/stations/${station.id}/tickets`)).body.tickets.filter((t) => t.orderId === orderId)) {
      assert.equal((await manager.post(`/api/stations/${station.id}/tickets/${ticket.batchId}/advance`, { to: 'READY' })).status, 200);
    }
  }
  const delivered = await ali.post(`/api/orders/${orderId}/deliver-ready`);
  assert.equal(delivered.status, 200);
  return delivered.body;
}

const pay = (client, orderId, body) => client.post(`/api/orders/${orderId}/payments`, { clientRequestId: rid('pay'), ...body });

test('cashier role: access is limited to the register and order viewing', async () => {
  assert.equal(neda.session.user.roleCode, 'CASHIER');
  assert.ok(neda.session.user.permissions.includes('cashier:work'));
  assert.equal((await neda.get('/api/cashier/orders')).status, 200);
  assert.equal((await neda.get('/api/cashier/summary')).status, 200);
  assert.equal((await neda.get('/api/orders')).status, 200);
  assert.equal((await neda.post('/api/orders', { tableId: 1, guestCount: 2 })).status, 403);
  // reads the floor to pick a table for a counter order, but cannot open or manage tables
  assert.equal((await neda.get('/api/tables')).status, 200);
  assert.equal((await neda.post('/api/tables', { name: 'میز ۱۱', capacity: 2 })).status, 403);
  assert.equal((await neda.get('/api/reports/dashboard')).status, 403);
  assert.equal((await neda.get('/api/users')).status, 403);

  assert.equal((await ali.get('/api/cashier/orders')).status, 403);
  assert.equal((await ali.get('/api/cashier/summary')).status, 403);
  assert.equal((await sara.get('/api/cashier/orders')).status, 403);
  assert.equal((await ali.post('/api/payments/1/void', { reason: 'x' })).status, 403);

  // The cashier's socket follows order changes.
  const socket = await neda.connectSocket();
  const table = (await ali.get('/api/tables')).body.find((t) => t.name === 'میز ۱');
  const opened = (await ali.post('/api/orders', { tableId: table.id, guestCount: 1 })).body;
  await socket.waitFor('orders:changed', (p) => p.orderId === opened.id);
  assert.equal((await ali.post(`/api/orders/${opened.id}/cancel`, { reason: 'تست' })).status, 200);
});

test('split payment, cash change, over-payment protection, idempotency, pay-and-complete', async () => {
  const order = await servedOrder('میز ۲', [
    ['پیتزا مارگاریتا', 1],
    ['نوشابه', 2],
  ]);
  const total = 380000 + 2 * 60000;
  assert.equal(order.total, total);
  assert.equal(order.paymentStatus, 'UNPAID');

  const due = (await neda.get('/api/cashier/orders?view=due')).body.find((o) => o.id === order.id);
  assert.equal(due.remaining, total);
  assert.equal(due.openItems, 0);

  // Part by card.
  const cardId = rid('card');
  const card = await neda.post(`/api/orders/${order.id}/payments`, { clientRequestId: cardId, method: 'CARD', amount: 200000, reference: '123456' });
  assert.equal(card.status, 201);
  assert.equal(card.body.order.paymentStatus, 'PARTIAL');
  assert.equal(card.body.order.remaining, 300000);
  // Double tap: same request id records nothing new.
  const again = await neda.post(`/api/orders/${order.id}/payments`, { clientRequestId: cardId, method: 'CARD', amount: 200000 });
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.order.paidAmount, 200000);

  // Cannot pay more than is due; cash handed over cannot be less than the amount.
  const over = await pay(neda, order.id, { method: 'CARD', amount: 400000 });
  assert.equal(over.status, 409);
  assert.match(over.body.error.message, /بیشتر از مانده/);
  assert.equal((await pay(neda, order.id, { method: 'CASH', amount: 300000, receivedAmount: 250000 })).status, 400);

  // Rest in cash with change, and complete in the same step.
  const cash = await pay(neda, order.id, { method: 'CASH', amount: 300000, receivedAmount: 500000, completeOrder: true });
  assert.equal(cash.status, 201);
  assert.equal(cash.body.change, 200000);
  assert.equal(cash.body.completed, true);
  assert.equal(cash.body.order.paymentStatus, 'PAID');
  assert.equal(cash.body.order.lifecycle, 'COMPLETED');

  // A settled bill cannot be paid again.
  assert.equal((await pay(neda, order.id, { method: 'CASH', amount: 1000 })).status, 409);

  // Lists and receipt.
  assert.ok(!(await neda.get('/api/cashier/orders?view=due')).body.some((o) => o.id === order.id));
  assert.ok((await neda.get('/api/cashier/orders?view=paid')).body.some((o) => o.id === order.id));
  const receipt = (await neda.get(`/api/orders/${order.id}/receipt`)).body;
  assert.deepEqual(receipt.payments.map((p) => `${p.method}:${p.amount}`), ['CARD:200000', 'CASH:300000']);
  assert.equal(receipt.paidAmount, total);
  assert.equal(receipt.remaining, 0);
  assert.equal(receipt.changeGiven, 200000);
  assert.equal((await neda.post(`/api/orders/${order.id}/receipt/printed`)).status, 200);

  // Register summary for today.
  const summary = (await neda.get('/api/cashier/summary')).body;
  assert.equal(summary.byMethod.find((m) => m.method === 'CASH').amount, 300000);
  assert.equal(summary.byMethod.find((m) => m.method === 'CARD').amount, 200000);
  assert.equal(summary.collected, total);
  assert.equal(summary.changeGiven, 200000);

  const audit = (await manager.get('/api/audit-logs?action=payment.create')).body.logs.map((l) => l.summary);
  assert.ok(audit.some((s) => s.includes('ندا کاظمی مبلغ 300,000 تومان (نقدی)') && s.includes('باقی 200,000 تومان')));
});

test('void, items added after payment, over-payment after a cancelled item, cancel protection', async () => {
  let order = await servedOrder('میز ۳', [['کاپوچینو', 1]]);
  const first = await pay(neda, order.id, { method: 'CASH', amount: 150000 });
  assert.equal(first.body.order.paymentStatus, 'PAID');

  // A new round after payment reopens the bill.
  const round2 = await ali.post(`/api/orders/${order.id}/batches`, { clientRequestId: rid('round2'), items: [{ menuItemId: menuByName['قهوه'].id, quantity: 1 }] });
  assert.equal(round2.body.order.paymentStatus, 'PARTIAL');
  assert.equal(round2.body.order.remaining, 130000);
  assert.ok((await neda.get('/api/cashier/orders')).body.some((o) => o.id === order.id));

  // An order with payments cannot be cancelled.
  const cancel = await manager.post(`/api/orders/${order.id}/cancel`, { reason: 'تست' });
  assert.equal(cancel.status, 409);
  assert.match(cancel.body.error.message, /باطل/);

  // Void needs a reason, happens once, and reopens the whole amount.
  const paymentId = first.body.order.payments[0].id;
  assert.equal((await neda.post(`/api/payments/${paymentId}/void`, { reason: '' })).status, 400);
  const voided = await neda.post(`/api/payments/${paymentId}/void`, { reason: 'ثبت اشتباه' });
  assert.equal(voided.status, 200);
  assert.equal(voided.body.order.paymentStatus, 'UNPAID');
  assert.equal(voided.body.order.payments[0].voidReason, 'ثبت اشتباه');
  assert.equal((await neda.post(`/api/payments/${paymentId}/void`, { reason: 'دوباره' })).status, 409);

  // Pay the full 280,000, then the pending coffee is cancelled → over-paid, completion blocked.
  const full = await pay(neda, order.id, { method: 'CARD', amount: 280000 });
  assert.equal(full.body.order.paymentStatus, 'PAID');
  order = full.body.order;
  const coffee = order.batches[1].items[0];
  assert.equal((await ali.post(`/api/order-items/${coffee.id}/status`, { from: 'PENDING', to: 'CANCELLED', reason: 'منصرف شد' })).status, 200);
  order = (await ali.get(`/api/orders/${order.id}`)).body;
  assert.equal(order.paymentStatus, 'OVERPAID');
  assert.equal(order.remaining, -130000);
  assert.equal(order.canComplete, false);
  assert.match(order.completeBlockedReason, /اضافه پرداخت/);
  assert.ok((await neda.get('/api/cashier/orders')).body.some((o) => o.id === order.id));
  assert.equal((await neda.get('/api/cashier/summary')).body.overpaid.amount, 130000);

  // Fix: void the card payment, take the right amount, complete.
  const cardId = order.payments.find((p) => p.method === 'CARD' && !p.voidedAt).id;
  assert.equal((await neda.post(`/api/payments/${cardId}/void`, { reason: 'مبلغ اشتباه' })).status, 200);
  const fixed = await pay(neda, order.id, { method: 'CARD', amount: 150000, completeOrder: true });
  assert.equal(fixed.body.order.paymentStatus, 'PAID');
  assert.equal(fixed.body.completed, true);
  assert.equal((await ali.post(`/api/tables/${order.table.id}/release`)).status, 200);
});

test('completion rule can be switched off; reports and CSV include payments', async () => {
  assert.equal((await manager.put('/api/restaurant', { requirePaymentToComplete: false })).status, 200);
  const order = await servedOrder('میز ۴', [['چای', 2]]);
  assert.equal(order.canComplete, true);
  const completed = await ali.post(`/api/orders/${order.id}/complete`);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.paymentStatus, 'UNPAID');
  // A completed but unpaid bill still waits at the register.
  assert.ok((await neda.get('/api/cashier/orders')).body.some((o) => o.id === order.id && o.lifecycle === 'COMPLETED'));
  assert.equal((await manager.put('/api/restaurant', { requirePaymentToComplete: true })).status, 200);

  const report = (await manager.get('/api/reports/summary?range=today')).body;
  assert.ok(report.payments.collected >= 500000 + 150000);
  assert.equal(report.payments.voided.count, 2);
  assert.equal(report.unpaid.count, 1);
  assert.equal(report.unpaid.amount, 140000);
  assert.ok((await manager.get('/api/reports/dashboard')).body.payments.byMethod.length === 3);

  const csv = await manager.get('/api/reports/export?type=payments&range=today');
  assert.equal(csv.status, 200);
  assert.match(csv.body, /روش پرداخت/);
  assert.match(csv.body, /کارت‌خوان,200000/);
  assert.match(csv.body, /باطل‌شده,ثبت اشتباه/);

  // Orders can be filtered by payment status.
  const unpaid = (await manager.get('/api/orders?paymentStatus=UNPAID&status=COMPLETED')).body.orders;
  assert.ok(unpaid.some((o) => o.id === order.id));
});
