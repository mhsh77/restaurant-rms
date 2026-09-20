/**
 * Seed data (Persian, Toman).
 *   node src/db/seed.js --reset --history   wipe DB, demo data + 30 days of order history
 *   node src/db/seed.js --reset             wipe DB, demo data only (menu, tables, staff)
 *   node src/db/seed.js --minimal           production bootstrap: roles, restaurant, stations,
 *                                           one manager (MANAGER_USERNAME / MANAGER_PASSWORD env)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { closeDb, transaction, q, nowIso } from './connection.js';
import { migrate } from './migrate.js';
import { hashPassword } from '../auth/password.js';
import { businessDate, businessDayStartUtc, addDays, dayOfWeek } from '../services/time.js';

export const DEMO_USERS = [
  { name: 'رضا کریمی', username: 'manager', password: 'manager123', role: 'MANAGER' },
  { name: 'علی رضایی', username: 'ali', password: 'waiter123', role: 'WAITER' },
  { name: 'مریم احمدی', username: 'maryam', password: 'waiter123', role: 'WAITER' },
  { name: 'سارا مرادی', username: 'sara', password: 'kitchen123', role: 'KITCHEN' },
  { name: 'امید جعفری', username: 'omid', password: 'bar12345', role: 'BAR' },
  { name: 'ندا کاظمی', username: 'neda', password: 'cashier123', role: 'CASHIER' },
];

const DEFAULT_TIMEZONE = process.env.SEED_TIMEZONE || 'Asia/Tehran';
const faDigits = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

const CATEGORIES = ['پیش‌غذا', 'غذای اصلی', 'پیتزا', 'برگر', 'دسر', 'نوشیدنی سرد', 'نوشیدنی گرم', 'متفرقه'];
const MAIN_CATEGORIES = ['پیش‌غذا', 'غذای اصلی', 'پیتزا', 'برگر'];
const DRINK_CATEGORIES = ['نوشیدنی سرد', 'نوشیدنی گرم'];

// [category, name, price (Toman), station, type, popularity, prep minutes, description]
const MENU = [
  ['پیش‌غذا', 'سالاد سزار', 290000, 'kitchen', 'FOOD', 5, 5, 'کاهو، پنیر پارمزان، نان تست، سس سزار'],
  ['پیش‌غذا', 'سوپ جو', 150000, 'kitchen', 'FOOD', 3, 4, 'سوپ جو با قارچ و خامه'],
  ['پیش‌غذا', 'سیب‌زمینی سرخ‌کرده', 180000, 'kitchen', 'FOOD', 8, 6, 'سیب‌زمینی ترد با نمک دریایی'],
  ['پیش‌غذا', 'نان سیر', 140000, 'kitchen', 'FOOD', 4, 5, 'نان تست با کره سیر'],
  ['غذای اصلی', 'جوجه‌کباب', 450000, 'kitchen', 'FOOD', 5, 16, 'جوجه‌کباب زعفرانی با برنج و گوجه کبابی'],
  ['غذای اصلی', 'استیک گوشت', 950000, 'kitchen', 'FOOD', 3, 18, '۲۵۰ گرم فیله گوساله، سیب‌زمینی، کره سبزیجات'],
  ['غذای اصلی', 'ماهی سالمون', 850000, 'kitchen', 'FOOD', 2, 15, 'سالمون سرخ‌شده با برنج و سس لیمو'],
  ['غذای اصلی', 'اسپاگتی بولونیز', 390000, 'kitchen', 'FOOD', 5, 11, 'اسپاگتی با سس گوشت و گوجه'],
  ['پیتزا', 'پیتزا مارگاریتا', 380000, 'kitchen', 'FOOD', 9, 12, 'سس گوجه، موتزارلا، ریحان'],
  ['پیتزا', 'پیتزا پپرونی', 450000, 'kitchen', 'FOOD', 7, 12, 'سس گوجه، موتزارلا، پپرونی'],
  ['پیتزا', 'پیتزا چهار پنیر', 490000, 'kitchen', 'FOOD', 3, 13, 'موتزارلا، گودا، پارمزان، چدار'],
  ['پیتزا', 'پیتزا سبزیجات', 360000, 'kitchen', 'FOOD', 2, 13, 'فلفل دلمه، قارچ، زیتون، پیاز'],
  ['برگر', 'همبرگر کلاسیک', 350000, 'kitchen', 'FOOD', 8, 10, 'گوشت گوساله، کاهو، گوجه، سس مخصوص'],
  ['برگر', 'چیزبرگر', 390000, 'kitchen', 'FOOD', 6, 10, 'گوشت گوساله، پنیر چدار، خیارشور'],
  ['برگر', 'برگر مرغ', 330000, 'kitchen', 'FOOD', 4, 11, 'فیله مرغ سوخاری، کلم'],
  ['برگر', 'برگر قارچ و پنیر', 420000, 'kitchen', 'FOOD', 2, 11, 'گوشت گوساله، قارچ، پنیر سوئیسی'],
  ['دسر', 'کیک شکلاتی', 180000, 'kitchen', 'FOOD', 5, 3, 'کیک شکلاتی گرم'],
  ['دسر', 'چیزکیک', 210000, 'kitchen', 'FOOD', 3, 3, 'چیزکیک نیویورکی'],
  ['دسر', 'بستنی', 120000, 'kitchen', 'FOOD', 3, 2, 'سه اسکوپ'],
  ['دسر', 'تیرامیسو', 230000, 'kitchen', 'FOOD', 2, 3, 'ماسکارپونه، اسپرسو، کاکائو'],
  ['نوشیدنی سرد', 'نوشابه', 60000, 'bar', 'DRINK', 10, 1, 'قوطی ۳۳۰ میلی‌لیتر'],
  ['نوشیدنی سرد', 'اسپرایت', 60000, 'bar', 'DRINK', 4, 1, 'قوطی ۳۳۰ میلی‌لیتر'],
  ['نوشیدنی سرد', 'آب‌پرتقال', 140000, 'bar', 'DRINK', 5, 3, 'تازه'],
  ['نوشیدنی سرد', 'لیموناد', 120000, 'bar', 'DRINK', 4, 2, 'لیموناد خانگی با نعنا'],
  ['نوشیدنی سرد', 'شیک توت‌فرنگی', 190000, 'bar', 'DRINK', 3, 4, 'توت‌فرنگی، بستنی وانیلی، شیر'],
  ['نوشیدنی گرم', 'کاپوچینو', 150000, 'bar', 'DRINK', 7, 3, 'دبل شات با شیر بخارداده'],
  ['نوشیدنی گرم', 'اسپرسو', 110000, 'bar', 'DRINK', 4, 2, 'تک‌خاستگاه'],
  ['نوشیدنی گرم', 'لاته', 160000, 'bar', 'DRINK', 4, 3, 'اسپرسو با شیر بخارداده'],
  ['نوشیدنی گرم', 'قهوه', 130000, 'bar', 'DRINK', 5, 2, 'آمریکانو'],
  ['نوشیدنی گرم', 'چای', 70000, 'bar', 'DRINK', 3, 2, 'چای سیاه یا سبز'],
  ['متفرقه', 'آب معدنی', 30000, 'other', 'DRINK', 6, 0, 'نیم‌لیتری — مستقیم توسط گارسون سرو می‌شود'],
  ['متفرقه', 'ظرف یکبار مصرف', 20000, 'other', 'NON_FOOD', 1, 0, 'برای بسته‌بندی باقی غذا'],
  ['متفرقه', 'شمع تولد', 40000, 'other', 'NON_FOOD', 1, 0, 'آیتم غیرغذایی'],
];

export function removeDatabaseFiles() {
  closeDb();
  if (config.dbFile === ':memory:') return;
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${config.dbFile}${suffix}`, { force: true });
}

function seedCore(now, { timezone, name }) {
  if (q.get('SELECT id FROM restaurants LIMIT 1')) throw new Error('Database is already seeded. Use --reset to start over.');
  for (const [code, roleName, description] of [
    ['MANAGER', 'مدیر', 'دسترسی کامل: منو، میزها، کارکنان، گزارش‌ها، تنظیمات'],
    ['WAITER', 'گارسون', 'میزها، سفارش‌ها، تحویل، فیش'],
    ['KITCHEN', 'آشپزخانه', 'نمایشگر آشپزخانه'],
    ['BAR', 'بار', 'نمایشگر بار'],
    ['CASHIER', 'صندوقدار', 'صندوق: دریافت وجه و تسویه صورتحساب سفارش‌ها'],
  ]) {
    q.run('INSERT INTO roles (code, name, description) VALUES (?, ?, ?)', code, roleName, description);
  }
  const rid = Number(
    q.run(
      `INSERT INTO restaurants (name, address, phone, receipt_footer, currency_symbol, currency_code, currency_decimals, timezone, day_start_hour, week_start_day,
                               require_payment_to_complete, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'تومان', 'IRT', 0, ?, 4, 6, 1, ?, ?)`,
      name,
      'تهران، خیابان ولیعصر، پلاک ۱۲',
      '۰۲۱-۸۸۰۰۱۲۳۴',
      'از انتخاب شما سپاسگزاریم — منتظر دیدار دوباره شما هستیم',
      timezone,
      now,
      now,
    ).lastInsertRowid,
  );
  const roleId = (code) => q.get('SELECT id FROM roles WHERE code = ?', code).id;
  for (const [code, stationName, role, autoReady, sort] of [
    ['kitchen', 'آشپزخانه', 'KITCHEN', 0, 1],
    ['bar', 'بار', 'BAR', 0, 2],
    ['other', 'سایر (بدون آماده‌سازی)', null, 1, 3],
  ]) {
    q.run(
      'INSERT INTO stations (restaurant_id, code, name, role_id, auto_ready, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      rid,
      code,
      stationName,
      role ? roleId(role) : null,
      autoReady,
      sort,
      now,
      now,
    );
  }
  return { rid, roleId };
}

function insertUser(rid, roleId, u, now) {
  q.run(
    'INSERT INTO users (restaurant_id, role_id, name, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    rid,
    roleId(u.role),
    u.name,
    u.username,
    hashPassword(u.password),
    now,
    now,
  );
}

export function seedDemo({ timezone = DEFAULT_TIMEZONE } = {}) {
  migrate({ log: () => {} });
  const now = nowIso();
  transaction(() => {
    const { rid, roleId } = seedCore(now, { timezone, name: 'رستوران زیتون' });
    for (const u of DEMO_USERS) insertUser(rid, roleId, u, now);

    for (let i = 1; i <= 10; i++) {
      const area = i <= 6 ? 'سالن اصلی' : 'تراس';
      const capacity = [2, 2, 4, 4, 4, 6, 2, 4, 4, 8][i - 1];
      q.run(
        'INSERT INTO dining_tables (restaurant_id, name, capacity, area, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        rid,
        `میز ${faDigits(i)}`,
        capacity,
        area,
        i,
        now,
        now,
      );
    }
    CATEGORIES.forEach((c, idx) =>
      q.run('INSERT INTO menu_categories (restaurant_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', rid, c, idx + 1, now, now),
    );
    // the demo restaurant offers all three ordering workflows
    q.run('UPDATE restaurants SET mode_table_service = 1, mode_counter_table = 1, mode_counter_pickup = 1 WHERE id = ?', rid);
    const categoryId = (n) => q.get('SELECT id FROM menu_categories WHERE name = ?', n).id;
    const stationId = (code) => q.get('SELECT id FROM stations WHERE code = ?', code).id;
    MENU.forEach(([cat, itemName, price, station, type, , , description], idx) => {
      q.run(
        `INSERT INTO menu_items (restaurant_id, category_id, station_id, name, description, price, item_type, is_available, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rid,
        categoryId(cat),
        stationId(station),
        itemName,
        description,
        price,
        type,
        itemName === 'تیرامیسو' ? 0 : 1, // one item out of stock to show availability handling
        idx + 1,
        now,
        now,
      );
    });
    q.run(
      "INSERT INTO audit_logs (restaurant_id, user_id, action, entity_type, entity_id, summary, created_at) VALUES (?, NULL, 'system.seed', 'restaurant', ?, 'داده‌های نمایشی ایجاد شد', ?)",
      rid,
      rid,
      now,
    );
  });
}

export function seedMinimal() {
  const username = process.env.MANAGER_USERNAME || 'manager';
  const password = process.env.MANAGER_PASSWORD;
  if (!password || password.length < 8) throw new Error('Set MANAGER_PASSWORD (at least 8 characters) for --minimal');
  migrate({ log: () => {} });
  const now = nowIso();
  transaction(() => {
    const { rid, roleId } = seedCore(now, { timezone: DEFAULT_TIMEZONE, name: process.env.RESTAURANT_NAME || 'رستوران من' });
    insertUser(rid, roleId, { name: 'مدیر', username, password, role: 'MANAGER' }, now);
  });
}

/* ───────────────────────────── demo history ───────────────────────────── */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate `days` of realistic completed orders (with item timings) ending earlier today. */
export function seedHistory({ days = 30 } = {}) {
  const rng = mulberry32(20260915);
  const between = (a, b) => a + rng() * (b - a);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const weighted = (arr, w) => {
    const total = arr.reduce((s, x) => s + w(x), 0);
    let r = rng() * total;
    for (const x of arr) if ((r -= w(x)) <= 0) return x;
    return arr.at(-1);
  };

  const restaurant = q.get('SELECT * FROM restaurants LIMIT 1');
  const users = q.all('SELECT u.id, u.name, r.code FROM users u JOIN roles r ON r.id = u.role_id');
  const waiters = users.filter((u) => u.code === 'WAITER');
  const kitchenUser = users.find((u) => u.code === 'KITCHEN');
  const barUser = users.find((u) => u.code === 'BAR');
  const cashierUser = users.find((u) => u.code === 'CASHIER');
  const tables = q.all('SELECT id FROM dining_tables WHERE is_active = 1');
  const meta = new Map(MENU.map(([cat, n, , , , popularity, prep]) => [n, { cat, popularity, prep }]));
  const menu = q
    .all('SELECT mi.id, mi.name, mi.price, mi.category_id, mi.station_id, s.auto_ready, s.code AS station_code FROM menu_items mi JOIN stations s ON s.id = mi.station_id')
    .map((m) => ({ ...m, ...meta.get(m.name) }));
  const mains = menu.filter((m) => MAIN_CATEGORIES.includes(m.cat));
  const drinks = menu.filter((m) => DRINK_CATEGORIES.includes(m.cat) || m.name === 'آب معدنی');
  const afters = menu.filter((m) => (m.cat === 'دسر' || m.cat === 'نوشیدنی گرم') && m.name !== 'تیرامیسو');

  // Local lunch and dinner peaks.
  const hourWeights = { 12: 6, 13: 8, 14: 6, 15: 2, 16: 1, 17: 2, 18: 3, 19: 5, 20: 8, 21: 9, 22: 7, 23: 3 };
  const hours = Object.keys(hourWeights).map(Number);
  const today = businessDate(restaurant);
  const cutoff = Date.now() - 2 * 3_600_000;
  const MIN = 60_000;

  const plans = [];
  for (let d = days - 1; d >= 0; d--) {
    const date = addDays(today, -d);
    const dow = dayOfWeek(date);
    const weekend = dow === 4 || dow === 5; // Thursday and Friday
    const count = Math.round(between(22, 34) * (weekend ? 1.35 : 1));
    const dayStart = businessDayStartUtc(restaurant, date).getTime();
    for (let k = 0; k < count; k++) {
      const hour = weighted(hours, (h) => hourWeights[h]);
      const opened = dayStart + (hour - restaurant.day_start_hour) * 3_600_000 + Math.floor(rng() * 60) * MIN;
      if (opened > cutoff) continue;
      plans.push({ opened, busy: hourWeights[hour] });
    }
  }
  plans.sort((a, b) => a.opened - b.opened);

  const iso = (ms) => new Date(ms).toISOString();
  let orderNumber = restaurant.order_seq;
  const tableFreeAt = new Map();

  transaction(() => {
    for (const { opened, busy } of plans) {
      // a quarter of the business is ordered and paid at the counter: half of those guests
      // sit down (a waiter brings it), half wait and take it away
      const roll = rng();
      const serviceMode = roll < 0.13 ? 'COUNTER_PICKUP' : roll < 0.25 ? 'COUNTER_TABLE' : 'TABLE';
      const table = serviceMode === 'COUNTER_PICKUP' ? null : tables.find((t) => (tableFreeAt.get(t.id) ?? 0) <= opened) ?? pick(tables);
      const waiter = pick(waiters);
      const guests = Math.max(1, Math.min(8, Math.round(between(1, 5))));
      const cancelledOrder = rng() < 0.03;
      orderNumber++;

      const orderId = Number(
        q.run(
          `INSERT INTO orders (restaurant_id, order_number, table_id, waiter_id, service_mode, guest_count, lifecycle, status, business_date, opened_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 'OPEN', ?, ?, ?)`,
          restaurant.id,
          orderNumber,
          table ? table.id : null,
          waiter.id,
          serviceMode,
          guests,
          businessDate(restaurant, new Date(opened)),
          iso(opened),
          iso(opened),
        ).lastInsertRowid,
      );

      const rounds = cancelledOrder ? 1 : rng() < 0.4 ? 2 : 1;
      let lastDelivered = opened;
      let subtotal = 0;
      for (let round = 1; round <= rounds; round++) {
        const submitted = round === 1 ? opened + between(3, 9) * MIN : lastDelivered + between(20, 40) * MIN;
        const batchId = Number(
          q.run('INSERT INTO order_batches (order_id, batch_no, created_by, client_request_id, submitted_at) VALUES (?, ?, ?, ?, ?)', orderId, round, waiter.id, `seed-${orderId}-${round}`, iso(submitted))
            .lastInsertRowid,
        );
        const lines = [];
        if (round === 1) {
          const nMains = Math.max(1, Math.round(guests * between(0.7, 1.1)));
          for (let i = 0; i < nMains; i++) lines.push(weighted(mains, (m) => m.popularity));
          const nDrinks = Math.max(1, Math.round(guests * between(0.5, 1)));
          for (let i = 0; i < nDrinks; i++) lines.push(weighted(drinks, (m) => m.popularity));
        } else {
          const n = Math.max(1, Math.round(guests * between(0.4, 0.9)));
          for (let i = 0; i < n; i++) lines.push(weighted(afters, (m) => m.popularity));
        }
        const merged = new Map();
        for (const m of lines) merged.set(m.id, { m, qty: (merged.get(m.id)?.qty ?? 0) + 1 });

        for (const { m, qty } of merged.values()) {
          const history = [];
          let status;
          let started = null;
          let ready = null;
          let delivered = null;
          let cancelled = null;
          const staff = m.station_code === 'kitchen' ? kitchenUser.id : m.station_code === 'bar' ? barUser.id : waiter.id;
          if (cancelledOrder || rng() < 0.02) {
            status = 'CANCELLED';
            cancelled = submitted + between(1, 4) * MIN;
            history.push(['PENDING', submitted, waiter.id], ['CANCELLED', cancelled, waiter.id]);
          } else if (m.auto_ready) {
            status = 'DELIVERED';
            ready = submitted;
            started = submitted;
            delivered = submitted + between(1, 3) * MIN;
            history.push(['READY', submitted, waiter.id], ['DELIVERED', delivered, waiter.id]);
          } else {
            status = 'DELIVERED';
            started = submitted + between(0.3, m.station_code === 'bar' ? 2 : 3 + busy * 0.3) * MIN;
            ready = started + Math.max(0.5, m.prep * between(0.75, 1.35) * qty ** 0.15) * MIN;
            delivered = ready + between(0.5, 3) * MIN;
            history.push(['PENDING', submitted, waiter.id], ['PREPARING', started, staff], ['READY', ready, staff], ['DELIVERED', delivered, waiter.id]);
          }
          const itemId = Number(
            q.run(
              `INSERT INTO order_items (order_id, batch_id, menu_item_id, station_id, category_id, item_name, unit_price, quantity, status, created_by,
                                        submitted_at, started_at, ready_at, delivered_at, cancelled_at, cancelled_by, cancel_reason, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              orderId,
              batchId,
              m.id,
              m.station_id,
              m.category_id,
              m.name,
              m.price,
              qty,
              status,
              waiter.id,
              iso(submitted),
              started ? iso(started) : null,
              ready ? iso(ready) : null,
              delivered ? iso(delivered) : null,
              cancelled ? iso(cancelled) : null,
              cancelled ? waiter.id : null,
              cancelled ? (cancelledOrder ? 'مهمان‌ها رفتند' : 'مشتری منصرف شد') : null,
              iso(delivered ?? cancelled),
            ).lastInsertRowid,
          );
          let prev = null;
          for (const [to, at, by] of history) {
            q.run('INSERT INTO order_item_status_history (order_item_id, from_status, to_status, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)', itemId, prev, to, by, iso(at));
            prev = to;
          }
          if (status !== 'CANCELLED') subtotal += qty * m.price;
          if (delivered) lastDelivered = Math.max(lastDelivered, delivered);
        }
      }

      if (cancelledOrder) {
        const at = opened + between(5, 12) * MIN;
        q.run(
          `UPDATE orders SET lifecycle = 'CANCELLED', status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = 'مهمان‌ها رفتند', released_at = ?, updated_at = ? WHERE id = ?`,
          iso(at),
          waiter.id,
          iso(at),
          iso(at),
          orderId,
        );
        if (table) tableFreeAt.set(table.id, at);
      } else {
        const completed = lastDelivered + between(15, 45) * MIN;
        // Settled at the register a few minutes before the order was closed: mostly card,
        // some cash (handed over rounded up, with change), occasionally split card + cash.
        const paidAt = completed - between(1, 6) * MIN;
        const pay = (method, amount, k) => {
          const received = method === 'CASH' ? (rng() < 0.5 ? amount : Math.ceil(amount / 50000) * 50000) : null;
          q.run(
            `INSERT INTO payments (restaurant_id, order_id, method, amount, received_amount, reference, client_request_id, business_date, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
            restaurant.id,
            orderId,
            method,
            amount,
            received,
            `seed-pay-${orderId}-${k}`,
            businessDate(restaurant, new Date(paidAt)),
            cashierUser.id,
            iso(paidAt + k * 20_000),
          );
        };
        if (subtotal > 0) {
          const r = rng();
          if (r < 0.12 && subtotal >= 200000) {
            const cardPart = Math.round((subtotal * between(0.4, 0.7)) / 10000) * 10000;
            pay('CARD', cardPart, 1);
            pay('CASH', subtotal - cardPart, 2);
          } else {
            pay(r < 0.45 ? 'CASH' : r < 0.96 ? 'CARD' : 'OTHER', subtotal, 1);
          }
        }
        q.run(
          `UPDATE orders SET lifecycle = 'COMPLETED', status = 'COMPLETED', subtotal = ?, paid_amount = ?, payment_status = 'PAID',
                  completed_at = ?, completed_by = ?, released_at = ?, receipt_print_count = 1, updated_at = ? WHERE id = ?`,
          subtotal,
          subtotal,
          iso(completed),
          waiter.id,
          iso(completed + 5 * MIN),
          iso(completed),
          orderId,
        );
        if (table) tableFreeAt.set(table.id, completed + 5 * MIN);
      }
    }
    q.run('UPDATE restaurants SET order_seq = ? WHERE id = ?', orderNumber, restaurant.id);
  });
  return plans.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  try {
    if (args.has('--reset')) removeDatabaseFiles();
    if (args.has('--minimal')) {
      seedMinimal();
      console.log('Database initialised with one manager account.');
    } else {
      seedDemo();
      console.log('Demo data created (restaurant, 10 tables, 8 categories, 33 menu items, 6 users).');
      if (args.has('--history')) console.log(`Order history generated: ${seedHistory()} orders over 30 days.`);
    }
    console.log(`Database: ${config.dbFile}`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
