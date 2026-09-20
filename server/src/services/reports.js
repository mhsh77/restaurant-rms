/**
 * Management reports. Sales = total of COMPLETED orders, grouped by business date.
 * Preparation performance uses item timestamps: queue = submitted→started,
 * cook = started→ready, total = submitted→ready. Auto-ready stations are excluded.
 */
import { q } from '../db/connection.js';
import { getRestaurant } from './restaurant.js';
import { addDays, daysBetween, resolveRange, businessDayStartUtc, toJalaliString } from './time.js';
import { toMajor } from './money.js';
import { latinDigits } from '../http/validate.js';
import { ORDER_STATUS_FA, PAYMENT_METHOD_FA } from './labels.js';

const SECONDS = (a, b) => `((julianday(${a}) - julianday(${b})) * 86400.0)`;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

const round = (n, d = 1) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);

export function totals(rid, from, to) {
  const t = q.get(
    `SELECT COALESCE(SUM(CASE WHEN lifecycle = 'COMPLETED' THEN subtotal END), 0) AS sales,
            COALESCE(SUM(lifecycle = 'COMPLETED'), 0) AS completed,
            COALESCE(SUM(lifecycle = 'CANCELLED'), 0) AS cancelled,
            COALESCE(SUM(lifecycle = 'ACTIVE'), 0) AS active,
            COALESCE(SUM(CASE WHEN lifecycle = 'ACTIVE' THEN subtotal END), 0) AS open_value,
            COALESCE(SUM(CASE WHEN lifecycle = 'COMPLETED' THEN guest_count END), 0) AS guests,
            AVG(CASE WHEN lifecycle = 'COMPLETED' THEN ${SECONDS('completed_at', 'opened_at')} END) AS avg_table_seconds
       FROM orders WHERE restaurant_id = ? AND business_date BETWEEN ? AND ?`,
    rid,
    from,
    to,
  );
  return {
    sales: t.sales,
    completedOrders: t.completed,
    cancelledOrders: t.cancelled,
    activeOrders: t.active,
    totalOrders: t.completed + t.cancelled + t.active,
    openOrdersValue: t.open_value,
    guests: t.guests,
    averageOrderValue: t.completed ? Math.round(t.sales / t.completed) : 0,
    averagePerGuest: t.guests ? Math.round(t.sales / t.guests) : 0,
    averageTableMinutes: round(t.avg_table_seconds / 60),
  };
}

function daily(rid, from, to) {
  const rows = q.all(
    `SELECT business_date AS date,
            COALESCE(SUM(CASE WHEN lifecycle = 'COMPLETED' THEN subtotal END), 0) AS sales,
            COALESCE(SUM(lifecycle = 'COMPLETED'), 0) AS orders,
            COALESCE(SUM(lifecycle = 'CANCELLED'), 0) AS cancelled,
            COALESCE(SUM(CASE WHEN lifecycle = 'COMPLETED' THEN guest_count END), 0) AS guests
       FROM orders WHERE restaurant_id = ? AND business_date BETWEEN ? AND ?
      GROUP BY business_date`,
    rid,
    from,
    to,
  );
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const series = [];
  const n = daysBetween(from, to);
  for (let i = 0; i <= n; i++) {
    const date = addDays(from, i);
    const r = byDate.get(date);
    series.push({
      date,
      sales: r?.sales ?? 0,
      orders: r?.orders ?? 0,
      cancelled: r?.cancelled ?? 0,
      guests: r?.guests ?? 0,
      averageOrderValue: r?.orders ? Math.round(r.sales / r.orders) : 0,
    });
  }
  return series;
}

function items(rid, from, to) {
  const rows = q.all(
    `SELECT mi.id, mi.name, mi.is_active, mi.deleted_at, c.name AS category,
            COALESCE(s.qty, 0) AS quantity, COALESCE(s.revenue, 0) AS revenue, COALESCE(s.orders, 0) AS orders
       FROM menu_items mi
       JOIN menu_categories c ON c.id = mi.category_id
       LEFT JOIN (
            SELECT oi.menu_item_id, SUM(oi.quantity) AS qty, SUM(oi.quantity * oi.unit_price) AS revenue, COUNT(DISTINCT oi.order_id) AS orders
              FROM order_items oi JOIN orders o ON o.id = oi.order_id
             WHERE o.restaurant_id = ? AND o.lifecycle = 'COMPLETED' AND o.business_date BETWEEN ? AND ? AND oi.status != 'CANCELLED'
             GROUP BY oi.menu_item_id) s ON s.menu_item_id = mi.id
      WHERE mi.restaurant_id = ? AND (mi.deleted_at IS NULL OR s.qty > 0)`,
    rid,
    from,
    to,
    rid,
  );
  const all = rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    quantity: r.quantity,
    revenue: r.revenue,
    orders: r.orders,
    isActive: !!r.is_active && !r.deleted_at,
  }));
  const top = [...all].filter((i) => i.quantity > 0).sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 10);
  // Least sold considers everything currently on the menu, including items that sold nothing.
  const bottom = [...all].filter((i) => i.isActive).sort((a, b) => a.quantity - b.quantity || a.revenue - b.revenue).slice(0, 10);
  return { all: [...all].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)), top, bottom };
}

function categories(rid, from, to) {
  const rows = q.all(
    `SELECT c.id, c.name, SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.unit_price) AS revenue
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN menu_categories c ON c.id = oi.category_id
      WHERE o.restaurant_id = ? AND o.lifecycle = 'COMPLETED' AND o.business_date BETWEEN ? AND ? AND oi.status != 'CANCELLED'
      GROUP BY c.id ORDER BY revenue DESC`,
    rid,
    from,
    to,
  );
  const total = rows.reduce((s, r) => s + r.revenue, 0);
  return rows.map((r) => ({ id: r.id, name: r.name, quantity: r.quantity, revenue: r.revenue, share: total ? round((r.revenue / total) * 100) : 0 }));
}

function waiters(rid, from, to) {
  const rows = q.all(
    `SELECT u.id, u.name, u.is_active,
            COALESCE(SUM(o.lifecycle = 'COMPLETED'), 0) AS orders,
            COALESCE(SUM(o.lifecycle = 'CANCELLED'), 0) AS cancelled,
            COALESCE(SUM(o.lifecycle = 'ACTIVE'), 0) AS active,
            COALESCE(SUM(CASE WHEN o.lifecycle = 'COMPLETED' THEN o.subtotal END), 0) AS sales,
            COALESCE(SUM(CASE WHEN o.lifecycle = 'COMPLETED' THEN o.guest_count END), 0) AS guests,
            AVG(CASE WHEN o.lifecycle = 'COMPLETED' THEN ${SECONDS('o.completed_at', 'o.opened_at')} END) AS avg_table_seconds
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN orders o ON o.waiter_id = u.id AND o.business_date BETWEEN ? AND ?
      WHERE u.restaurant_id = ? AND (r.code = 'WAITER' OR o.id IS NOT NULL)
      GROUP BY u.id
      ORDER BY sales DESC, u.name`,
    from,
    to,
    rid,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    orders: r.orders,
    cancelled: r.cancelled,
    active: r.active,
    sales: r.sales,
    guests: r.guests,
    averageOrderValue: r.orders ? Math.round(r.sales / r.orders) : 0,
    averageTableMinutes: round(r.avg_table_seconds / 60),
  }));
}

function stations(rid, from, to) {
  const list = q.all('SELECT id, name, code, auto_ready FROM stations WHERE restaurant_id = ? ORDER BY sort_order, id', rid);
  const rows = q.all(
    `SELECT oi.station_id, oi.item_name, oi.quantity,
            ${SECONDS('oi.started_at', 'oi.submitted_at')} AS queue_s,
            ${SECONDS('oi.ready_at', 'oi.started_at')} AS cook_s,
            ${SECONDS('oi.ready_at', 'oi.submitted_at')} AS total_s
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.restaurant_id = ? AND o.business_date BETWEEN ? AND ?
        AND oi.started_at IS NOT NULL AND oi.ready_at IS NOT NULL`,
    rid,
    from,
    to,
  );
  const pendingNow = q.all(
    `SELECT oi.station_id, oi.status, COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.restaurant_id = ? AND o.lifecycle = 'ACTIVE' AND oi.status IN ('PENDING','PREPARING','READY')
      GROUP BY oi.station_id, oi.status`,
    rid,
  );

  return list
    .filter((s) => !s.auto_ready)
    .map((s) => {
      const mine = rows.filter((r) => r.station_id === s.id);
      const avg = (k) => (mine.length ? mine.reduce((sum, r) => sum + r[k], 0) / mine.length : null);
      const totalsSorted = mine.map((r) => r.total_s).sort((a, b) => a - b);
      const byItem = new Map();
      for (const r of mine) {
        const e = byItem.get(r.item_name) ?? { name: r.item_name, count: 0, sum: 0 };
        e.count++;
        e.sum += r.total_s;
        byItem.set(r.item_name, e);
      }
      const live = Object.fromEntries(['PENDING', 'PREPARING', 'READY'].map((st) => [st, pendingNow.find((p) => p.station_id === s.id && p.status === st)?.n ?? 0]));
      return {
        id: s.id,
        name: s.name,
        code: s.code,
        itemsPrepared: mine.length,
        quantityPrepared: mine.reduce((sum, r) => sum + r.quantity, 0),
        averageQueueMinutes: round(avg('queue_s') / 60),
        averageCookMinutes: round(avg('cook_s') / 60),
        averageTotalMinutes: round(avg('total_s') / 60),
        p90TotalMinutes: round(percentile(totalsSorted, 0.9) / 60),
        slowestItems: [...byItem.values()]
          .map((e) => ({ name: e.name, count: e.count, averageTotalMinutes: round(e.sum / e.count / 60) }))
          .sort((a, b) => b.averageTotalMinutes - a.averageTotalMinutes)
          .slice(0, 5),
        live,
      };
    });
}

const PAYMENT_METHODS = ['CASH', 'CARD', 'OTHER'];

/** Money actually collected (valid payments) in a business-date range, by method. */
export function paymentTotals(rid, from, to) {
  const rows = q.all(
    `SELECT method, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
       FROM payments WHERE restaurant_id = ? AND business_date BETWEEN ? AND ? AND voided_at IS NULL
      GROUP BY method`,
    rid,
    from,
    to,
  );
  const voided = q.get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amount
       FROM payments WHERE restaurant_id = ? AND business_date BETWEEN ? AND ? AND voided_at IS NOT NULL`,
    rid,
    from,
    to,
  );
  const changeGiven = q.get(
    `SELECT COALESCE(SUM(received_amount - amount), 0) AS n
       FROM payments WHERE restaurant_id = ? AND business_date BETWEEN ? AND ? AND voided_at IS NULL AND received_amount IS NOT NULL`,
    rid,
    from,
    to,
  ).n;
  const byMethod = PAYMENT_METHODS.map((method) => {
    const r = rows.find((x) => x.method === method);
    return { method, count: r?.count ?? 0, amount: r?.amount ?? 0 };
  });
  return {
    collected: byMethod.reduce((s, m) => s + m.amount, 0),
    paymentCount: byMethod.reduce((s, m) => s + m.count, 0),
    byMethod,
    changeGiven,
    voided: { count: voided.n, amount: voided.amount },
  };
}

/** Completed orders in the range that were not (fully) paid. */
function unpaidCompleted(rid, from, to) {
  const r = q.get(
    `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal - paid_amount), 0) AS amount
       FROM orders WHERE restaurant_id = ? AND lifecycle = 'COMPLETED' AND business_date BETWEEN ? AND ? AND paid_amount < subtotal`,
    rid,
    from,
    to,
  );
  return { count: r.n, amount: r.amount };
}

function hourly(restaurant, from, to) {
  const rows = q.all(
    `SELECT opened_at, subtotal FROM orders WHERE restaurant_id = ? AND lifecycle = 'COMPLETED' AND business_date BETWEEN ? AND ?`,
    restaurant.id,
    from,
    to,
  );
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: restaurant.timezone, hour: '2-digit', hourCycle: 'h23' });
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, sales: 0 }));
  for (const r of rows) {
    const h = Number(fmt.format(new Date(r.opened_at))) % 24;
    buckets[h].orders++;
    buckets[h].sales += r.subtotal;
  }
  return buckets;
}

export function summary(actor, rangeInput) {
  const restaurant = getRestaurant(actor.restaurantId);
  const range = resolveRange(restaurant, rangeInput);
  const rid = restaurant.id;
  return {
    range: { ...range, days: daysBetween(range.from, range.to) + 1 },
    totals: totals(rid, range.from, range.to),
    daily: daily(rid, range.from, range.to),
    hourly: hourly(restaurant, range.from, range.to),
    items: items(rid, range.from, range.to),
    categories: categories(rid, range.from, range.to),
    waiters: waiters(rid, range.from, range.to),
    stations: stations(rid, range.from, range.to),
    payments: paymentTotals(rid, range.from, range.to),
    unpaid: unpaidCompleted(rid, range.from, range.to),
  };
}

export function dashboard(actor) {
  const restaurant = getRestaurant(actor.restaurantId);
  const today = resolveRange(restaurant, { range: 'today' });
  const rid = restaurant.id;
  const floor = q.get(
    `SELECT COUNT(*) AS tables,
            COALESCE(SUM(o.id IS NOT NULL AND o.lifecycle = 'ACTIVE'), 0) AS active,
            COALESCE(SUM(o.id IS NOT NULL AND o.lifecycle = 'COMPLETED'), 0) AS awaiting_release,
            COALESCE(SUM(CASE WHEN o.lifecycle = 'ACTIVE' THEN o.guest_count END), 0) AS guests_seated
       FROM dining_tables t LEFT JOIN orders o ON o.table_id = t.id AND o.released_at IS NULL
      WHERE t.restaurant_id = ? AND t.is_active = 1`,
    rid,
  );
  const itemRows = items(rid, today.from, today.to);
  return {
    businessDate: today.from,
    totals: totals(rid, today.from, today.to),
    floor: { tables: floor.tables, activeTables: floor.active, awaitingRelease: floor.awaiting_release, guestsSeated: floor.guests_seated },
    topItems: itemRows.top.slice(0, 5),
    categories: categories(rid, today.from, today.to),
    waiters: waiters(rid, today.from, today.to),
    stations: stations(rid, today.from, today.to),
    hourly: hourly(restaurant, today.from, today.to),
    payments: paymentTotals(rid, today.from, today.to),
    unpaid: unpaidCompleted(rid, today.from, today.to),
  };
}

/* ───────────────────────────── CSV export ───────────────────────────── */

function csv(rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    // Neutralise spreadsheet formula injection and quote when needed.
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export const EXPORT_TYPES = ['daily', 'items', 'categories', 'waiters', 'stations', 'orders', 'payments'];

export function exportCsv(actor, type, rangeInput) {
  const restaurant = getRestaurant(actor.restaurantId);
  const range = resolveRange(restaurant, rangeInput);
  const { from, to } = range;
  const rid = restaurant.id;
  const money = (m) => toMajor(restaurant, m);
  const cur = restaurant.currency_code;
  let rows;

  switch (type) {
    case 'daily':
      rows = [['تاریخ شمسی', 'تاریخ میلادی', 'سفارش‌های تکمیل‌شده', 'سفارش‌های لغوشده', 'مهمان', `فروش (${cur})`, `میانگین سفارش (${cur})`]];
      for (const d of daily(rid, from, to)) rows.push([toJalaliString(d.date), d.date, d.orders, d.cancelled, d.guests, money(d.sales), money(d.averageOrderValue)]);
      break;
    case 'items':
      rows = [['آیتم', 'دسته‌بندی', 'تعداد فروش', 'تعداد سفارش', `درآمد (${cur})`, 'در منو']];
      for (const i of items(rid, from, to).all) rows.push([i.name, i.category, i.quantity, i.orders, money(i.revenue), i.isActive ? 'بله' : 'خیر']);
      break;
    case 'categories':
      rows = [['دسته‌بندی', 'تعداد فروش', `درآمد (${cur})`, 'سهم (درصد)']];
      for (const c of categories(rid, from, to)) rows.push([c.name, c.quantity, money(c.revenue), c.share]);
      break;
    case 'waiters':
      rows = [['گارسون', 'سفارش‌های تکمیل‌شده', 'سفارش‌های لغوشده', 'مهمان', `فروش (${cur})`, `میانگین سفارش (${cur})`, 'میانگین زمان میز (دقیقه)']];
      for (const w of waiters(rid, from, to)) rows.push([w.name, w.orders, w.cancelled, w.guests, money(w.sales), money(w.averageOrderValue), w.averageTableMinutes ?? '']);
      break;
    case 'stations':
      rows = [['ایستگاه', 'اقلام آماده‌شده', 'تعداد', 'میانگین انتظار تا شروع (دقیقه)', 'میانگین آماده‌سازی (دقیقه)', 'میانگین کل (دقیقه)', 'صدک ۹۰ کل (دقیقه)']];
      for (const s of stations(rid, from, to)) rows.push([s.name, s.itemsPrepared, s.quantityPrepared, s.averageQueueMinutes ?? '', s.averageCookMinutes ?? '', s.averageTotalMinutes ?? '', s.p90TotalMinutes ?? '']);
      break;
    case 'orders': {
      const fmt = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { timeZone: restaurant.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      const local = (iso) => (iso ? fmt.format(new Date(iso)) : '');
      rows = [['شماره سفارش', 'تاریخ کاری (شمسی)', 'زمان ثبت', 'زمان تکمیل', 'میز', 'گارسون', 'مهمان', 'وضعیت', 'تعداد اقلام', `مبلغ (${cur})`]];
      const list = q.all(
        `SELECT o.order_number, o.business_date, o.opened_at, o.completed_at, t.name AS table_name, w.name AS waiter_name, o.guest_count, o.status, o.subtotal,
                (SELECT COALESCE(SUM(quantity), 0) FROM order_items oi WHERE oi.order_id = o.id AND oi.status != 'CANCELLED') AS item_count
           FROM orders o JOIN dining_tables t ON t.id = o.table_id JOIN users w ON w.id = o.waiter_id
          WHERE o.restaurant_id = ? AND o.business_date BETWEEN ? AND ? ORDER BY o.order_number`,
        rid,
        from,
        to,
      );
      for (const o of list) {
        rows.push([o.order_number, toJalaliString(o.business_date), local(o.opened_at), local(o.completed_at), o.table_name, o.waiter_name, o.guest_count, ORDER_STATUS_FA[o.status] ?? o.status, o.item_count, money(o.subtotal)]);
      }
      break;
    }
    case 'payments': {
      const fmt = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { timeZone: restaurant.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
      rows = [['تاریخ کاری (شمسی)', 'ساعت', 'شماره سفارش', 'میز', 'روش پرداخت', `مبلغ (${cur})`, `دریافتی نقدی (${cur})`, `باقی (${cur})`, 'شماره پیگیری', 'ثبت‌کننده', 'وضعیت', 'دلیل ابطال']];
      const list = q.all(
        `SELECT p.*, o.order_number, t.name AS table_name, u.name AS user_name
           FROM payments p
           JOIN orders o ON o.id = p.order_id
           JOIN dining_tables t ON t.id = o.table_id
           JOIN users u ON u.id = p.created_by
          WHERE p.restaurant_id = ? AND p.business_date BETWEEN ? AND ?
          ORDER BY p.created_at, p.id`,
        rid,
        from,
        to,
      );
      for (const p of list) {
        const hasCash = p.received_amount !== null;
        rows.push([
          toJalaliString(p.business_date),
          fmt.format(new Date(p.created_at)),
          p.order_number,
          p.table_name,
          PAYMENT_METHOD_FA[p.method],
          money(p.amount),
          hasCash ? money(p.received_amount) : '',
          hasCash ? money(p.received_amount - p.amount) : '',
          p.reference,
          p.user_name,
          p.voided_at ? 'باطل‌شده' : 'معتبر',
          p.void_reason ?? '',
        ]);
      }
      break;
    }
    default:
      throw new Error(`unknown export type ${type}`);
  }
  return { filename: `${type}_${from}_${to}.csv`, content: csv(rows) };
}

/* ───────────────────────────── audit log ───────────────────────────── */

export function listAuditLogs(actor, filters) {
  const restaurant = getRestaurant(actor.restaurantId);
  const where = ['a.restaurant_id = ?'];
  const params = [restaurant.id];
  if (filters.userId) where.push('a.user_id = ?'), params.push(filters.userId);
  if (filters.entityType) where.push('a.entity_type = ?'), params.push(filters.entityType);
  if (filters.action) where.push('a.action = ?'), params.push(filters.action);
  // Summaries store order numbers with Latin digits and table names with Persian digits: match either spelling.
  if (filters.q) where.push('(a.summary LIKE ? OR a.summary LIKE ?)'), params.push(`%${filters.q}%`, `%${latinDigits(filters.q)}%`);
  if (filters.from) where.push('a.created_at >= ?'), params.push(businessDayStartUtc(restaurant, filters.from).toISOString());
  if (filters.to) where.push('a.created_at < ?'), params.push(businessDayStartUtc(restaurant, addDays(filters.to, 1)).toISOString());

  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const base = `FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE ${where.join(' AND ')}`;
  const total = q.get(`SELECT COUNT(*) AS n ${base}`, ...params).n;
  const rows = q.all(
    `SELECT a.*, u.name AS user_name, u.username ${base} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize,
  );
  const actions = q.all('SELECT DISTINCT action FROM audit_logs WHERE restaurant_id = ? ORDER BY action', restaurant.id).map((r) => r.action);
  return {
    page,
    pageSize,
    total,
    actions,
    logs: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      summary: r.summary,
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
      user: r.user_id ? { id: r.user_id, name: r.user_name, username: r.username } : null,
      ip: r.ip,
      createdAt: r.created_at,
    })),
  };
}
