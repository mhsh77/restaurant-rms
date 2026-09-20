// Video 4 — the bar display.
import { ROLE, busyRoom, openOrder, addRound, advanceStation, kdsCard, tableByName } from './common.mjs';

const B = ROLE.bar;
const state = {};

export async function setup(ctx) {
  state.room = await busyRoom(ctx);
  const m = (await ctx.role('waiter2')).api;
  // an older drinks ticket, started a while ago
  await openOrder(m, 'میز ۴', 2, [['لاته', 1], ['شیک توت‌فرنگی', 1]]);
  const o4 = await tableByName(m, 'میز ۴');
  await advanceStation((await ctx.role('bar')).api, o4.order.id, 'PREPARING');
  await ctx.role('barLogin', { noLogin: true });
  await ctx.go('/login', await ctx.role('barLogin'));
}

const item = (card, name) => card.locator('.kds-item').filter({ hasText: name });

export const scenes = [
  {
    title: 'intro',
    async run(ctx) {
      await ctx.slide('showTitle', { emoji: '🍹', kicker: 'راهنمای نقش‌ها', title: 'راهنمای کامل بار', sub: 'صفحه‌ی فیش‌های نوشیدنی' });
    },
  },
  {
    title: 'login',
    async run(ctx) {
      await ctx.show('barLogin', { caption: [B, 'ورود به سیستم'] });
      await ctx.sleep(500);
      await ctx.type('input[autocomplete=username]', 'omid', { delay: 120 });
      await ctx.type('input[type=password]', 'bar12345', { delay: 90 });
      await ctx.click(ctx.btn('ورود'), { after: 1800 });
      await ctx.caption(B, 'صفحه‌ی بار');
      for (const t of await ctx.page.locator('.kds-lane-title').all()) await ctx.look(t, 1100);
    },
  },
  {
    title: 'split ticket arrives',
    async run(ctx) {
      await ctx.caption(B, 'فیش جدید');
      await ctx.moveTo(1300, 500);
      const w = (await ctx.role('waiter')).api;
      state.o5 = await openOrder(w, 'میز ۵', 4, [['پیتزا مارگاریتا', 2], ['همبرگر کلاسیک', 1], ['نوشابه', 2, 'بدون یخ'], ['کاپوچینو', 1]]);
      await ctx.sleep(1800);
      const card = kdsCard(ctx, 'میز ۵');
      await ctx.look(card.locator('.kds-card-head'), 2200);
      await ctx.look(item(card, 'نوشابه'), 2500, { dx: 0.7 });
      await ctx.look(item(card, 'کاپوچینو'), 2000, { dx: 0.7 });
      await ctx.look(item(card, 'نوشابه').locator('.kds-note'), 2500);
    },
  },
  {
    title: 'start',
    async run(ctx) {
      await ctx.caption(B, 'شروع');
      await ctx.click(kdsCard(ctx, 'میز ۵').locator('.btn-kds'), { after: 2500 });
      await ctx.look(kdsCard(ctx, 'میز ۵').locator('.kds-card-head'), 3000);
    },
  },
  {
    title: 'item then ticket ready',
    async run(ctx) {
      await ctx.caption(B, 'آماده شد');
      const card = kdsCard(ctx, 'میز ۵');
      await ctx.click(item(card, 'نوشابه').locator('.kds-item-main'), { after: 2200, dx: 0.6 });
      await ctx.look(item(card, 'نوشابه').locator('.kds-item-status'), 2200);
      await ctx.click(kdsCard(ctx, 'میز ۵').locator('.btn-kds-ready'), { after: 2500 });
      await ctx.look(kdsCard(ctx, 'میز ۵').locator('.kds-card-head'), 2000);
    },
  },
  {
    title: 'round 2',
    async run(ctx) {
      await ctx.caption(B, 'مرحله‌ی دوم');
      await ctx.moveTo(1300, 450);
      await addRound((await ctx.role('waiter')).api, state.o5.id, [['قهوه', 2]]);
      await ctx.sleep(1800);
      const cards = kdsCard(ctx, 'میز ۵');
      await ctx.look(cards.filter({ has: ctx.page.locator('.kds-round') }).locator('.kds-round'), 2800);
      await ctx.look(kdsCard(ctx, 'میز ۴').locator('.kds-card-head'), 2800);
    },
  },
  {
    title: 'no-prep items',
    async run(ctx) {
      await ctx.caption(B, 'آیتم‌های بدون آماده‌سازی');
      const w = await ctx.show('waiter', { url: '/floor', caption: [ROLE.waiter, 'آب معدنی — مستقیم آماده'] });
      await ctx.sleep(600);
      await ctx.click(ctx.page.locator('.table-tile').filter({ hasText: 'میز ۵' }), { dy: 0.35, after: 1500 });
      await ctx.click(ctx.page.locator('.chips-scroll .chip', { hasText: /^متفرقه$/ }), { after: 800 });
      await ctx.click(ctx.page.locator('.menu-tile').filter({ hasText: 'آب معدنی' }), { after: 700 });
      await ctx.click(ctx.page.locator('.ticket-foot .btn-primary', { hasText: 'ارسال' }), { after: 1800 });
      await ctx.page.locator('.ticket-scroll').evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
      await ctx.look(ctx.page.locator('.rounds .item-row').filter({ hasText: 'آب معدنی' }), 3000, { dx: 0.3 });
      void w;
    },
  },
  {
    title: 'summary',
    async run(ctx) {
      await ctx.slide('showList', 'خلاصه‌ی کار بار', [
        { icon: '🍹', text: 'فقط نوشیدنی‌ها به این صفحه می‌آیند' },
        { icon: '▶️', text: 'فیش را «شروع» کنید' },
        { icon: '✅', text: 'هر نوشیدنی آماده شد، اعلامش کنید' },
        { icon: '🔔', text: 'گارسون همان لحظه خبردار می‌شود' },
      ]);
    },
  },
];
