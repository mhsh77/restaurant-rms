// Video 6 — the manager, in detail.
import { ROLE, busyRoom, ticketRow, closeModal, stationId } from './common.mjs';

const M = ROLE.manager;
const POS = 'corner'; // the manager's top bar is full of links; captions go bottom-left
const state = {};

export async function setup(ctx) {
  state.room = await busyRoom(ctx);
  state.kitchen = await stationId(ctx, 'kitchen');
  await ctx.role('managerLogin', { noLogin: true });
  await ctx.go('/login', await ctx.role('managerLogin'));
}

const nav = (ctx, label) => ctx.page.locator('.navlink', { hasText: new RegExp(`^${label}$`) });
const cap = (ctx, text) => ctx.caption(M, text, POS);
const scrollTo = (ctx, y) => ctx.page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y);

export const scenes = [
  {
    title: 'intro',
    async run(ctx) {
      await ctx.slide('showTitle', {
        emoji: '🧑‍💼',
        kicker: 'راهنمای نقش‌ها',
        title: 'راهنمای کامل مدیر',
        roles: ['داشبورد', 'سفارش‌ها', 'گزارش‌ها', 'منو', 'میزها و کارکنان', 'رویدادها', 'تنظیمات'],
      });
    },
  },
  {
    title: 'login',
    async run(ctx) {
      await ctx.show('managerLogin', { caption: [M, 'ورود به سیستم', POS] });
      await ctx.sleep(400);
      await ctx.type('input[autocomplete=username]', 'manager', { delay: 110 });
      await ctx.type('input[type=password]', 'manager123', { delay: 80 });
      await ctx.click(ctx.btn('ورود'), { after: 1600 });
      await cap(ctx, 'داشبورد');
    },
  },
  {
    title: 'dashboard tiles',
    async run(ctx) {
      const tiles = ctx.page.locator('.stats').first().locator('> *');
      const n = await tiles.count();
      for (let i = 0; i < n; i++) await ctx.look(tiles.nth(i), i === 0 ? 2600 : 1800);
    },
  },
  {
    title: 'dashboard stations + charts',
    async run(ctx) {
      await ctx.look(ctx.page.locator('.grid-2 .card').first(), 3500, { dy: 0.2 });
      await ctx.wheel(700);
      await ctx.sleep(3000);
      await ctx.wheel(700);
      await ctx.sleep(3000);
      await scrollTo(ctx, 0);
    },
  },
  {
    title: 'floor + kitchen display',
    async run(ctx) {
      await cap(ctx, 'میزها و نمایشگر آشپزخانه');
      await ctx.click(nav(ctx, 'میزها'), { after: 2500 });
      await ctx.click(nav(ctx, 'آشپزخانه'), { after: 3500 });
      await ctx.look(ctx.page.locator('.kds-card.is-late').first().locator('.kds-card-head'), 2500);
    },
  },
  {
    title: 'manager cancels a preparing item',
    async run(ctx) {
      await cap(ctx, 'لغو آیتم در حال آماده‌سازی');
      await ctx.go('/floor');
      await ctx.click(ctx.page.locator('.table-tile').filter({ hasText: 'میز ۸' }), { dy: 0.35, after: 1800 });
      const row = ticketRow(ctx, 'اسپاگتی');
      await ctx.look(row.locator('.badge'), 1500);
      await ctx.click(row.locator('.icon-btn.danger'), { after: 900 });
      await ctx.type('.modal input', 'مهمان منصرف شد', { delay: 80 });
      await ctx.click(ctx.page.locator('.modal-footer .btn', { hasText: 'لغو آیتم' }), { after: 1800 });
      await ctx.look(row, 1500, { dx: 0.3 });
      await ctx.look('.ticket-total', 2000);
    },
  },
  {
    title: 'orders + detail',
    async run(ctx) {
      await cap(ctx, 'سفارش‌ها');
      await ctx.click(nav(ctx, 'سفارش‌ها'), { after: 1800 });
      await ctx.look('.filter-bar, form', 2000, { dx: 0.5 });
      await ctx.click(ctx.page.locator('.data-table tbody tr').nth(6), { after: 2000 });
      await ctx.look('.detail-grid', 2500);
      await ctx.wheel(500);
      await ctx.sleep(2000);
    },
  },
  {
    title: 'reports top',
    async run(ctx) {
      await cap(ctx, 'گزارش‌ها');
      await ctx.click(nav(ctx, 'گزارش‌ها'), { after: 1500 });
      await ctx.look('.segmented', 1500);
      await ctx.click(ctx.page.locator('.segmented button', { hasText: 'این ماه' }), { after: 2200 });
      await ctx.look('.stats', 2500, { dx: 0.5 });
      await ctx.wheel(450);
      await ctx.sleep(2500);
    },
  },
  {
    title: 'reports lower',
    async run(ctx) {
      for (let i = 0; i < 5; i++) {
        await ctx.wheel(650);
        await ctx.sleep(1800);
      }
      await ctx.look(ctx.page.locator('a.btn', { hasText: 'CSV' }).last(), 2000);
      await scrollTo(ctx, 0);
    },
  },
  {
    title: 'menu availability',
    async run(ctx) {
      await cap(ctx, 'منو');
      await ctx.click(nav(ctx, 'منو'), { after: 1800 });
      await ctx.type('input[aria-label="جستجوی آیتم"]', 'پیتزا', { delay: 130 });
      await ctx.sleep(1200);
      const row = ctx.page.locator('.data-table tbody tr').filter({ hasText: 'پیتزا سبزیجات' });
      await ctx.look(row, 1500, { dx: 0.8 });
      await ctx.click(row.locator('.toggle').nth(1), { after: 2200 });
    },
  },
  {
    title: 'menu edit dialog',
    async run(ctx) {
      await cap(ctx, 'ویرایش آیتم');
      await ctx.page.locator('input[aria-label="جستجوی آیتم"]').fill('');
      await ctx.sleep(500);
      const row = ctx.page.locator('.data-table tbody tr').filter({ hasText: 'کاپوچینو' });
      await ctx.click(row.locator('.row-actions .icon-btn').first(), { after: 1500 });
      await ctx.look(ctx.page.locator('.modal .field').filter({ hasText: 'قیمت' }), 2000);
      await ctx.look(ctx.page.locator('.modal .field').filter({ hasText: 'محل آماده‌سازی' }), 3500);
      await ctx.look(ctx.page.locator('.modal .field').filter({ hasText: 'تصویر' }), 2000);
      await closeModal(ctx);
    },
  },
  {
    title: 'tables + staff',
    async run(ctx) {
      await cap(ctx, 'میزها و کارکنان');
      await ctx.click(nav(ctx, 'مدیریت میزها'), { after: 2500 });
      await ctx.click(nav(ctx, 'کارکنان'), { after: 1800 });
      await ctx.click(ctx.page.locator('.page-actions .btn-primary'), { after: 1000 });
      await ctx.type('.modal input >> nth=0', 'حسین نوری', { delay: 90 });
      await ctx.type('.modal input >> nth=1', 'hossein', { delay: 90 });
      await ctx.point('.modal select');
      await ctx.page.locator('.modal select').selectOption('WAITER');
      await ctx.sleep(700);
      await ctx.type('.modal input[type=password]', 'waiter123', { delay: 70 });
      await ctx.click(ctx.page.locator('.modal-footer .btn-primary'), { after: 2000 });
    },
  },
  {
    title: 'audit log',
    async run(ctx) {
      await cap(ctx, 'رویدادها');
      await ctx.click(nav(ctx, 'رویدادها'), { after: 1800 });
      await ctx.type('input[type=search]', 'اسپاگتی', { delay: 130 });
      await ctx.click(ctx.page.locator('form .btn-primary'), { after: 2000 });
      await ctx.look(ctx.page.locator('.data-table tbody tr, .audit-row, .log-row').first(), 3500, { dx: 0.6 });
    },
  },
  {
    title: 'settings',
    async run(ctx) {
      await cap(ctx, 'تنظیمات');
      await ctx.click(nav(ctx, 'تنظیمات'), { after: 1500 });
      await ctx.look(ctx.page.locator('h2', { hasText: 'رستوران و فیش' }), 1800);
      await ctx.wheel(500);
      await ctx.look(ctx.page.locator('h2', { hasText: 'روز کاری' }), 1800);
      await ctx.wheel(400);
      await ctx.look(ctx.page.locator('h2', { hasText: 'نمایشگر آشپزخانه' }), 2000);
      await ctx.look(ctx.page.locator('.toggle', { hasText: 'تکمیل سفارش فقط' }), 3000);
    },
  },
  {
    title: 'summary',
    async run(ctx) {
      await ctx.slide('showList', 'خلاصه‌ی کار مدیر', [
        { icon: '📊', text: 'داشبورد: وضعیت زنده‌ی امروز' },
        { icon: '📈', text: 'گزارش‌ها: فروش گذشته، با خروجی CSV' },
        { icon: '🍕', text: 'منو، میزها و کارکنان: تنظیم رستوران' },
        { icon: '🗂️', text: 'رویدادها: چه کسی، چه کاری، چه زمانی' },
        { icon: '⚙️', text: 'تنظیمات: قوانین و زمان‌بندی‌ها' },
      ]);
    },
  },
];
