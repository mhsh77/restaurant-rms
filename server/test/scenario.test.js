/**
 * End-to-end scenario from the specification (§27) plus permission, concurrency,
 * real-time, receipt and report checks — against a real server and real sockets.
 * Demo data is Persian and priced in Toman (0 decimals).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let srv;
let manager, ali, maryam, sara, omid;
let menuByName;
let stations;

const PIZZA = 'پیتزا مارگاریتا';
const BURGER = 'همبرگر کلاسیک';
const COKE = 'نوشابه';
const CAPPUCCINO = 'کاپوچینو';
const COFFEE = 'قهوه';
const CAKE = 'کیک شکلاتی';
const faDigits = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

before(async () => {
  srv = await startServer();
  [manager, ali, maryam, sara, omid] = await Promise.all([
    srv.login('manager', 'manager123'),
    srv.login('ali', 'waiter123'),
    srv.login('maryam', 'waiter123'),
    srv.login('sara', 'kitchen123'),
    srv.login('omid', 'bar12345'),
  ]);
  const items = (await ali.get('/api/menu/items')).body;
  menuByName = Object.fromEntries(items.map((i) => [i.name, i]));
  stations = Object.fromEntries((await manager.get('/api/stations')).body.map((s) => [s.code, s]));
});

after(async () => {
  await srv.stop();
});

const tableByName = async (client, name) => (await client.get('/api/tables')).body.find((t) => t.name === name);
const itemIn = (order, name) => order.batches.flatMap((b) => b.items).find((i) => i.name === name);

test('authentication and session basics', async () => {
  const anon = srv.anonymous();
  assert.equal((await anon.get('/api/tables')).status, 401);
  assert.equal((await anon.get('/uploads/menu/does-not-exist.png')).status, 404);
  // Unknown endpoints are not revealed to anonymous callers; signed-in users get a plain 404.
  assert.equal((await anon.get('/api/no-such-endpoint')).status, 401);
  assert.equal((await ali.get('/api/no-such-endpoint')).status, 404);
  const wrong = await anon.post('/api/auth/login', { username: 'ali', password: 'wrong' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error.message, 'نام کاربری یا رمز عبور اشتباه است');
  assert.equal((await anon.post('/api/auth/login', { username: 'ghost', password: 'whatever' })).status, 401);
  assert.equal(ali.session.user.roleCode, 'WAITER');
  assert.equal(ali.session.restaurant.currencySymbol, 'تومان');
  assert.deepEqual(sara.session.stations.map((s) => s.code), ['kitchen']);
  assert.deepEqual(omid.session.stations.map((s) => s.code), ['bar']);
  assert.equal(manager.session.stations.length, 3);
  // Passwords are never returned.
  assert.ok(!JSON.stringify((await manager.get('/api/users')).body).includes('password'));
  // Socket without a session is refused.
  await assert.rejects(srv.anonymous().connectSocket());
});

test('role-based access control', async () => {
  assert.equal((await ali.get('/api/reports/dashboard')).status, 403);
  assert.equal((await ali.get('/api/audit-logs')).status, 403);
  assert.equal((await ali.get('/api/users')).status, 403);
  assert.equal((await ali.post('/api/menu/items', { name: 'Hack', price: 1, categoryId: 1, stationId: 1 })).status, 403);
  assert.equal((await ali.put(`/api/menu/items/${menuByName[COKE].id}`, { price: 1 })).status, 403);
  assert.equal((await ali.put('/api/restaurant', { name: 'Mine' })).status, 403);
  assert.equal((await ali.get(`/api/stations/${stations.kitchen.id}/tickets`)).status, 403);

  assert.equal((await sara.get('/api/tables')).status, 403);
  assert.equal((await sara.get('/api/orders')).status, 403);
  assert.equal((await sara.get('/api/menu/items')).status, 403);
  // Kitchen cannot read the bar display by changing the id.
  assert.equal((await sara.get(`/api/stations/${stations.bar.id}/tickets`)).status, 404);
  assert.equal((await omid.get(`/api/stations/${stations.kitchen.id}/tickets`)).status, 404);
  assert.equal((await sara.get(`/api/stations/${stations.kitchen.id}/tickets`)).status, 200);

  // Cross-origin state-changing requests are rejected.
  const res = await fetch(`${srv.base}/api/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ali.cookie, origin: 'https://evil.example' },
    body: '{}',
  });
  assert.equal(res.status, 403);
});

test('specification scenario: Table 5 from order to receipt', async () => {
  const aliSocket = await ali.connectSocket();
  const kitchenSocket = await sara.connectSocket();
  const barSocket = await omid.connectSocket();

  // Waiter opens Table 5.
  const table5 = await tableByName(ali, 'میز ۵');
  assert.equal(table5.status, 'AVAILABLE');
  const opened = await ali.post('/api/orders', { tableId: table5.id, guestCount: 4 });
  assert.equal(opened.status, 201);
  const orderId = opened.body.id;
  assert.ok(opened.body.orderNumber >= 1001);
  assert.equal((await tableByName(ali, 'میز ۵')).status, 'WAITING_FOR_ORDER');

  // A second waiter tapping the same table does not create a second order.
  const second = await maryam.post('/api/orders', { tableId: table5.id, guestCount: 2 });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.details.orderId, orderId);

  // Waiter submits the order.
  const submit = await ali.post(`/api/orders/${orderId}/batches`, {
    clientRequestId: 'scenario-round-1',
    items: [
      { menuItemId: menuByName[PIZZA].id, quantity: 2, note: 'یکی بدون پیاز' },
      { menuItemId: menuByName[BURGER].id, quantity: 1 },
      { menuItemId: menuByName[COKE].id, quantity: 2 },
      { menuItemId: menuByName[CAPPUCCINO].id, quantity: 1, note: 'شیر بیشتر' },
    ],
  });
  assert.equal(submit.status, 201);
  assert.equal(submit.body.order.status, 'OPEN');
  assert.equal(submit.body.order.batches.length, 1);

  // Real-time: both stations are told, without polling.
  await kitchenSocket.waitFor('station:changed', (p) => p.stationId === stations.kitchen.id);
  await barSocket.waitFor('station:changed', (p) => p.stationId === stations.bar.id);
  assert.ok(!kitchenSocket.events.some((e) => e.event === 'station:changed' && e.payload.stationId === stations.bar.id), 'kitchen must not get bar events');
  assert.ok(!barSocket.events.some((e) => e.event === 'orders:changed'), 'bar must not get floor events');

  // Automatic split: Kitchen sees only Pizza + Burger, Bar sees only Coke + Cappuccino — same order number.
  const kitchen = (await sara.get(`/api/stations/${stations.kitchen.id}/tickets`)).body;
  const kTicket = kitchen.tickets.find((t) => t.orderId === orderId);
  assert.deepEqual(kTicket.items.map((i) => `${i.name} x${i.quantity}`).sort(), [`${BURGER} x1`, `${PIZZA} x2`].sort());
  assert.equal(kTicket.tableName, 'میز ۵');
  assert.equal(kTicket.lane, 'NEW');
  assert.equal(kTicket.items.find((i) => i.name === PIZZA).note, 'یکی بدون پیاز');

  const bar = (await omid.get(`/api/stations/${stations.bar.id}/tickets`)).body;
  const bTicket = bar.tickets.find((t) => t.orderId === orderId);
  assert.deepEqual(bTicket.items.map((i) => `${i.name} x${i.quantity}`).sort(), [`${CAPPUCCINO} x1`, `${COKE} x2`].sort());
  assert.equal(bTicket.orderNumber, kTicket.orderNumber);

  let order = (await ali.get(`/api/orders/${orderId}`)).body;
  const pizza = itemIn(order, PIZZA);
  const coke = itemIn(order, COKE);

  // Kitchen cannot touch the bar's Coke, even by id.
  assert.equal((await sara.post(`/api/order-items/${coke.id}/status`, { from: 'PENDING', to: 'PREPARING' })).status, 404);
  // Waiter cannot start cooking.
  assert.equal((await ali.post(`/api/order-items/${pizza.id}/status`, { from: 'PENDING', to: 'PREPARING' })).status, 403);

  // Kitchen: Pizza PENDING → PREPARING → READY.
  aliSocket.clear();
  assert.equal((await sara.post(`/api/order-items/${pizza.id}/status`, { from: 'PENDING', to: 'PREPARING' })).status, 200);
  // A stale second tap (e.g. another kitchen tablet) is rejected, not applied twice.
  const stale = await sara.post(`/api/order-items/${pizza.id}/status`, { from: 'PENDING', to: 'PREPARING' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.details.status, 'PREPARING');
  assert.equal((await ali.get(`/api/orders/${orderId}`)).body.status, 'IN_PROGRESS');

  assert.equal((await sara.post(`/api/order-items/${pizza.id}/status`, { from: 'PREPARING', to: 'READY' })).status, 200);
  const pizzaReady = await aliSocket.waitFor('items:ready', (p) => p.orderId === orderId);
  assert.equal(pizzaReady.tableName, 'میز ۵');
  assert.deepEqual(pizzaReady.items.map((i) => i.name), [PIZZA]);
  assert.equal((await ali.get(`/api/orders/${orderId}`)).body.status, 'PARTIALLY_READY');

  // Bar: Coke PENDING → PREPARING → READY.
  aliSocket.clear();
  assert.equal((await omid.post(`/api/order-items/${coke.id}/status`, { from: 'PENDING', to: 'PREPARING' })).status, 200);
  assert.equal((await omid.post(`/api/order-items/${coke.id}/status`, { from: 'PREPARING', to: 'READY' })).status, 200);
  const cokeReady = await aliSocket.waitFor('items:ready', (p) => p.items.some((i) => i.name === COKE));
  assert.equal(cokeReady.orderNumber, opened.body.orderNumber);

  // Waiter's bell: Table 5 has 2 ready items.
  const ready = (await ali.get('/api/orders/ready')).body.find((g) => g.orderId === orderId);
  assert.equal(ready.table.name, 'میز ۵');
  assert.deepEqual(ready.items.map((i) => i.name).sort(), [COKE, PIZZA].sort());
  assert.equal((await tableByName(ali, 'میز ۵')).status, 'READY');

  // Waiter delivers Pizza and Coke.
  assert.equal((await ali.post(`/api/order-items/${pizza.id}/status`, { from: 'READY', to: 'DELIVERED' })).status, 200);
  assert.equal((await ali.post(`/api/order-items/${coke.id}/status`, { from: 'READY', to: 'DELIVERED' })).status, 200);

  // Order cannot be completed while Burger and Cappuccino are open.
  const early = await ali.post(`/api/orders/${orderId}/complete`);
  assert.equal(early.status, 409);
  assert.match(early.body.error.message, /هنوز تحویل نشده است/);

  // A ticket whose work has started never falls back to NEW after part of it was served.
  const kitchenPartial = (await sara.get(`/api/stations/${stations.kitchen.id}/tickets`)).body.tickets.find((t) => t.batchId === kTicket.batchId);
  assert.equal(kitchenPartial.lane, 'PREPARING');

  // Kitchen finishes the ticket in one tap; bar starts then finishes theirs.
  assert.equal((await sara.post(`/api/stations/${stations.kitchen.id}/tickets/${kTicket.batchId}/advance`, { to: 'READY' })).status, 200);
  assert.equal((await omid.post(`/api/stations/${stations.bar.id}/tickets/${bTicket.batchId}/advance`, { to: 'PREPARING' })).status, 200);
  assert.equal((await omid.post(`/api/stations/${stations.bar.id}/tickets/${bTicket.batchId}/advance`, { to: 'READY' })).status, 200);
  order = (await ali.get(`/api/orders/${orderId}`)).body;
  assert.equal(order.status, 'READY');
  assert.equal(itemIn(order, BURGER).status, 'READY');
  // Burger went PENDING → PREPARING → READY, so its start time is recorded.
  assert.ok(itemIn(order, BURGER).startedAt);

  // Tickets move to the READY lane.
  const kitchenAfter = (await sara.get(`/api/stations/${stations.kitchen.id}/tickets`)).body.tickets.find((t) => t.batchId === kTicket.batchId);
  assert.equal(kitchenAfter.lane, 'READY');

  // Waiter delivers everything that is ready.
  order = (await ali.post(`/api/orders/${orderId}/deliver-ready`)).body;
  assert.equal(order.status, 'DELIVERED');
  assert.ok(order.batches.flatMap((b) => b.items).every((i) => i.status === 'DELIVERED'));
  assert.equal((await tableByName(ali, 'میز ۵')).status, 'OCCUPIED');
  // Tickets leave the station displays.
  assert.ok(!(await sara.get(`/api/stations/${stations.kitchen.id}/tickets`)).body.tickets.some((t) => t.orderId === orderId));

  // Second round on the same order: Coffee × 2, Chocolate Cake × 1.
  const round2 = await maryam.post(`/api/orders/${orderId}/batches`, {
    clientRequestId: 'scenario-round-2',
    items: [
      { menuItemId: menuByName[COFFEE].id, quantity: 2 },
      { menuItemId: menuByName[CAKE].id, quantity: 1 },
    ],
  });
  assert.equal(round2.status, 201);
  assert.equal(round2.body.order.id, orderId);
  assert.equal(round2.body.order.orderNumber, opened.body.orderNumber);
  assert.equal(round2.body.order.batches.length, 2);
  // Retrying the same submit (flaky Wi-Fi) does not duplicate items.
  const retry = await maryam.post(`/api/orders/${orderId}/batches`, {
    clientRequestId: 'scenario-round-2',
    items: [{ menuItemId: menuByName[COFFEE].id, quantity: 2 }],
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.order.batches.length, 2);

  const k2 = (await sara.get(`/api/stations/${stations.kitchen.id}/tickets`)).body.tickets.find((t) => t.orderId === orderId);
  assert.equal(k2.batchNo, 2);
  assert.deepEqual(k2.items.map((i) => i.name), [CAKE]);
  const b2 = (await omid.get(`/api/stations/${stations.bar.id}/tickets`)).body.tickets.find((t) => t.orderId === orderId);
  assert.deepEqual(b2.items.map((i) => i.name), [COFFEE]);

  for (const [client, station, ticket] of [
    [sara, stations.kitchen, k2],
    [omid, stations.bar, b2],
  ]) {
    assert.equal((await client.post(`/api/stations/${station.id}/tickets/${ticket.batchId}/advance`, { to: 'PREPARING' })).status, 200);
    assert.equal((await client.post(`/api/stations/${station.id}/tickets/${ticket.batchId}/advance`, { to: 'READY' })).status, 200);
  }
  order = (await ali.post(`/api/orders/${orderId}/deliver-ready`)).body;
  assert.ok(order.batches.flatMap((b) => b.items).every((i) => i.status === 'DELIVERED'), 'all items DELIVERED');
  // The demo restaurant requires payment before completing; the waiter cannot take payment.
  assert.equal(order.canComplete, false);
  assert.equal(order.paymentStatus, 'UNPAID');
  assert.match(order.completeBlockedReason, /صندوق/);
  const unpaidComplete = await ali.post(`/api/orders/${orderId}/complete`);
  assert.equal(unpaidComplete.status, 409);
  assert.match(unpaidComplete.body.error.message, /تسویه/);
  assert.equal((await ali.post(`/api/orders/${orderId}/payments`, { clientRequestId: 'waiter-pay-1', method: 'CASH', amount: 1000 })).status, 403);

  // Receipt.
  const receipt = (await ali.get(`/api/orders/${orderId}/receipt`)).body;
  const expectedTotal = 2 * 380000 + 350000 + 2 * 60000 + 150000 + 2 * 130000 + 180000;
  assert.equal(receipt.total, expectedTotal);
  assert.equal(receipt.order.table, 'میز ۵');
  assert.equal(receipt.order.waiter, 'علی رضایی');
  assert.equal(receipt.restaurant.name, 'رستوران زیتون');
  assert.equal(receipt.restaurant.currencySymbol, 'تومان');
  assert.deepEqual(
    receipt.lines.map((l) => `${l.name} ${l.quantity}x${l.unitPrice}=${l.lineTotal}`),
    [`${PIZZA} 2x380000=760000`, `${BURGER} 1x350000=350000`, `${COKE} 2x60000=120000`, `${CAPPUCCINO} 1x150000=150000`, `${COFFEE} 2x130000=260000`, `${CAKE} 1x180000=180000`],
  );
  assert.equal((await ali.post(`/api/orders/${orderId}/receipt/printed`)).status, 200);

  // The manager (who has cashier permission) settles the bill.
  const paid = await manager.post(`/api/orders/${orderId}/payments`, { clientRequestId: 'scenario-pay-1', method: 'CARD', amount: expectedTotal });
  assert.equal(paid.status, 201);
  assert.equal(paid.body.order.paymentStatus, 'PAID');
  assert.equal(paid.body.order.canComplete, true);

  // Complete, then release the table.
  order = (await ali.post(`/api/orders/${orderId}/complete`)).body;
  assert.equal(order.status, 'COMPLETED');
  assert.equal((await tableByName(ali, 'میز ۵')).status, 'COMPLETED');
  assert.equal((await ali.post(`/api/tables/${table5.id}/release`)).status, 200);
  assert.equal((await tableByName(ali, 'میز ۵')).status, 'AVAILABLE');

  // Searchable by number (Latin or Persian digits), visible in reports and audit log.
  const found = (await ali.get(`/api/orders?q=%23${opened.body.orderNumber}`)).body;
  assert.equal(found.orders[0].id, orderId);
  const foundFa = (await ali.get(`/api/orders?q=${encodeURIComponent(faDigits(opened.body.orderNumber))}`)).body;
  assert.equal(foundFa.orders[0].id, orderId);
  // Table names are stored with Persian digits; the client sends Latin ones. Both must match.
  for (const term of ['میز 5', 'میز ۵']) {
    const byTable = (await ali.get(`/api/orders?q=${encodeURIComponent(term)}`)).body;
    assert.ok(byTable.orders.some((o) => o.id === orderId), `search "${term}" finds the order`);
  }
  const summary = (await manager.get('/api/reports/summary?range=today')).body;
  assert.equal(summary.totals.sales, expectedTotal);
  assert.equal(summary.totals.completedOrders, 1);
  assert.equal(summary.items.top[0].name, PIZZA);
  assert.ok(summary.stations.find((s) => s.code === 'kitchen').itemsPrepared >= 3);
  assert.equal(summary.waiters.find((w) => w.name === 'علی رضایی').sales, expectedTotal);

  const audit = (await manager.get(`/api/audit-logs?pageSize=200`)).body.logs.map((l) => l.summary);
  assert.ok(audit.some((s) => s.startsWith(`علی رضایی سفارش #${opened.body.orderNumber} را برای میز ۵`)));
  assert.ok(audit.some((s) => s.includes(`سارا مرادی وضعیت ${PIZZA} ×2`) && s.includes('از «در حال آماده‌سازی» به «آماده»')));
  assert.ok(audit.some((s) => s.includes(`مریم احمدی ${COFFEE} ×2، ${CAKE} ×1 را به سفارش`) && s.includes('(مرحله 2)')));
  // Audit search accepts Persian digits for order numbers.
  const auditFa = (await manager.get(`/api/audit-logs?q=${encodeURIComponent(faDigits(opened.body.orderNumber))}`)).body;
  assert.ok(auditFa.total > 0);
});

test('concurrent edits never overwrite each other', async () => {
  const table = await tableByName(ali, 'میز ۶');
  const order = (await ali.post('/api/orders', { tableId: table.id, guestCount: 2 })).body;
  const submitted = (
    await ali.post(`/api/orders/${order.id}/batches`, {
      clientRequestId: 'concurrency-1',
      items: [{ menuItemId: menuByName['استیک گوشت'].id, quantity: 1 }],
    })
  ).body.order;
  const steak = itemIn(submitted, 'استیک گوشت');

  // Two waiters edit the same pending item with the same version: exactly one wins.
  const [a, b] = await Promise.all([
    ali.patch(`/api/order-items/${steak.id}`, { quantity: 2, version: steak.version }),
    maryam.patch(`/api/order-items/${steak.id}`, { quantity: 3, version: steak.version }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);

  // Once the kitchen starts it, waiters can no longer edit or cancel it; a manager can cancel.
  const fresh = itemIn((await ali.get(`/api/orders/${order.id}`)).body, 'استیک گوشت');
  assert.equal((await sara.post(`/api/order-items/${fresh.id}/status`, { from: 'PENDING', to: 'PREPARING' })).status, 200);
  assert.equal((await ali.patch(`/api/order-items/${fresh.id}`, { quantity: 5, version: fresh.version + 1 })).status, 409);
  assert.equal((await ali.post(`/api/order-items/${fresh.id}/status`, { from: 'PREPARING', to: 'CANCELLED' })).status, 403);
  assert.equal((await ali.post(`/api/orders/${order.id}/cancel`, { reason: 'test' })).status, 403);
  assert.equal((await manager.post(`/api/order-items/${fresh.id}/status`, { from: 'PREPARING', to: 'CANCELLED', reason: 'مهمان رفت' })).status, 200);
  const cancelled = (await manager.post(`/api/orders/${order.id}/cancel`, { reason: 'مهمان رفت' })).body;
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal((await tableByName(ali, 'میز ۶')).status, 'AVAILABLE');
});

test('unavailable items cannot be ordered; auto-ready items skip the stations', async () => {
  const table = await tableByName(ali, 'میز ۷');
  const order = (await ali.post('/api/orders', { tableId: table.id, guestCount: 1 })).body;
  const tiramisu = await ali.post(`/api/orders/${order.id}/batches`, { clientRequestId: 'unavail-1', items: [{ menuItemId: menuByName['تیرامیسو'].id, quantity: 1 }] });
  assert.equal(tiramisu.status, 409);
  assert.match(tiramisu.body.error.message, /تیرامیسو/);

  const aliSocket = await ali.connectSocket();
  const water = await ali.post(`/api/orders/${order.id}/batches`, { clientRequestId: 'water-round-1', items: [{ menuItemId: menuByName['آب معدنی'].id, quantity: 2 }] });
  assert.equal(water.status, 201);
  assert.equal(itemIn(water.body.order, 'آب معدنی').status, 'READY');
  await aliSocket.waitFor('items:ready', (p) => p.orderId === order.id);
});

test('manager changes: price change keeps old orders, deactivation revokes sessions', async () => {
  const cokeBefore = menuByName[COKE];
  const updated = await manager.put(`/api/menu/items/${cokeBefore.id}`, { price: 70000 });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.price, 70000);
  const logs = (await manager.get('/api/audit-logs?action=menu_item.price_change')).body.logs;
  assert.match(logs[0].summary, /قیمت نوشابه را از 60,000 تومان به 70,000 تومان تغییر داد/);
  // The order from the scenario still bills Coke at the old price.
  const old = (await manager.get('/api/orders?status=COMPLETED')).body.orders[0];
  assert.equal((await manager.get(`/api/orders/${old.id}/receipt`)).body.lines.find((l) => l.name === COKE).unitPrice, 60000);

  // Validation messages are Persian.
  const invalid = await manager.post('/api/menu/items', { name: '', price: -1, categoryId: 1, stationId: 1 });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error.message, /[؀-ۿ]/);
  assert.equal((await manager.post('/api/tables', { name: 'میز ۱', capacity: 4 })).status, 409);

  // Deactivating a user kills their existing session immediately.
  const temp = await manager.post('/api/users', { name: 'گارسون موقت', username: 'temp.waiter', password: 'temporary1', roleCode: 'WAITER' });
  assert.equal(temp.status, 201);
  const tempClient = await srv.login('temp.waiter', 'temporary1');
  assert.equal((await tempClient.get('/api/tables')).status, 200);
  assert.equal((await manager.put(`/api/users/${temp.body.id}`, { isActive: false })).status, 200);
  assert.equal((await tempClient.get('/api/tables')).status, 401);
  // The last manager cannot demote themselves.
  assert.equal((await manager.put(`/api/users/${manager.session.user.id}`, { roleCode: 'WAITER' })).status, 400);
});

test('reports: presets, Jalali month, custom range, CSV export', async () => {
  for (const range of ['today', 'yesterday', 'week', 'month']) {
    const res = await manager.get(`/api/reports/summary?range=${range}`);
    assert.equal(res.status, 200, range);
    assert.ok(res.body.range.from <= res.body.range.to);
  }
  // "This month" starts on the 1st of the current Persian month.
  const month = (await manager.get('/api/reports/summary?range=month')).body.range;
  const [y, m, d] = month.from.split('-').map(Number);
  const persianDay = new Intl.DateTimeFormat('en-u-ca-persian', { timeZone: 'UTC', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
  assert.equal(persianDay, '1');

  const custom = await manager.get('/api/reports/summary?range=custom&from=2026-01-01&to=2026-01-31');
  assert.equal(custom.status, 200);
  assert.equal(custom.body.daily.length, 31);
  assert.equal((await manager.get('/api/reports/summary?range=custom&from=2026-02-01&to=2026-01-01')).status, 400);

  const csv = await manager.get('/api/reports/export?type=items&range=today');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.body, new RegExp(`${PIZZA},پیتزا,2,1,760000`));

  const daily = await manager.get('/api/reports/export?type=daily&range=today');
  assert.match(daily.body, /تاریخ شمسی/);
  assert.match(daily.body, /\d{4}\/\d{2}\/\d{2},\d{4}-\d{2}-\d{2}/);

  const dash = await manager.get('/api/reports/dashboard');
  assert.equal(dash.status, 200);
  assert.ok(dash.body.stations.some((s) => s.code === 'bar'));
});
