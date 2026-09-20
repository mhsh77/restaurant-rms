import { useState } from 'react';
import { Pencil, Plus, Table2, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAction, useLiveQuery } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';
import { faNumber, orderNo } from '../../lib/format.js';
import { ConfirmDialog, Empty, ErrorBlock, Field, LoadingBlock, Modal, PageHeader, StatusBadge } from '../../components/ui.jsx';

export default function TablesAdmin() {
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const q = useLiveQuery(() => api.get('/tables'), [], { events: ['tables:changed', 'orders:changed'], intervalMs: 0 });

  if (q.loading && !q.data) return <LoadingBlock />;
  if (q.error && !q.data) return <ErrorBlock error={q.error} onRetry={q.reload} />;
  const tables = q.data;

  return (
    <div className="page">
      <PageHeader
        title="مدیریت میزها"
        subtitle={`${faNumber(tables.length)} میز · ${faNumber(tables.reduce((n, t) => n + t.capacity, 0))} صندلی`}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus size={18} /> افزودن میز
          </button>
        }
      />
      {tables.length === 0 ? (
        <Empty icon={Table2} title="هنوز میزی تعریف نشده">میزهای سالن را اضافه کنید.</Empty>
      ) : (
        <div className="card table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>نام</th>
                <th>بخش</th>
                <th className="num">ظرفیت</th>
                <th className="num">ترتیب</th>
                <th>وضعیت فعلی</th>
                <th aria-label="عملیات" />
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.id}>
                  <td>
                    <b>{t.name}</b>
                  </td>
                  <td>{t.area || <span className="muted">—</span>}</td>
                  <td className="num">{faNumber(t.capacity)}</td>
                  <td className="num">{faNumber(t.sortOrder)}</td>
                  <td>
                    <StatusBadge kind="table" status={t.status} />
                    {t.order && <span className="muted small"> {orderNo(t.order.orderNumber)}</span>}
                  </td>
                  <td className="row-actions">
                    <button type="button" className="icon-btn" onClick={() => setEditing(t)} aria-label={`ویرایش ${t.name}`}>
                      <Pencil size={18} />
                    </button>
                    <button type="button" className="icon-btn danger" onClick={() => setDeleting(t)} disabled={!!t.order} title={t.order ? 'این میز سفارش باز دارد' : 'حذف'} aria-label={`حذف ${t.name}`}>
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <TableEditor table={editing} onClose={() => setEditing(null)} onSaved={q.reload} />}
      <ConfirmDialog
        open={!!deleting}
        danger
        busy={busy}
        title="حذف میز"
        confirmLabel="حذف"
        message={`${deleting?.name} حذف شود؟ میزهایی که سابقه سفارش دارند بایگانی می‌شوند تا سوابق حفظ شود.`}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          run(async () => {
            await api.del(`/tables/${deleting.id}`);
            setDeleting(null);
            await q.reload();
          }, { success: `${deleting.name} حذف شد` })
        }
      />
    </div>
  );
}

function TableEditor({ table, onClose, onSaved }) {
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const isNew = !table.id;
  const [form, setForm] = useState({ name: table.name ?? '', capacity: table.capacity ?? 4, area: table.area ?? '', sortOrder: table.sortOrder ?? '' });

  const save = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('نام میز الزامی است');
    const body = { name: form.name.trim(), capacity: Number(form.capacity), area: form.area.trim(), ...(form.sortOrder !== '' ? { sortOrder: Number(form.sortOrder) } : {}) };
    return run(async () => {
      if (isNew) await api.post('/tables', body);
      else await api.put(`/tables/${table.id}`, body);
      await onSaved();
      onClose();
    }, { success: `${body.name} ذخیره شد` });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'افزودن میز' : `ویرایش ${table.name}`}
      size="sm"
      footer={
        <button type="submit" form="table-form" className="btn btn-primary" disabled={busy}>
          ذخیره
        </button>
      }
    >
      <form id="table-form" className="form-grid" onSubmit={save}>
        <Field label="نام / شماره میز">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} placeholder="میز ۱۱" autoFocus />
        </Field>
        <Field label="ظرفیت (نفر)">
          <input type="number" min={1} max={100} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} required />
        </Field>
        <Field label="بخش" hint="اختیاری، مثلاً تراس">
          <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} maxLength={40} />
        </Field>
        <Field label="ترتیب نمایش">
          <input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
        </Field>
      </form>
    </Modal>
  );
}
