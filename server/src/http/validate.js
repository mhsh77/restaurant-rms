import { z } from 'zod';
import { badRequest } from './errors.js';

/** Parse a positive integer route parameter or throw 400. */
export function idParam(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw badRequest('شناسه نامعتبر است');
  return n;
}

/** Convert Persian/Arabic digits to Latin so "۱۰۴۸" and "1048" behave the same. */
export function latinDigits(value) {
  return String(value)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * SQL for "any of these columns contains the text", tolerant of digit style: names are
 * stored as typed (e.g. «میز ۵») while clients may send Latin digits, so both forms match.
 */
export function containsAny(columns, value) {
  const text = String(value).trim();
  const latin = latinDigits(text);
  const persian = latin.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
  const variants = [...new Set([text, latin, persian])];
  const clauses = variants.flatMap(() => columns.map((c) => `${c} LIKE ?`));
  return { sql: `(${clauses.join(' OR ')})`, params: variants.flatMap((v) => columns.map(() => `%${v}%`)) };
}

export const zText = (max) => z.string().trim().max(max);
export const zName = (max = 80) => z.string().trim().min(1, 'الزامی است').max(max);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ باید به قالب YYYY-MM-DD باشد');
