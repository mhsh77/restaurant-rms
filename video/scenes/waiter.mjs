// Video 2 — the waiter, in detail.
import {
  ROLE, busyRoom, clickTable, seatGuests, addItem, menuTile, sendCart, advanceStation, deliverAll,
  payInFull, ticketRow, cartRow, closeModal, tableByName,
} from './common.mjs';

const TABLE = 'میز ۵';
const W = ROLE.waiter;
const state = {};

export async function setup(ctx) {
  state.room = await busyRoom(ctx);
  // a signed-out browser for the login scene; after it, this is the waiter's screen
  await ctx.role('waiterLogin', { noLogin: true });
  await ctx.go('/login', await ctx.role('waiterLogin'));
}

const kitchen = async (ctx) => (await ctx.role('kitchen')).api;
const bar = async (ctx) => (await ctx.role('bar')).api;
async function myOrderId(ctx) {
  const t = await tableByName(ctx.who.api, TABLE);
  return t.order.id;
}

export const scenes = [
  {
    title: 'intro',
    async run(ctx) {
      await ctx.slide('showTitle', {
        emoji: '🤵',
        kicker: 'راهنمای نقش‌ها',
        title: 'راهنمای کامل گارسون',
        sub: 'از نشاندن مهمان تا آزاد کردن میز',
        roles: ['میزها', 'ثبت سفارش', 'مرحله‌ی دوم', 'تحویل', 'فیش', 'آزاد کردن میز'],
      });
    },
  },
  {
    title: 'login',
    async run(ctx) {
      await ctx.show('waiterLogin', { caption: [W, 'ورود به سیستم'] });
      await ctx.sleep(800);
      await ctx.type('input[autocomplete=username]', 'ali', { delay: 120 });
      await ctx.type('input[type=password]', 'waiter123', { delay: 90 });
      await ctx.click(ctx.btn('ورود'), { after: 1800 });
      await ctx.caption(W, 'صفحه‌ی میزها');
    },
  },
  {
    title: 'floor colours',
    async run(ctx) {
      const tile = (n) => ctx.page.locator('.table-tile').filter({ has: ctx.page.locator('.tile-name', { hasText: new RegExp(`^${n}$`) }) });
      await ctx.look(tile('میز ۱'), 2600, { dy: 0.4 });
      await ctx.look(tile('میز ۱۰'), 3200, { dy: 0.4 });
      await ctx.look(tile('میز ۸'), 3200, { dy: 0.4 });
      await ctx.look(tile('میز ۲'), 3000, { dy: 0.4 });
    },
  },
  {
    title: 'tile details + filters',
    async run(ctx) {
      const t8 = ctx.page.locator('.table-tile').filter({ hasText: 'میز ۸' }).locator('.tile-order');
      await ctx.look(t8, 3500);
      await ctx.click(ctx.page.locator('.chip-status.st-preparing'), { after: 2000 });
      await ctx.click(ctx.page.locator('.chips .chip').first(), { after: 1200 });
      await ctx.click(ctx.page.locator('.chip', { hasText: 'میزهای من' }), { after: 2200 });
      await ctx.click(ctx.page.locator('.chip', { hasText: 'میزهای من' }), { after: 800 });
    },
  },
  {
    title: 'seat guests',
    async run(ctx) {
      await ctx.caption(W, 'نشاندن مهمان');
      await clickTable(ctx, TABLE);
      await ctx.sleep(1500);
      await seatGuests(ctx, '۴');
    },
  },
  {
    title: 'menu tour',
    async run(ctx) {
      await ctx.caption(W, 'منو');
      await ctx.look('.menu-pane .chips', 1400, { dx: 0.8 });
      await ctx.click(ctx.page.locator('.chips-scroll .chip', { hasText: /^دسر$/ }), { after: 1400 });
      await ctx.look(menuTile(ctx, 'تیرامیسو'), 2200);
      await ctx.click(ctx.page.locator('.chips-scroll .chip', { hasText: /^همه$/ }), { after: 700 });
      await ctx.type('.menu-toolbar input[type=search]', 'پیتزا', { delay: 150 });
      await ctx.sleep(1800);
      await ctx.page.locator('.menu-toolbar input[type=search]').fill('');
      await ctx.sleep(600);
    },
  },
  {
    title: 'add items',
    async run(ctx) {
      await ctx.caption(W, 'انتخاب اقلام');
      await addItem(ctx, 'پیتزا مارگاریتا', 2);
      await addItem(ctx, 'همبرگر کلاسیک');
      await addItem(ctx, 'سیب‌زمینی سرخ‌کرده');
      await addItem(ctx, 'نوشابه');
      await ctx.click(cartRow(ctx, 'نوشابه').locator('.stepper button').first(), { after: 900 });
      await addItem(ctx, 'کاپوچینو');
      await ctx.look(menuTile(ctx, 'کاپوچینو').locator('.menu-tile-meta'), 1500);
    },
  },
  {
    title: 'note',
    async run(ctx) {
      await ctx.caption(W, 'توضیح برای آشپزخانه');
      await ctx.click(cartRow(ctx, 'همبرگر کلاسیک').locator('.item-actions .icon-btn').first(), { after: 1000 });
      await ctx.click(ctx.page.locator('.modal .chip', { hasText: 'بدون پیاز' }), { after: 1400 });
      await ctx.click(ctx.page.locator('.modal-footer .btn-primary'), { after: 900 });
      await ctx.look(cartRow(ctx, 'همبرگر کلاسیک').locator('.item-note'), 1500);
    },
  },
  {
    title: 'send',
    async run(ctx) {
      await ctx.caption(W, 'ارسال سفارش');
      await ctx.look('.ticket-foot .btn-primary', 1500);
      await sendCart(ctx);
      await ctx.look('.round-head', 2500);
    },
  },
  {
    title: 'cancel pending item',
    async run(ctx) {
      await ctx.caption(W, 'تغییر یا لغو آیتم جدید');
      await ctx.look(ticketRow(ctx, 'پیتزا مارگاریتا').locator('.stepper'), 1800);
      await ctx.click(ticketRow(ctx, 'سیب‌زمینی').locator('.icon-btn.danger'), { after: 900 });
      await ctx.type('.modal input', 'مشتری منصرف شد', { delay: 90 });
      await ctx.click(ctx.page.locator('.modal-footer .btn', { hasText: 'لغو آیتم' }), { after: 1600 });
      await ctx.look(ticketRow(ctx, 'سیب‌زمینی'), 1500);
    },
  },
  {
    title: 'kitchen starts — live',
    async run(ctx) {
      await ctx.caption(W, 'به‌روزرسانی زنده');
      await ctx.point(ticketRow(ctx, 'پیتزا مارگاریتا'), { dx: 0.3 });
      await ctx.sleep(1200);
      await advanceStation(await kitchen(ctx), await myOrderId(ctx), 'PREPARING');
      await ctx.sleep(2500);
      await ctx.point(ticketRow(ctx, 'همبرگر کلاسیک'), { dx: 0.3 });
      await ctx.sleep(2500);
    },
  },
  {
    title: 'second round',
    async run(ctx) {
      await ctx.caption(W, 'مرحله‌ی دوم سفارش');
      await ctx.click(ctx.page.locator('.chips-scroll .chip', { hasText: /^دسر$/ }), { after: 700 });
      await addItem(ctx, 'کیک شکلاتی', 2);
      await ctx.click(ctx.page.locator('.chips-scroll .chip', { hasText: /^نوشیدنی گرم$/ }), { after: 700 });
      await addItem(ctx, 'قهوه', 2);
      await sendCart(ctx);
      await ctx.click(ctx.page.locator('.chips-scroll .chip', { hasText: /^همه$/ }), { after: 400 });
      await ctx.page.locator('.ticket-scroll').evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
      await ctx.look(ctx.page.locator('.round-head').nth(1), 2500);
    },
  },
  {
    title: 'ready arrives',
    async run(ctx) {
      await ctx.caption(W, 'خبر آماده شدن');
      await ctx.page.locator('.ticket-scroll').evaluate((el) => el.scrollTo({ top: 0, behavior: 'smooth' }));
      await ctx.moveTo(800, 450);
      const id = await myOrderId(ctx);
      await advanceStation(await kitchen(ctx), id, 'READY', { batchNo: 1 });
      await advanceStation(await bar(ctx), id, 'READY', { batchNo: 1 });
      await advanceStation(await kitchen(ctx), state.room.o3.id, 'READY'); // a colleague's table is ready too
      await ctx.sleep(1500);
      if (await ctx.page.locator('.toast').count()) await ctx.look(ctx.page.locator('.toast').first(), 1800);
      await ctx.look('.bell-btn', 1800);
      await ctx.look(ticketRow(ctx, 'پیتزا مارگاریتا').locator('.btn-success'), 1800);
    },
  },
  {
    title: 'bell panel',
    async run(ctx) {
      await ctx.click('.bell-btn', { after: 1500 });
      await ctx.look(ctx.page.locator('.bell-group').first(), 3000, { dx: 0.7 });
      await ctx.look(ctx.page.locator('.bell-group').nth(1), 3500, { dx: 0.7 });
      await ctx.click('.bell-btn', { after: 600 });
    },
  },
  {
    title: 'deliver',
    async run(ctx) {
      await ctx.caption(W, 'تحویل');
      await ctx.click(ticketRow(ctx, 'کاپوچینو').locator('.btn-success'), { after: 1800 });
      await ctx.look(ticketRow(ctx, 'کاپوچینو').locator('.badge'), 1200);
      await ctx.click(ctx.page.locator('.ticket-foot .btn-success'), { after: 2200 });
      await ctx.look(ctx.page.locator('.round').first(), 1500, { dx: 0.3 });
    },
  },
  {
    title: 'receipt',
    async run(ctx) {
      await ctx.caption(W, 'فیش');
      await ctx.click(ctx.page.locator('.ticket-foot .btn', { hasText: 'فیش' }), { after: 1500 });
      await ctx.wheel(500, '.modal-body');
      await ctx.sleep(2500);
      await ctx.look(ctx.page.locator('.modal-footer .btn', { hasText: 'چاپ' }), 2000);
      await closeModal(ctx);
    },
  },
  {
    title: 'complete needs payment',
    async run(ctx) {
      await ctx.caption(W, 'تکمیل بعد از پرداخت');
      const id = await myOrderId(ctx);
      await advanceStation(await kitchen(ctx), id, 'READY');
      await advanceStation(await bar(ctx), id, 'READY');
      await ctx.sleep(1500);
      await ctx.click(ctx.page.locator('.ticket-foot .btn-success'), { after: 1800 });
      await ctx.look(ctx.page.locator('.ticket-foot .btn-primary', { hasText: 'تکمیل' }), 2200);
      await ctx.look('.ticket-foot .notice-warn', 3500);
    },
  },
  {
    title: 'paid → release',
    async run(ctx) {
      await ctx.caption(W, 'آزاد کردن میز');
      await ctx.moveTo(900, 500);
      await payInFull((await ctx.role('cashier')).api, await myOrderId(ctx), 'CARD');
      await ctx.sleep(2000);
      await ctx.look('.center-card h2', 2500);
      await ctx.click(ctx.page.locator('.btn-primary', { hasText: 'آزاد کن' }), { after: 1600 });
      await ctx.look(ctx.page.locator('.table-tile').filter({ hasText: TABLE }), 2200, { dy: 0.4 });
    },
  },
  {
    title: 'orders page',
    async run(ctx) {
      await ctx.caption(W, 'سفارش‌ها');
      await ctx.click(ctx.page.locator('.navlink', { hasText: 'سفارش‌ها' }), { after: 1500 });
      await ctx.type('input[type=search]', 'میز ۵', { delay: 130 });
      await ctx.click(ctx.btn('جستجو'), { after: 1500 });
      await ctx.click(ctx.page.locator('.data-table tbody tr').first(), { after: 1800 });
      await ctx.wheel(600);
      await ctx.sleep(1500);
    },
  },
  {
    title: 'summary',
    async run(ctx) {
      await ctx.slide('showList', 'خلاصه‌ی کار گارسون', [
        { icon: '🪑', text: 'نشاندن مهمان و باز کردن سفارش' },
        { icon: '📝', text: 'انتخاب اقلام، توضیح، و ارسال — در یک یا چند مرحله' },
        { icon: '🔔', text: 'دنبال کردن وضعیت و خبر آماده شدن' },
        { icon: '🍽️', text: 'تحویل آیتم‌های آماده' },
        { icon: '💳', text: 'راهنمایی مهمان به صندوق' },
        { icon: '✅', text: 'آزاد کردن میز بعد از تکمیل' },
      ], { stepMs: 1000 });
    },
  },
];
