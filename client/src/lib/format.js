/**
 * Persian formatting: Persian digits, Toman after the amount, Jalali (solar hijri) dates.
 * Intl's "fa-IR" locale uses the Persian calendar and Persian digits by default.
 */
const FA = 'fa-IR';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Latin digits → Persian digits (and "," between digits → Persian thousands separator). */
export function faDigits(value) {
  return String(value ?? '')
    .replace(/(\d),(?=\d)/g, '$1٬')
    .replace(/\d/g, (d) => FA_DIGITS[d]);
}

/** Persian/Arabic digits → Latin digits (for parsing user input). */
export function latinDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

const numberFormat = new Intl.NumberFormat(FA);
export const faNumber = (n) => numberFormat.format(n ?? 0);
export const orderNo = (n) => `#${faDigits(n)}`;

export function moneyFormatter(settings) {
  const d = settings?.currencyDecimals ?? 0;
  const symbol = settings?.currencySymbol ?? 'تومان';
  const nf = new Intl.NumberFormat(FA, { minimumFractionDigits: d, maximumFractionDigits: d });
  return (minor) => `${nf.format((minor ?? 0) / 10 ** d)} ${symbol}`;
}

/** "۱۲۰٬۰۰۰" or "120,000" → minor units. Returns null for invalid input. */
export function parseMoney(text, decimals) {
  const cleaned = latinDigits(text).replace(/[,٬\s]/g, '').replace('٫', '.').trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 10 ** decimals);
}

export function minorToInput(minor, decimals) {
  return (minor / 10 ** decimals).toFixed(decimals);
}

const cache = new Map();
function fmt(tz, options) {
  const key = `${tz}|${JSON.stringify(options)}`;
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat(FA, { timeZone: tz || undefined, ...options }));
  return cache.get(key);
}

export const formatTime = (iso, tz) => (iso ? fmt(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '');
export const formatDate = (iso, tz) => (iso ? fmt(tz, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '');
export const formatDateTime = (iso, tz) =>
  iso ? `${fmt(tz, { day: 'numeric', month: 'long' }).format(new Date(iso))}، ${formatTime(iso, tz)}` : '';

/** Business date "2026-09-15" (Gregorian, from the API) → Jalali text, without timezone shifts. */
export function formatBusinessDate(date, options = { day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(FA, { timeZone: 'UTC', ...options }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Milliseconds → "۰۸:۳۲" or "۱:۰۴:۱۰". */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return faDigits(h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`);
}

const minuteFormat = new Intl.NumberFormat(FA, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const formatMinutes = (min) => (min === null || min === undefined ? '—' : `${minuteFormat.format(min)} دقیقه`);

export const ITEM_STATUS_LABEL = {
  PENDING: 'در انتظار',
  PREPARING: 'در حال آماده‌سازی',
  READY: 'آماده',
  DELIVERED: 'تحویل‌شده',
  CANCELLED: 'لغوشده',
};

export const ORDER_STATUS_LABEL = {
  OPEN: 'باز',
  IN_PROGRESS: 'در حال انجام',
  PARTIALLY_READY: 'بخشی آماده',
  READY: 'آماده',
  DELIVERED: 'تحویل‌شده',
  COMPLETED: 'تکمیل‌شده',
  CANCELLED: 'لغوشده',
};

export const TABLE_STATUS_LABEL = {
  AVAILABLE: 'آزاد',
  WAITING_FOR_ORDER: 'در انتظار سفارش',
  ORDERING: 'در حال سفارش',
  PREPARING: 'در حال آماده‌سازی',
  READY: 'آماده سرو',
  OCCUPIED: 'اشغال',
  COMPLETED: 'تکمیل‌شده',
};

export const ROLE_LABEL = { MANAGER: 'مدیر', WAITER: 'گارسون', KITCHEN: 'آشپزخانه', BAR: 'بار', CASHIER: 'صندوقدار' };

export const SERVICE_MODE_LABEL = {
  TABLE: 'سر میز',
  COUNTER_TABLE: 'پیشخوان، سرو سر میز',
  COUNTER_PICKUP: 'بیرون‌بر',
};

/** Short badge text; a plain table order needs no badge at all. */
export const SERVICE_MODE_SHORT = { TABLE: '', COUNTER_TABLE: 'پیشخوان', COUNTER_PICKUP: 'بیرون‌بر' };

export const PAYMENT_METHOD_LABEL = { CASH: 'نقدی', CARD: 'کارت‌خوان', OTHER: 'سایر' };

export const PAYMENT_STATUS_LABEL = {
  UNPAID: 'پرداخت نشده',
  PARTIAL: 'بخشی پرداخت‌شده',
  PAID: 'تسویه‌شده',
  OVERPAID: 'اضافه پرداخت',
};
