// Video 1 — the road map: one order from seating to a free table, told simply.
import { ROAD, ROLE, busyRoom, clickTable, seatGuests, addItem, sendCart, kdsCard, stationIds } from './common.mjs';

const TABLE = 'میز ۵';
const st = {};

export async function setup(ctx) {
  await busyRoom(ctx);
  Object.assign(st, { kitchen: Object.values(await stationIds((await ctx.role('kitchen')).api))[0] });
  Object.assign(st, { bar: Object.values(await stationIds((await ctx.role('bar')).api))[0] });
  // Open every screen once off camera so the first cut lands on a loaded page.
  await ctx.go('/floor', await ctx.role('waiter'));
  await ctx.go(`/station/${st.kitchen}`, await ctx.role('kitchen'));
  await ctx.go(`/station/${st.bar}`, await ctx.role('bar'));
  await ctx.go('/cashier', await ctx.role('cashier'));
}

export const scenes = [
  {
    title: 'intro — the six stops',
    async run(ctx) {
      await ctx.slide('showTitle', { emoji: '🍽️', kicker: 'رستوران زیتون', title: 'یک سفارش، از میز تا صندوق', roles: ['گارسون', 'آشپزخانه', 'بار', 'صندوقدار'] });
      await ctx.sleep(6500);
      await ctx.slide('showRoad', ROAD, { reveal: true });
    },
  },
  {
    title: '1 seat guests',
    async run(ctx) {
      await ctx.show('waiter', { caption: [ROLE.waiter, 'ایستگاه ۱ · نشاندن مهمان'] });
      await ctx.sleep(1200);
      await clickTable(ctx, TABLE);
      await ctx.sleep(900);
      await seatGuests(ctx, '۴');
    },
  },
  {
    title: '2 take the order',
    async run(ctx) {
      await ctx.caption(ROLE.waiter, 'ایستگاه ۲ · ثبت سفارش');
      await ctx.sleep(700);
      await addItem(ctx, 'پیتزا مارگاریتا', 2);
      await addItem(ctx, 'همبرگر کلاسیک');
      await addItem(ctx, 'نوشابه', 2);
      await addItem(ctx, 'کاپوچینو');
      await ctx.sleep(1200);
      await sendCart(ctx);
    },
  },
  {
    title: 'split diagram',
    async run(ctx) {
      await ctx.slide('showSplit');
    },
  },
  {
    title: '3 kitchen prepares',
    async run(ctx) {
      await ctx.show('kitchen', { caption: [ROLE.kitchen, 'ایستگاه ۳ · آماده‌سازی'] });
      const card = kdsCard(ctx, TABLE);
      await ctx.look(card, 1800, { dy: 0.3 });
      await ctx.click(card.locator('.btn-kds'), { after: 1800 });
      await ctx.click(kdsCard(ctx, TABLE).locator('.btn-kds-ready'), { after: 1500 });
    },
  },
  {
    title: '3 bar prepares',
    async run(ctx) {
      await ctx.show('bar', { caption: [ROLE.bar, 'ایستگاه ۳ · آماده‌سازی نوشیدنی'] });
      const card = kdsCard(ctx, TABLE);
      await ctx.look(card, 1200, { dy: 0.3 });
      await ctx.click(card.locator('.btn-kds'), { after: 1400 });
      await ctx.click(kdsCard(ctx, TABLE).locator('.btn-kds-ready'), { after: 1200 });
    },
  },
  {
    title: '4 bell + deliver',
    async run(ctx) {
      await ctx.show('waiter', { caption: [ROLE.waiter, 'ایستگاه ۴ · تحویل به میز'] });
      await ctx.sleep(1500);
      await ctx.click('.bell-btn', { after: 2600 });
      const group = ctx.page.locator('.bell-group').filter({ hasText: TABLE });
      await ctx.click(group.locator('.btn-success'), { after: 1500 });
    },
  },
  {
    title: 'status diagram',
    async run(ctx) {
      await ctx.slide('showStatus', { stepMs: 1500 });
    },
  },
  {
    title: '5 payment',
    async run(ctx) {
      await ctx.show('cashier', { caption: [ROLE.cashier, 'ایستگاه ۵ · پرداخت'] });
      await ctx.sleep(1200);
      await ctx.click(ctx.page.locator('.bill-row').filter({ hasText: TABLE }), { after: 1800 });
      await ctx.click(ctx.page.locator('.method-btn', { hasText: 'نقدی' }), { after: 700 });
      await ctx.click(ctx.page.locator('.quick-cash .chip').nth(2), { after: 2200 });
      await ctx.point('.change-box');
      await ctx.sleep(1200);
    },
  },
  {
    title: '5 settle + complete',
    async run(ctx) {
      await ctx.click(ctx.page.locator('.pay-form button[type=submit]'), { after: 2500 });
      await ctx.point('.bill-totals');
      await ctx.sleep(1500);
    },
  },
  {
    title: '6 release table',
    async run(ctx) {
      await ctx.show('waiter', { caption: [ROLE.waiter, 'ایستگاه ۶ · آزاد کردن میز'] });
      // The waiter is still on this table's screen, which now says the order is complete.
      await ctx.look('.center-card h2', 2200);
      await ctx.click(ctx.page.locator('.btn-primary', { hasText: 'آزاد کن' }), { after: 1400 });
      await ctx.point(ctx.page.locator('.table-tile').filter({ hasText: TABLE }), { dy: 0.4 });
    },
  },
  {
    title: 'recap',
    async run(ctx) {
      await ctx.slide('showRoad', ROAD, { reveal: true, title: 'مسیر کامل یک سفارش' });
    },
  },
];
