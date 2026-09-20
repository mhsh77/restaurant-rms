import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useAction, useLiveQuery } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';
import { ROLE_LABEL, faDigits } from '../../lib/format.js';
import { ErrorBlock, Field, LoadingBlock, Modal, PageHeader, Toggle } from '../../components/ui.jsx';

// Index = JavaScript day number (0 = Sunday).
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const TIMEZONES = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

export default function SettingsPage() {
  const { refresh } = useAuth();
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const q = useLiveQuery(() => api.get('/restaurant'), [], { events: ['settings:changed'], intervalMs: 0 });
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);

  if (q.loading && !q.data) return <LoadingBlock />;
  if (q.error && !q.data) return <ErrorBlock error={q.error} onRetry={q.reload} />;
  if (!form) return null;

  const set = (k, numeric = false) => (e) => setForm({ ...form, [k]: numeric ? Number(e.target.value) : e.target.value });

  const save = (e) => {
    e.preventDefault();
    const { id, ...body } = form;
    return run(async () => {
      const saved = await api.put('/restaurant', body);
      setForm(saved);
      await refresh();
    }, { success: 'تنظیمات ذخیره شد' });
  };

  return (
    <div className="page narrow">
      <PageHeader title="تنظیمات" />
      <form className="card form-grid two" onSubmit={save}>
        <h2 className="span-all">رستوران و فیش</h2>
        <Field label="نام رستوران">
          <input value={form.name} onChange={set('name')} maxLength={120} required />
        </Field>
        <Field label="تلفن">
          <input value={form.phone} onChange={set('phone')} maxLength={60} />
        </Field>
        <Field label="نشانی" className="span-all">
          <input value={form.address} onChange={set('address')} maxLength={240} />
        </Field>
        <Field label="متن پایین فیش" className="span-all">
          <input value={form.receiptFooter} onChange={set('receiptFooter')} maxLength={240} />
        </Field>

        <h2 className="span-all">واحد پول</h2>
        <Field label="نماد" hint="مثلاً تومان">
          <input value={form.currencySymbol} onChange={set('currencySymbol')} maxLength={8} required />
        </Field>
        <Field label="کد" hint="در خروجی CSV استفاده می‌شود (مثلاً IRT)">
          <input dir="ltr" value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value.toUpperCase() })} maxLength={3} pattern="[A-Z]{3}" required />
        </Field>
        <Field label="تعداد رقم اعشار" hint="فقط پیش از ثبت اولین سفارش قابل تغییر است">
          <select value={form.currencyDecimals} onChange={set('currencyDecimals', true)}>
            {[0, 1, 2, 3].map((d) => (
              <option key={d} value={d}>
                {faDigits(d)}
              </option>
            ))}
          </select>
        </Field>

        <h2 className="span-all">روز کاری</h2>
        <Field label="منطقه زمانی">
          <select dir="ltr" value={form.timezone} onChange={set('timezone')}>
            {(TIMEZONES.includes(form.timezone) ? TIMEZONES : [form.timezone, ...TIMEZONES]).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Field>
        <Field label="شروع روز کاری" hint="سفارش‌های پیش از این ساعت جزو روز قبل حساب می‌شوند">
          <select value={form.dayStartHour} onChange={set('dayStartHour', true)}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {faDigits(`${String(h).padStart(2, '0')}:00`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="شروع هفته">
          <select value={form.weekStartDay} onChange={set('weekStartDay', true)}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Field>

        <h2 className="span-all">نمایشگر آشپزخانه و بار</h2>
        <Field label="هشدار پس از (دقیقه)" hint="رنگ فیش نارنجی می‌شود">
          <input type="number" min={1} max={240} value={form.kdsWarnMinutes} onChange={set('kdsWarnMinutes', true)} />
        </Field>
        <Field label="تأخیر پس از (دقیقه)" hint="رنگ فیش قرمز می‌شود">
          <input type="number" min={2} max={480} value={form.kdsLateMinutes} onChange={set('kdsLateMinutes', true)} />
        </Field>

        <h2 className="span-all">صندوق</h2>
        <div className="span-all">
          <Toggle
            checked={!!form.requirePaymentToComplete}
            onChange={(v) => setForm({ ...form, requirePaymentToComplete: v })}
            label="تکمیل سفارش فقط پس از تسویه کامل صورتحساب در صندوق"
          />
          <p className="field-hint">اگر خاموش باشد، گارسون می‌تواند سفارش را پیش از پرداخت ببندد و صورتحساب در فهرست «در انتظار پرداخت» صندوق باقی می‌ماند.</p>
        </div>

        <div className="form-actions span-all">
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            ذخیره تنظیمات
          </button>
        </div>
      </form>

      <StationsSection />
    </div>
  );
}

function StationsSection() {
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  const q = useLiveQuery(() => api.get('/stations?all=1'), [], { events: ['menu:changed'], intervalMs: 0 });

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>محل‌های آماده‌سازی</h2>
          <p className="muted">هر آیتم منو به یک ایستگاه ارسال می‌شود. کارکنانِ نقشِ مسئول، نمایشگر آن ایستگاه را می‌بینند.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setEditing({})}>
          <Plus size={18} /> افزودن ایستگاه
        </button>
      </div>
      {q.error && <ErrorBlock error={q.error} onRetry={q.reload} />}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>ایستگاه</th>
              <th>کد</th>
              <th>مسئول</th>
              <th>آماده‌سازی</th>
              <th>فعال</th>
              <th aria-label="عملیات" />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((s) => (
              <tr key={s.id} className={!s.isActive ? 'is-dim' : ''}>
                <td>
                  <b>{s.name}</b>
                </td>
                <td>
                  <code dir="ltr">{s.code}</code>
                </td>
                <td>{s.roleCode ? ROLE_LABEL[s.roleCode] : <span className="muted">بدون نمایشگر</span>}</td>
                <td>{s.autoReady ? 'ندارد — بلافاصله آماده است' : 'در ایستگاه آماده می‌شود'}</td>
                <td>{s.isActive ? 'بله' : 'خیر'}</td>
                <td className="row-actions">
                  <button type="button" className="icon-btn" onClick={() => setEditing(s)} aria-label={`ویرایش ${s.name}`}>
                    <Pencil size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <StationEditor station={editing} onClose={() => setEditing(null)} onSaved={q.reload} toast={toast} />}
    </div>
  );
}

function StationEditor({ station, onClose, onSaved, toast }) {
  const [run, busy] = useAction(toast);
  const isNew = !station.id;
  const [form, setForm] = useState({
    code: station.code ?? '',
    name: station.name ?? '',
    roleCode: station.roleCode ?? '',
    autoReady: station.autoReady ?? false,
    isActive: station.isActive ?? true,
    sortOrder: station.sortOrder ?? 0,
  });

  const save = (e) => {
    e.preventDefault();
    const body = { name: form.name.trim(), roleCode: form.roleCode || null, autoReady: form.autoReady, sortOrder: Number(form.sortOrder) || 0 };
    return run(async () => {
      if (isNew) await api.post('/stations', { ...body, code: form.code.trim() });
      else await api.put(`/stations/${station.id}`, { ...body, isActive: form.isActive });
      await onSaved();
      onClose();
    }, { success: 'ایستگاه ذخیره شد' });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'افزودن ایستگاه' : `ویرایش ${station.name}`}
      size="sm"
      footer={
        <button type="submit" form="station-form" className="btn btn-primary" disabled={busy}>
          ذخیره
        </button>
      }
    >
      <form id="station-form" className="form-grid" onSubmit={save}>
        <Field label="نام">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} required autoFocus />
        </Field>
        {isNew && (
          <Field label="کد" hint="شناسه ثابت با حروف لاتین، مثلاً grill">
            <input dir="ltr" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })} pattern="[a-z0-9_\-]{2,30}" required />
          </Field>
        )}
        <Field label="نقش مسئول">
          <select value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
            <option value="">هیچ‌کس (بدون نمایشگر)</option>
            <option value="KITCHEN">آشپزخانه</option>
            <option value="BAR">بار</option>
          </select>
        </Field>
        <Field label="ترتیب نمایش">
          <input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
        </Field>
        <Toggle checked={form.autoReady} onChange={(v) => setForm({ ...form, autoReady: v })} label="بدون آماده‌سازی (اقلام بلافاصله آماده می‌شوند)" />
        {!isNew && <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="فعال" />}
      </form>
    </Modal>
  );
}
