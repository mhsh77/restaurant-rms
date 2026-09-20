/**
 * The two counter workflows: the guest orders and pays at the cashier, then either sits down
 * (a waiter brings it) or waits at the counter and takes it away.
 *
 * What matters here: nothing reaches the kitchen unpaid, a repeat submit does not order twice,
 * a pickup order needs no table and no waiter, a table can be attached afterwards, and the
 * manager's switches decide which workflows exist at all.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let srv;
let manager, ali, neda, sara, omid;
let menuByName;

const PIZZA = 'پیتزا مارگاریتا';
const COLA = 'نوشابه';
const WATER = 'آب معدنی'; // "other" station: ready without preparation

before(async () => {
  srv = await startServer();
  [manager, ali, neda, sara, omid] = await Promise.all([
    srv.login('manager', 'manager123'),
    srv.login('ali', 'waiter123'),
    srv.login('neda', 'cashier123'),
    srv.login('sara', 'kitchen123'),
    srv.login('omid', 'bar12345'),
  ]);
  menuByName = Object.fromEntries((await ali.get('/api/menu/items')).body.map((i) => [i.name, i]));
  // the demo enables all three, which is what these tests exercise
  await manager.put('/api/restaurant', { modeTableService: true, modeCounterTable: true, modeCounterPickup: true });
});

after(async () => {
  await srv.stop();
});

let seq = 0;
const rid = (label) => `${label}-${++seq}-counter-test`;
const line = (name, quantity) => ({ menuItemId: menuByName[name].id, quantity });
const priceOf = (lines) => lines.reduce((n, [name, qty]) => n + menuByName[name].price * qty, 0);

/** Order and pay at the counter, the way the cashier screen does it. */
function counterOrder(client, mode, lines, extra = {}) {
  const total = priceOf(lines);
  return client.post('/api/counter-orders', {
    clientRequestId: rid('counter'),
    mode,
    items: lines.map(([name, qty]) => line(name, qty)),
    payment: { method: 'CASH', amount: total, receivedAmount: total },
    ...extra,
  });
}

const tableByName = async (name) => (await ali.get('/api/tables')).body.find((t) => t.name === name);
const stationOf = async (client) => (await client.get('/api/auth/me')).body.stations.find((s) => !s.autoReady);

/** Work a station ticket the way the kitchen screen's buttons do. */
async function cook(client, orderId, to = 'READY') {
  const station = await stationOf(client);
  const { tickets } = (await client.get(`/api/stations/${station.id}/tickets`)).body;
  for (const t of tickets.filter((x) => x.orderId === orderId)) {
    await client.post(`/api/stations/${station.id}/tickets/${t.batchId}/advance`, { to });
  }
}

test('pickup: paid at the counter, cooked, handed over — no table, no waiter', async () => {
  const lines = [[PIZZA, 2], [COLA, 1]];
  const total = priceOf(lines);
  const res = await neda.post('/api/counter-orders', {
    clientRequestId: rid('pickup'),
    mode: 'COUNTER_PICKUP',
    customerName: 'رضا',
    items: lines.map(([n, q]) => line(n, q)),
    payment: { method: 'CASH', amount: total, receivedAmount: 2_000_000 },
  });
  assert.equal(res.status, 201);
  const order = res.body.order;
  assert.equal(order.serviceMode, 'COUNTER_PICKUP');
  assert.equal(order.table, null, 'a pickup order has no table');
  assert.equal(order.place, 'بیرون‌بر');
  assert.equal(order.customerName, 'رضا');
  assert.equal(order.total, total);
  assert.equal(order.paymentStatus, 'PAID', 'paid before the kitchen ever sees it');
  assert.equal(res.body.change, 2_000_000 - total);

  // the kitchen sees it as a counter ticket, not as a table
  const station = await stationOf(sara);
  const ticket = (await sara.get(`/api/stations/${station.id}/tickets`)).body.tickets.find((t) => t.orderId === order.id);
  assert.ok(ticket, 'the kitchen received the ticket');
  assert.equal(ticket.tableName, 'بیرون‌بر');
  assert.equal(ticket.customerName, 'رضا');

  await cook(sara, order.id);
  await cook(omid, order.id);

  const queued = (await neda.get('/api/counter/queue')).body.find((o) => o.id === order.id);
  assert.equal(queued.canHandOver, true, 'everything is ready at the counter');

  const handed = await neda.post(`/api/orders/${order.id}/hand-over`);
  assert.equal(handed.status, 200);
  assert.equal(handed.body.status, 'COMPLETED');
  assert.equal(handed.body.lifecycle, 'COMPLETED', 'handing it over closes a paid pickup order');
  assert.equal(handed.body.counts.DELIVERED, 2);
  assert.equal((await neda.get('/api/counter/queue')).body.find((o) => o.id === order.id), undefined);
});

test('counter + table: table chosen at the counter, waiter delivers, then completes', async () => {
  const table = await tableByName('میز ۳');
  const lines = [[PIZZA, 1]];
  const res = await counterOrder(neda, 'COUNTER_TABLE', lines, { tableId: table.id, guestCount: 2 });
  assert.equal(res.status, 201);
  const order = res.body.order;
  assert.equal(order.table.id, table.id);
  assert.equal(order.paymentStatus, 'PAID');

  // it behaves like any other seated order: it shows on the floor
  const tile = (await ali.get('/api/tables')).body.find((t) => t.id === table.id);
  assert.equal(tile.order.id, order.id);
  // the items were sent with the order, so the table is already "being prepared"
  assert.equal(tile.status, 'PREPARING');

  await cook(sara, order.id);
  const bell = (await ali.get('/api/orders/ready')).body.find((g) => g.orderId === order.id);
  assert.equal(bell.table.name, table.name, 'the waiter is told where to take it');

  await ali.post(`/api/orders/${order.id}/deliver-ready`);
  const completed = await ali.post(`/api/orders/${order.id}/complete`);
  assert.equal(completed.status, 200, 'already paid, so completion is not blocked');
  assert.equal(completed.body.lifecycle, 'COMPLETED');
  await ali.post(`/api/tables/${table.id}/release`);
});

test('counter + table: no table yet — anyone can attach one later', async () => {
  const res = await counterOrder(neda, 'COUNTER_TABLE', [[PIZZA, 1]]);
  const order = res.body.order;
  assert.equal(order.table, null);
  assert.equal(order.place, 'بدون میز');

  const waiting = (await neda.get('/api/counter/queue')).body.find((o) => o.id === order.id);
  assert.equal(waiting.needsTable, true);

  const table = await tableByName('میز ۴');
  const assigned = await ali.post(`/api/orders/${order.id}/table`, { tableId: table.id });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.table.id, table.id);
  assert.equal((await neda.get('/api/counter/queue')).body.find((o) => o.id === order.id).needsTable, false);

  // a table that already has a live order cannot be taken over
  const busy = await neda.post('/api/counter-orders', {
    clientRequestId: rid('busy'),
    mode: 'COUNTER_TABLE',
    tableId: table.id,
    items: [line(PIZZA, 1)],
    payment: { method: 'CARD', amount: menuByName[PIZZA].price },
  });
  assert.equal(busy.status, 409);

  await cook(sara, order.id);
  await ali.post(`/api/orders/${order.id}/deliver-ready`);
  await ali.post(`/api/orders/${order.id}/complete`);
  await ali.post(`/api/tables/${table.id}/release`);
});

test('the payment must settle the whole order, and a retry never orders twice', async () => {
  const price = menuByName[PIZZA].price;

  const short = await neda.post('/api/counter-orders', {
    clientRequestId: rid('short'),
    mode: 'COUNTER_PICKUP',
    items: [line(PIZZA, 2)],
    payment: { method: 'CARD', amount: price },
  });
  assert.equal(short.status, 400, 'half the money is not enough at the counter');
  assert.match(short.body.error.message, /کامل پرداخت/);

  const requestId = rid('retry');
  const body = {
    clientRequestId: requestId,
    mode: 'COUNTER_PICKUP',
    items: [line(PIZZA, 1)],
    payment: { method: 'CARD', amount: price, reference: '55512' },
  };
  const first = await neda.post('/api/counter-orders', body);
  const again = await neda.post('/api/counter-orders', body);
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.order.id, first.body.order.id, 'the retry returned the same order');
  assert.equal(again.body.order.payments.length, 1, 'and only one payment');
});

test('no-preparation items are ready immediately and can be handed over at once', async () => {
  const res = await counterOrder(neda, 'COUNTER_PICKUP', [[WATER, 2]]);
  const order = res.body.order;
  assert.equal(order.counts.READY, 1, 'the water needs no station');
  const handed = await neda.post(`/api/orders/${order.id}/hand-over`);
  assert.equal(handed.body.lifecycle, 'COMPLETED');
});

test('roles: the cashier orders at the counter but does not run the floor', async () => {
  assert.equal((await ali.post('/api/counter-orders', { clientRequestId: rid('x'), mode: 'COUNTER_PICKUP', items: [line(PIZZA, 1)], payment: { method: 'CASH', amount: menuByName[PIZZA].price } })).status, 403);
  assert.equal((await sara.get('/api/counter/queue')).status, 403);

  // the cashier may not open a table or touch a waiter's order
  const table = await tableByName('میز ۶');
  assert.equal((await neda.post('/api/orders', { tableId: table.id, guestCount: 2 })).status, 403);
  const waiterOrder = (await ali.post('/api/orders', { tableId: table.id, guestCount: 2 })).body;
  assert.equal((await neda.post(`/api/orders/${waiterOrder.id}/table`, { tableId: null })).status, 403);
  await ali.post(`/api/orders/${waiterOrder.id}/cancel`, { reason: 'پایان تست' });
});

test('the manager decides which workflows exist', async () => {
  await manager.put('/api/restaurant', { modeCounterPickup: false });
  const off = await counterOrder(neda, 'COUNTER_PICKUP', [[PIZZA, 1]]);
  assert.equal(off.status, 409);
  assert.match(off.body.error.message, /فعال نیست/);

  // table service can only be switched off once no table order is still open
  const table = await tableByName('میز ۷');
  const open = (await ali.post('/api/orders', { tableId: table.id, guestCount: 2 })).body;
  const blocked = await manager.put('/api/restaurant', { modeTableService: false });
  assert.equal(blocked.status, 409);
  await ali.post(`/api/orders/${open.id}/cancel`, { reason: 'پایان تست' });

  const onlyCounter = await manager.put('/api/restaurant', { modeTableService: false, modeCounterTable: true });
  assert.equal(onlyCounter.status, 200);
  assert.equal(onlyCounter.body.serviceModes.tableService, false);
  const refused = await ali.post('/api/orders', { tableId: table.id, guestCount: 2 });
  assert.equal(refused.status, 409, 'with table service off, waiters cannot open tables');

  assert.equal((await manager.put('/api/restaurant', { modeTableService: false, modeCounterTable: false, modeCounterPickup: false })).status, 400);
  await manager.put('/api/restaurant', { modeTableService: true, modeCounterPickup: true });
});

test('reports split the takings by workflow', async () => {
  const summary = (await manager.get('/api/reports/summary?range=today')).body;
  const modes = Object.fromEntries(summary.serviceModes.map((m) => [m.mode, m]));
  assert.equal(modes.COUNTER_PICKUP.orders >= 2, true);
  assert.equal(modes.COUNTER_TABLE.orders >= 2, true);
  assert.ok(modes.COUNTER_PICKUP.sales > 0);
  assert.equal(
    summary.serviceModes.reduce((n, m) => n + m.sales, 0),
    summary.totals.sales,
    'the modes add up to the day’s sales',
  );
});
