// Video 3 — the kitchen display, in detail.
import { ROLE, busyRoom, openOrder, addRound, advanceStation, deliverAll, kdsCard, stationId } from './common.mjs';

const K = ROLE.kitchen;
const state = {};

export async function setup(ctx) {
  state.room = await busyRoom(ctx);
  // a finished ticket waiting at the pass
  const m = (await ctx.role('waiter2')).api;
  state.o7 = await openOrder(m, 'میز ۷', 2, [['سیب‌زمینی سرخ‌کرده', 1], ['نان سیر', 1]]);
  await advanceStation((await ctx.role('kitchen')).api, state.o7.id, 'READY');
  state.station = await stationId(ctx, 'kitchen');
  await ctx.role('kitchenLogin', { noLogin: true });
  await ctx.go('/login', await ctx.role('kitchenLogin'));
}

const item = (card, name) => card.locator('.kds-item').filter({ hasText: name });

export const scenes = [
  {
    title: 'intro',
    async run(ctx) {
      await ctx.slide('showTitle', { emoji: '👨‍🍳', kicker: 'راهنمای نقش‌ها', title: 'راهنمای کامل آشپزخانه', sub: 'صفحه‌ی فیش‌های آشپزخانه' });
    },
  },
  {
    title: 'login',
    async run(ctx) {
      await ctx.show('kitchenLogin', { caption: [K, 'ورود به سیستم'] });
      await ctx.sleep(600);
      await ctx.type('input[autocomplete=username]', 'sara', { delay: 120 });
      await ctx.type('input[type=password]', 'kitchen123', { delay: 90 });
      await ctx.click(ctx.btn('ورود'), { after: 2000 });
      await ctx.caption(K, 'صفحه‌ی آشپزخانه');
    },
  },
  {
    title: 'layout',
    async run(ctx) {
      for (const t of await ctx.page.locator('.kds-lane-title').all()) await ctx.look(t, 1300);
      await ctx.look('.kds-counts', 1800);
      await ctx.look('.kds-clock', 1300);
      await ctx.look('.kds-bar-right .conn', 1300);
      await ctx.look(ctx.page.locator('.kds-bar-right .kds-icon').first(), 1500);
    },
  },
  {
    title: 'card anatomy',
    async run(ctx) {
      const card = kdsCard(ctx, 'میز ۸');
      await ctx.look(card.locator('.kds-table'), 2000);
      await ctx.look(card.locator('.kds-order'), 1600);
      await ctx.look(card.locator('.kds-timer'), 2800);
    },
  },
  {
    title: 'late colours',
    async run(ctx) {
      await ctx.caption(K, 'رنگ کارت‌ها');
      await ctx.look(kdsCard(ctx, 'میز ۸').locator('.kds-card-head'), 3500);
      await ctx.look(kdsCard(ctx, 'میز ۳').locator('.kds-card-head'), 3500);
    },
  },
  {
    title: 'new ticket',
    async run(ctx) {
      await ctx.caption(K, 'فیش جدید');
      await ctx.moveTo(1300, 500);
      await ctx.sleep(800);
      const w = (await ctx.role('waiter')).api;
      state.o5 = await openOrder(w, 'میز ۵', 4, [['پیتزا مارگاریتا', 2], ['همبرگر کلاسیک', 1, 'بدون پیاز'], ['نوشابه', 2], ['کاپوچینو', 1]]);
      await ctx.sleep(1800);
      const card = kdsCard(ctx, 'میز ۵');
      await ctx.look(card.locator('.kds-card-head'), 1800);
      await ctx.look(item(card, 'پیتزا'), 1800, { dx: 0.7 });
      await ctx.look(item(card, 'همبرگر').locator('.kds-note'), 2200);
      await ctx.look(card.locator('.kds-instructions'), 2200);
    },
  },
  {
    title: 'start',
    async run(ctx) {
      await ctx.caption(K, 'شروع آماده‌سازی');
      await ctx.click(kdsCard(ctx, 'میز ۵').locator('.btn-kds'), { after: 2200 });
      await ctx.look(kdsCard(ctx, 'میز ۵').locator('.kds-card-head'), 2500);
    },
  },
  {
    title: 'one item ready',
    async run(ctx) {
      await ctx.caption(K, 'آماده شدن تک غذا');
      const card = kdsCard(ctx, 'میز ۵');
      await ctx.click(item(card, 'همبرگر').locator('.kds-item-main'), { after: 1800, dx: 0.6 });
      await ctx.look(item(card, 'همبرگر').locator('.kds-item-status'), 2500);
    },
  },
  {
    title: 'undo',
    async run(ctx) {
      await ctx.caption(K, 'برگرداندن اشتباه');
      const card = kdsCard(ctx, 'میز ۵');
      await ctx.click(item(card, 'همبرگر').locator('.kds-undo'), { after: 1800 });
      await ctx.look(item(card, 'همبرگر').locator('.kds-item-status'), 1800);
    },
  },
  {
    title: 'ticket ready',
    async run(ctx) {
      await ctx.caption(K, 'آماده شد');
      await ctx.click(kdsCard(ctx, 'میز ۵').locator('.btn-kds-ready'), { after: 2000 });
      await ctx.look(kdsCard(ctx, 'میز ۵').locator('.kds-card-head'), 2500);
    },
  },
  {
    title: 'delivered disappears',
    async run(ctx) {
      await ctx.caption(K, 'تحویل');
      await ctx.point(kdsCard(ctx, 'میز ۵').locator('.kds-card-head'));
      await ctx.sleep(1200);
      await deliverAll((await ctx.role('waiter')).api, state.o5.id);
      await ctx.sleep(2200);
      await ctx.click(kdsCard(ctx, 'میز ۷').locator('.btn-kds-done'), { after: 2200 });
    },
  },
  {
    title: 'round 2 + cancelled',
    async run(ctx) {
      await ctx.caption(K, 'مرحله‌ی دوم و لغو');
      await ctx.moveTo(1300, 450);
      const w = (await ctx.role('waiter')).api;
      const order = await addRound(w, state.o5.id, [['کیک شکلاتی', 2], ['بستنی', 1]]);
      await ctx.sleep(2000);
      const card = kdsCard(ctx, 'میز ۵');
      await ctx.look(card.locator('.kds-round'), 2500);
      const ice = order.batches.at(-1).items.find((i) => i.name === 'بستنی');
      await w.post(`/order-items/${ice.id}/status`, { from: 'PENDING', to: 'CANCELLED', reason: 'مشتری منصرف شد' });
      await ctx.sleep(1200);
      await ctx.look(item(card, 'بستنی'), 3000, { dx: 0.6 });
    },
  },
  {
    title: 'summary',
    async run(ctx) {
      await ctx.slide('showList', 'خلاصه‌ی کار آشپزخانه', [
        { icon: '▶️', text: 'فیش جدید را با «شروع» آغاز کنید' },
        { icon: '🍳', text: 'هر غذا که آماده شد، روی همان بزنید' },
        { icon: '✅', text: 'وقتی همه آماده شد، «آماده شد» را بزنید' },
        { icon: '⏱️', text: 'کارت نارنجی و قرمز یعنی دیر شده' },
        { icon: '↩️', text: 'اشتباه را با دکمه‌ی برگرداندن درست کنید' },
      ]);
    },
  },
];
