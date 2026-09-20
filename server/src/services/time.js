/**
 * Business-day arithmetic. Reports group by the restaurant's *business date*: the local
 * calendar date in the restaurant's timezone, shifted back by day_start_hour so that
 * orders after midnight still belong to the evening's service.
 */
import { badRequest } from '../http/errors.js';

const DAY_MS = 86_400_000;

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD business date for an instant. */
export function businessDate(restaurant, instant = new Date()) {
  const shifted = new Date(instant.getTime() - restaurant.day_start_hour * 3_600_000);
  const p = localParts(shifted, restaurant.timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(from, to) {
  const toUtc = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** UTC instant at which a business date starts (local date at day_start_hour). */
export function businessDayStartUtc(restaurant, dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, restaurant.day_start_hour);
  // Iterate twice: the offset at the guessed instant may differ across a DST change.
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), restaurant.timezone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += target - asUtc;
  }
  return new Date(guess);
}

export const RANGE_PRESETS = ['today', 'yesterday', 'week', 'month', 'custom'];

const persianDayFormatter = new Intl.DateTimeFormat('en-u-ca-persian', { timeZone: 'UTC', day: 'numeric' });

function utcDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Gregorian business date → Jalali "1405/06/24" (Latin digits, for CSV). */
const jalaliPartsFormatter = new Intl.DateTimeFormat('en-u-ca-persian-nu-latn', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });

export function toJalaliString(dateStr) {
  // Pick parts by type: the formatter's own order is month/day/year.
  const parts = Object.fromEntries(jalaliPartsFormatter.formatToParts(utcDate(dateStr)).map((p) => [p.type, p.value]));
  return `${parts.year}/${parts.month}/${parts.day}`;
}

/** Resolve a report range preset into inclusive business dates. */
export function resolveRange(restaurant, { range = 'today', from, to } = {}) {
  const today = businessDate(restaurant);
  switch (range) {
    case 'today':
      return { range, from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { range, from: y, to: y };
    }
    case 'week': {
      const back = (dayOfWeek(today) - restaurant.week_start_day + 7) % 7;
      return { range, from: addDays(today, -back), to: today };
    }
    case 'month': {
      // "This month" follows the Persian (Jalali) calendar: from the 1st of the current solar month.
      const dayOfPersianMonth = Number(persianDayFormatter.format(utcDate(today)));
      return { range, from: addDays(today, -(dayOfPersianMonth - 1)), to: today };
    }
    case 'custom': {
      if (!from || !to) throw badRequest('برای بازه دلخواه، تاریخ شروع و پایان لازم است');
      if (from > to) throw badRequest('تاریخ شروع نباید بعد از تاریخ پایان باشد');
      if (daysBetween(from, to) > 366 * 3) throw badRequest('بازه گزارش حداکثر سه سال است');
      return { range, from, to };
    }
    default:
      throw badRequest('بازه زمانی نامعتبر است');
  }
}
