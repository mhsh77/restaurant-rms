// Video 5 — the cashier, in detail.
import { ROLE, busyRoom, openOrder, advanceStation, deliverAll, closeModal } from './common.mjs';

const C = ROLE.cashier;

async function servedOrder(ctx, table, guests, lines) {
  const w = (await ctx.role('waiter')).api;
  const o = await openOrder(w, table, guests, lines);
  await advanceStation((await ctx.role('kitchen')).api, o.id, 'READY');
  await advanceStation((await ctx.role('bar')).api, o.id, 'READY');
  await deliverAll(w, o.id);
  return o;
}

export async function setup(ctx) {
  await busyRoom(ctx);
  await servedOrder(ctx, 'میز ۵', 4, [['پیتزا مارگاریتا', 2], ['همبرگر کلاسیک', 1], ['نوشابه', 2], ['کاپوچینو', 1]]);
  await servedOrder(ctx, 'میز ۶', 2, [['جوجه‌کباب', 2], ['چای', 2]]);
  await ctx.role('cashierLogin', { noLogin: true });
  await ctx.go('/login', await ctx.role('cashierLogin'));
}

const bill = (ctx, table) => ctx.page.locator('.bill-row').filter({ hasText: table });
const method = (ctx, label) => ctx.page.locator('.method-btn', { hasText: label });
const amount = (ctx) => ctx.page.locator('input[aria-label="مبلغ پرداخت"]');
const submit = (ctx) => ctx.page.locator('.pay-form button[type=submit]');

export const scenes = [
  {
    title: 'intro',
    async run(ctx) {
      await ctx.slide('showTitle', { emoji: '💳', kicker: 'راهنمای نقش‌ها', title: 'راهنمای کامل صندوقدار', sub: 'دریافت وجه، تقسیم صورتحساب، ابطال و فیش' });
    },
  },
  {
    title: 'login',
    async run(ctx) {
      await ctx.show('cashierLogin', { caption: [C, 'ورود به سیستم'] });
      await ctx.sleep(400);
      await ctx.type('input[autocomplete=username]', 'neda', { delay: 120 });
      await ctx.type('input[type=password]', 'cashier123', { delay: 80 });
      await ctx.click(ctx.btn('ورود'), { after: 1500 });
      await ctx.caption(C, 'صفحه‌ی صندوق');
    },
  },
  {
    title: 'summary tiles',
    async run(ctx) {
      const tiles = ctx.page.locator('.stats > *');
      const n = await tiles.count();
      for (let i = 0; i < n; i++) await ctx.look(tiles.nth(i), i === 0 ? 3000 : 2200);
    },
  },
  {
    title: 'bill list + search',
    async run(ctx) {
      await ctx.caption(C, 'صورتحساب‌های در انتظار پرداخت');
      await ctx.look(bill(ctx, 'میز ۵'), 3000);
      await ctx.look(bill(ctx, 'میز ۸'), 3000);
      await ctx.type('.cashier-list input[type=search]', 'مریم', { delay: 150 });
      await ctx.sleep(2500);
      await ctx.page.locator('.cashier-list input[type=search]').fill('');
      await ctx.sleep(1200);
    },
  },
  {
    title: 'open table 5',
    async run(ctx) {
      await ctx.click(bill(ctx, 'میز ۵'), { after: 1500 });
      await ctx.look('.bill-lines', 3000, { dx: 0.3 });
      await ctx.look('.bill-totals', 3000, { dx: 0.3 });
    },
  },
  {
    title: 'split in two',
    async run(ctx) {
      await ctx.caption(C, 'تقسیم صورتحساب');
      await ctx.look('.split-row', 1500);
      await ctx.click(ctx.page.locator('.split-row .stepper button').first(), { after: 1800 });
      await ctx.look(amount(ctx), 2500);
    },
  },
  {
    title: 'card payment',
    async run(ctx) {
      await ctx.caption(C, 'پرداخت با کارت');
      await ctx.click(method(ctx, 'کارت'), { after: 900 });
      await ctx.type('.pay-form input[maxlength="60"]', '482913', { delay: 120 });
      await ctx.click(submit(ctx), { after: 2000 });
      await ctx.look('.bill-head .button-row', 2200);
      await ctx.look('.payment-rows', 2000, { dx: 0.4 });
    },
  },
  {
    title: 'cash + change',
    async run(ctx) {
      await ctx.caption(C, 'پرداخت نقدی و باقی پول');
      await ctx.click(method(ctx, 'نقدی'), { after: 900 });
      await ctx.look(amount(ctx), 1500);
      await ctx.click(ctx.page.locator('.quick-cash .chip').nth(2), { after: 1500 });
      await ctx.look('.pay-form .change-box', 3000);
    },
  },
  {
    title: 'settle + complete',
    async run(ctx) {
      await ctx.caption(C, 'تسویه و تکمیل');
      await ctx.look('.check-row', 2500);
      await ctx.click(submit(ctx), { after: 2200 });
      await ctx.look('.bill-totals', 2000, { dx: 0.3 });
      await ctx.look('.notice-success', 2500);
    },
  },
  {
    title: 'receipt + paid tab',
    async run(ctx) {
      await ctx.caption(C, 'فیش');
      await ctx.click(ctx.page.locator('.bill .btn', { hasText: 'فیش' }), { after: 1500 });
      await ctx.wheel(700, '.modal-body');
      await ctx.sleep(2500);
      await closeModal(ctx);
      await ctx.click(ctx.page.locator('.segmented button', { hasText: 'تسویه‌شده' }), { after: 2800 });
      await ctx.click(ctx.page.locator('.segmented button', { hasText: 'در انتظار' }), { after: 1000 });
    },
  },
  {
    title: 'void a wrong payment',
    async run(ctx) {
      await ctx.caption(C, 'ابطال پرداخت اشتباه');
      await ctx.click(bill(ctx, 'میز ۶'), { after: 1200 });
      await ctx.click(method(ctx, 'کارت'), { after: 500 });
      await amount(ctx).fill('');
      await ctx.type(amount(ctx), '104000', { delay: 110 });
      await ctx.click(submit(ctx), { after: 1800 });
      await ctx.click(ctx.page.locator('.payment-row .btn', { hasText: 'ابطال' }), { after: 900 });
      await ctx.type('.modal input', 'مبلغ اشتباه وارد شد', { delay: 80 });
      await ctx.click(ctx.page.locator('.modal-footer .btn', { hasText: 'ابطال پرداخت' }), { after: 2000 });
      await ctx.look('.payment-row.is-void', 3000, { dx: 0.4 });
    },
  },
  {
    title: 'cannot overpay',
    async run(ctx) {
      await ctx.caption(C, 'جلوگیری از مبلغ اضافه');
      await amount(ctx).fill('');
      await ctx.type(amount(ctx), '2000000', { delay: 110 });
      await ctx.look('.pay-form .field-error', 2500);
      await ctx.look(submit(ctx), 2000);
    },
  },
  {
    title: 'pay before served',
    async run(ctx) {
      await ctx.caption(C, 'پرداخت پیش از سرو کامل');
      await ctx.click(bill(ctx, 'میز ۸'), { after: 1500 });
      await ctx.look('.bill .notice-info', 3500);
      await ctx.look('.check-row', 2500);
    },
  },
  {
    title: 'summary',
    async run(ctx) {
      await ctx.slide('showList', 'خلاصه‌ی کار صندوقدار', [
        { icon: '📋', text: 'صورتحساب را از فهرست انتخاب کنید' },
        { icon: '💳', text: 'روش پرداخت: نقد، کارت‌خوان یا سایر' },
        { icon: '➗', text: 'در صورت نیاز بین مهمان‌ها تقسیم کنید' },
        { icon: '💵', text: 'باقی پول را از روی صفحه بخوانید' },
        { icon: '🚫', text: 'پرداخت اشتباه را باطل کنید، نه پاک' },
      ]);
    },
  },
];
