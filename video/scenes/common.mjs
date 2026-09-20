// Shared building blocks for the scene scripts: data set-up through the real API and the
// on-screen steps that several videos repeat (seat guests, add items, work a ticket…).

import crypto from 'node:crypto';

export const ROLE = {
  waiter: 'گارسون',
  kitchen: 'آشپزخانه',
  bar: 'بار',
  cashier: 'صندوقدار',
  manager: 'مدیر',
};

export const ROAD = [
  { icon: '🪑', title: 'نشاندن مهمان', who: 'گارسون' },
  { icon: '📝', title: 'ثبت سفارش', who: 'گارسون' },
  { icon: '🍳', title: 'آماده‌سازی', who: 'آشپزخانه و بار' },
  { icon: '🍽️', title: 'تحویل به میز', who: 'گارسون' },
  { icon: '💳', title: 'پرداخت', who: 'صندوقدار' },
  { icon: '✅', title: 'آزاد کردن میز', who: 'گارسون' },
];

const rid = () => crypto.randomUUID();

/* ─────────────── API-side set-up (off camera) ─────────────── */

export async function menuIds(api) {
  const items = await api.get('/menu/items');
  return Object.fromEntries(items.map((i) => [i.name, i.id]));
}

export async function tableByName(api, name) {
  const tables = await api.get('/tables');
  const t = tables.find((x) => x.name === name);
  if (!t) throw new Error(`no table ${name}`);
  return t;
}

export async function stationIds(api) {
  const me = await api.get('/auth/me');
  return Object.fromEntries(me.stations.map((s) => [s.roleCode ?? s.code, s.id]));
}

/** Open a table and send one round, entirely through the API. Returns the order. */
export async function openOrder(api, tableName, guests, lines) {
  const ids = await menuIds(api);
  const table = await tableByName(api, tableName);
  const order = await api.post('/orders', { tableId: table.id, guestCount: guests });
  const res = await api.post(`/orders/${order.id}/batches`, {
    clientRequestId: rid(),
    items: lines.map(([name, quantity, note]) => ({ menuItemId: ids[name], quantity, ...(note ? { note } : {}) })),
  });
  return res.order;
}

export async function addRound(api, orderId, lines) {
  const ids = await menuIds(api);
  const res = await api.post(`/orders/${orderId}/batches`, {
    clientRequestId: rid(),
    items: lines.map(([name, quantity, note]) => ({ menuItemId: ids[name], quantity, ...(note ? { note } : {}) })),
  });
  return res.order;
}

/**
 * Move an order's tickets at this role's station(s) to `to`, the way the station screen's
 * big button does: one call per ticket, so the waiter gets one notification per ticket.
 * `batchNo` limits it to one round; `onlyNames` moves single items instead (item taps).
 */
export async function advanceStation(stationApi, orderId, to, { batchNo, onlyNames } = {}) {
  const me = await stationApi.get('/auth/me');
  const chain = ['PENDING', 'PREPARING', 'READY', 'DELIVERED'];
  for (const st of me.stations.filter((x) => !x.autoReady)) {
    const { tickets } = await stationApi.get(`/stations/${st.id}/tickets`);
    for (const t of tickets.filter((x) => x.orderId === orderId && (!batchNo || x.batchNo === batchNo))) {
      if (!onlyNames) {
        await stationApi.post(`/stations/${st.id}/tickets/${t.batchId}/advance`, { to });
        continue;
      }
      for (const it of t.items.filter((i) => onlyNames.includes(i.name))) {
        let status = it.status;
        if (!chain.includes(status) || chain.indexOf(status) >= chain.indexOf(to)) continue;
        while (status !== to) {
          const next = chain[chain.indexOf(status) + 1];
          await stationApi.post(`/order-items/${it.id}/status`, { from: status, to: next });
          status = next;
        }
      }
    }
  }
}

export async function deliverAll(waiterApi, orderId) {
  await waiterApi.post(`/orders/${orderId}/deliver-ready`);
}

/** Pretend an order was placed `minutes` ago (the API rightly has no way to do this). */
export function backdate(ctx, orderId, minutes) {
  const at = (m) => new Date(Date.now() - m * 60_000).toISOString();
  ctx.sql('UPDATE orders SET opened_at = ? WHERE id = ?', at(minutes + 3), orderId);
  ctx.sql('UPDATE order_batches SET submitted_at = ? WHERE order_id = ?', at(minutes), orderId);
  ctx.sql('UPDATE order_items SET submitted_at = ? WHERE order_id = ?', at(minutes), orderId);
  ctx.sql("UPDATE order_items SET started_at = ? WHERE order_id = ? AND started_at IS NOT NULL", at(minutes - 2), orderId);
}

/** Pay an order in full at the cashier (API) and complete it. */
export async function payInFull(cashierApi, orderId, method = 'CASH') {
  const o = await cashierApi.get(`/orders/${orderId}`);
  const round = Math.ceil(o.remaining / 100_000) * 100_000;
  return cashierApi.post(`/orders/${orderId}/payments`, {
    clientRequestId: rid(),
    method,
    amount: o.remaining,
    ...(method === 'CASH' ? { receivedAmount: round } : {}),
    completeOrder: true,
  });
}

/**
 * Lunch service that already happened today: served, paid, tables released — so the
 * dashboard, reports and the cashier's "today" figures are not all zero.
 */
export async function earlierToday(ctx) {
  const a = (await ctx.role('waiter')).api;
  const m = (await ctx.role('waiter2')).api;
  const k = (await ctx.role('kitchen')).api;
  const b = (await ctx.role('bar')).api;
  const c = (await ctx.role('cashier')).api;
  const lunch = [
    [a, 'میز ۱', 2, [['جوجه‌کباب', 2], ['دوغ', 0], ['لیموناد', 2]], 'CARD', 290],
    [m, 'میز ۴', 3, [['پیتزا پپرونی', 1], ['چیزبرگر', 2], ['نوشابه', 3]], 'CASH', 250],
    [a, 'میز ۶', 4, [['استیک گوشت', 2], ['سالاد سزار', 2], ['آب‌پرتقال', 4]], 'CARD', 200],
    [m, 'میز ۷', 2, [['اسپاگتی بولونیز', 2], ['کاپوچینو', 2], ['چیزکیک', 2]], 'CARD', 150],
    [a, 'میز ۹', 2, [['پیتزا مارگاریتا', 1], ['برگر مرغ', 1], ['اسپرایت', 2]], 'CASH', 95],
  ];
  for (const [api, table, guests, lines, method, minutesAgo] of lunch) {
    const o = await openOrder(api, table, guests, lines.filter(([, q]) => q > 0));
    await advanceStation(k, o.id, 'READY');
    await advanceStation(b, o.id, 'READY');
    await deliverAll(api, o.id);
    await payInFull(c, o.id, method);
    await api.post(`/tables/${o.table.id}/release`);
    backdate(ctx, o.id, minutesAgo);
  }
}

/**
 * A believable room: other tables busy in various states, served by the other waiter.
 * Uses maryam, sara and omid through the API, so the videos' own tables stay free.
 */
export async function busyRoom(ctx) {
  const m = (await ctx.role('waiter2')).api;
  const k = (await ctx.role('kitchen')).api;
  const b = (await ctx.role('bar')).api;
  await earlierToday(ctx);

  // میز ۲: eating, everything delivered
  const o2 = await openOrder(m, 'میز ۲', 2, [['جوجه‌کباب', 1], ['سالاد سزار', 1], ['لیموناد', 2]]);
  await advanceStation(k, o2.id, 'READY');
  await advanceStation(b, o2.id, 'READY');
  await deliverAll(m, o2.id);
  backdate(ctx, o2.id, 38);

  // میز ۳: kitchen is late with it (red on the kitchen screen)
  const o3 = await openOrder(m, 'میز ۳', 3, [['پیتزا پپرونی', 1], ['ماهی سالمون', 1], ['سوپ جو', 2]]);
  await advanceStation(k, o3.id, 'PREPARING');
  backdate(ctx, o3.id, 23);

  // میز ۸: kitchen is cooking and getting slow (orange), drinks already served
  const o8 = await openOrder(m, 'میز ۸', 4, [['استیک گوشت', 2], ['اسپاگتی بولونیز', 1], ['آب‌پرتقال', 2], ['اسپرسو', 1]]);
  await advanceStation(b, o8.id, 'READY');
  await deliverAll(m, o8.id);
  await advanceStation(k, o8.id, 'PREPARING');
  backdate(ctx, o8.id, 12);

  // میز ۱۰: a big table, just seated
  await m.post('/orders', { tableId: (await tableByName(m, 'میز ۱۰')).id, guestCount: 6 });

  return { o2, o3, o8 };
}

/* ─────────────── on-camera steps ─────────────── */

export async function clickTable(ctx, name) {
  await ctx.click(ctx.page.locator('.table-tile').filter({ has: ctx.page.locator('.tile-name', { hasText: new RegExp(`^${name}$`) }) }), { dy: 0.35 });
}

export async function seatGuests(ctx, count) {
  await ctx.page.locator('.guest-grid').waitFor();
  await ctx.click(ctx.page.locator('.guest-btn', { hasText: new RegExp(`^${count}$`) }));
  await ctx.sleep(400);
  await ctx.click(ctx.page.locator('.btn-xl', { hasText: 'نشاندن' }), { after: 900 });
}

export function menuTile(ctx, name) {
  return ctx.page.locator('.menu-tile').filter({ has: ctx.page.locator('.menu-tile-name', { hasText: new RegExp(`^${name}$`) }) });
}

export async function addItem(ctx, name, times = 1) {
  for (let i = 0; i < times; i++) await ctx.click(menuTile(ctx, name), { pause: i ? 150 : 300, after: i + 1 < times ? 250 : 500, steps: i ? 4 : 26 });
}

export async function sendCart(ctx) {
  await ctx.click(ctx.page.locator('.ticket-foot .btn-primary', { hasText: 'ارسال' }), { after: 1200 });
}

export function kdsCard(ctx, tableName) {
  return ctx.page.locator('.kds-card').filter({ has: ctx.page.locator('.kds-table', { hasText: new RegExp(`^${tableName}$`) }) });
}

export function ticketRow(ctx, name) {
  return ctx.page.locator('.rounds .item-row').filter({ has: ctx.page.locator('.item-name', { hasText: name }) });
}

export function cartRow(ctx, name) {
  return ctx.page.locator('.cart-row').filter({ has: ctx.page.locator('.item-name', { hasText: new RegExp(`^${name}$`) }) });
}

export async function closeModal(ctx) {
  await ctx.click(ctx.page.locator('.modal-header button').last(), { after: 600 });
}

export async function stationId(ctx, key) {
  const me = await (await ctx.role(key)).api.get('/auth/me');
  return me.stations.find((s) => !s.autoReady && !s.auto_ready)?.id ?? me.stations[0].id;
}
