import * as jalaali from 'jalaali-js';
import { X } from 'lucide-react';
import { faDigits } from '../lib/format.js';

const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const pad = (n) => String(n).padStart(2, '0');

function toJalali(value) {
  if (!value) return null;
  const [gy, gm, gd] = value.split('-').map(Number);
  return jalaali.toJalaali(gy, gm, gd);
}

function toGregorianString(jy, jm, jd) {
  const day = Math.min(jd, jalaali.jalaaliMonthLength(jy, jm));
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, day);
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}

/**
 * Jalali date picker (year / month / day selects). The value in and out is a Gregorian
 * "YYYY-MM-DD" string (what the API expects) or "" for no date.
 */
export default function JalaliDateInput({ value, onChange, label, required = false }) {
  const today = new Date();
  const now = jalaali.toJalaali(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const current = toJalali(value);
  const years = [];
  for (let y = now.jy + 1; y >= now.jy - 4; y--) years.push(y);

  const set = (part, v) => {
    const base = current ?? now;
    const next = { jy: base.jy, jm: base.jm, jd: base.jd, [part]: Number(v) };
    onChange(toGregorianString(next.jy, next.jm, next.jd));
  };

  const daysInMonth = current ? jalaali.jalaaliMonthLength(current.jy, current.jm) : 31;

  return (
    <div className="jdate" role="group" aria-label={label}>
      {label && <span className="jdate-label">{label}</span>}
      <select value={current?.jd ?? ''} onChange={(e) => set('jd', e.target.value)} aria-label={`${label ?? 'تاریخ'} — روز`} required={required}>
        {!current && <option value="">روز</option>}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {faDigits(d)}
          </option>
        ))}
      </select>
      <select value={current?.jm ?? ''} onChange={(e) => set('jm', e.target.value)} aria-label={`${label ?? 'تاریخ'} — ماه`} required={required}>
        {!current && <option value="">ماه</option>}
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select value={current?.jy ?? ''} onChange={(e) => set('jy', e.target.value)} aria-label={`${label ?? 'تاریخ'} — سال`} required={required}>
        {!current && <option value="">سال</option>}
        {years.map((y) => (
          <option key={y} value={y}>
            {faDigits(y)}
          </option>
        ))}
      </select>
      {current && !required && (
        <button type="button" className="icon-btn" onClick={() => onChange('')} aria-label="پاک کردن تاریخ">
          <X size={18} />
        </button>
      )}
    </div>
  );
}
