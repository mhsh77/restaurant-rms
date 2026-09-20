import { useState } from 'react';
import { Pencil, UserPlus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useAction, useLiveQuery } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';
import { ROLE_LABEL, faNumber, formatDateTime } from '../../lib/format.js';
import { ErrorBlock, Field, LoadingBlock, Modal, PageHeader, Toggle } from '../../components/ui.jsx';

export default function Staff() {
  const { user: me, restaurant } = useAuth();
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const [editing, setEditing] = useState(null);
  const [role, setRole] = useState('');
  const q = useLiveQuery(() => api.get('/users'), [], { intervalMs: 0 });

  if (q.loading && !q.data) return <LoadingBlock />;
  if (q.error && !q.data) return <ErrorBlock error={q.error} onRetry={q.reload} />;
  const users = q.data.filter((u) => !role || u.role.code === role);

  return (
    <div className="page">
      <PageHeader
        title="کارکنان"
        subtitle={`${faNumber(q.data.filter((u) => u.isActive).length)} حساب فعال`}
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>
            <UserPlus size={18} /> افزودن کارمند
          </button>
        }
      />
      <div className="chips">
        <button type="button" className={`chip ${!role ? 'is-active' : ''}`} onClick={() => setRole('')}>
          همه
        </button>
        {Object.entries(ROLE_LABEL).map(([code, label]) => (
          <button key={code} type="button" className={`chip ${role === code ? 'is-active' : ''}`} onClick={() => setRole(code)}>
            {label}
          </button>
        ))}
      </div>
      <div className="card table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>نام</th>
              <th>نام کاربری</th>
              <th>نقش</th>
              <th>آخرین ورود</th>
              <th>فعال</th>
              <th aria-label="عملیات" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={!u.isActive ? 'is-dim' : ''}>
                <td>
                  <b>{u.name}</b> {u.id === me.id && <span className="pill">شما</span>}
                </td>
                <td dir="ltr" className="align-start">
                  @{u.username}
                </td>
                <td>
                  <span className={`role-tag role-${u.role.code.toLowerCase()}`}>{ROLE_LABEL[u.role.code]}</span>
                </td>
                <td className="muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, restaurant?.timezone) : 'هرگز'}</td>
                <td>
                  <Toggle
                    checked={u.isActive}
                    disabled={busy || u.id === me.id}
                    onChange={(v) => run(async () => { await api.put(`/users/${u.id}`, { isActive: v }); await q.reload(); }, { success: `${u.name} ${v ? 'فعال' : 'غیرفعال'} شد` })}
                    label={<span className="sr-only">فعال</span>}
                  />
                </td>
                <td className="row-actions">
                  <button type="button" className="icon-btn" onClick={() => setEditing(u)} aria-label={`ویرایش ${u.name}`}>
                    <Pencil size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserEditor account={editing} isSelf={editing.id === me.id} onClose={() => setEditing(null)} onSaved={q.reload} />}
    </div>
  );
}

function UserEditor({ account, isSelf, onClose, onSaved }) {
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const isNew = !account.id;
  const [form, setForm] = useState({ name: account.name ?? '', username: account.username ?? '', roleCode: account.role?.code ?? 'WAITER', password: '', isActive: account.isActive ?? true });

  const save = (e) => {
    e.preventDefault();
    if (isNew && form.password.length < 8) return toast.error('رمز عبور باید حداقل ۸ کاراکتر باشد');
    if (!isNew && form.password && form.password.length < 8) return toast.error('رمز عبور جدید باید حداقل ۸ کاراکتر باشد');
    const body = { name: form.name.trim(), username: form.username.trim(), roleCode: form.roleCode, isActive: form.isActive };
    if (form.password) body.password = form.password;
    if (isSelf) {
      delete body.roleCode;
      delete body.isActive;
    }
    return run(async () => {
      if (isNew) await api.post('/users', body);
      else await api.put(`/users/${account.id}`, body);
      await onSaved();
      onClose();
    }, { success: `${body.name} ذخیره شد` });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'افزودن کارمند' : `ویرایش ${account.name}`}
      footer={
        <button type="submit" form="user-form" className="btn btn-primary" disabled={busy}>
          ذخیره
        </button>
      }
    >
      <form id="user-form" className="form-grid two" onSubmit={save} autoComplete="off">
        <Field label="نام و نام خانوادگی">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} required autoFocus />
        </Field>
        <Field label="نام کاربری" hint="حروف لاتین، عدد و . _ -">
          <input dir="ltr" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} maxLength={40} pattern="[a-zA-Z0-9._\-]{3,40}" required autoCapitalize="none" />
        </Field>
        <Field label="نقش" hint={isSelf ? 'نمی‌توانید نقش خود را تغییر دهید' : undefined}>
          <select value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })} disabled={isSelf}>
            {Object.entries(ROLE_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={isNew ? 'رمز عبور' : 'تعیین رمز عبور جدید'} hint={isNew ? 'حداقل ۸ کاراکتر' : 'برای حفظ رمز فعلی خالی بگذارید. تغییر رمز، کاربر را از سیستم خارج می‌کند.'}>
          <input dir="ltr" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
        </Field>
        {!isSelf && (
          <div className="span-all">
            <Toggle checked={form.isActive} onChange={(v) => setForm({ ...form, isActive: v })} label="حساب فعال (امکان ورود)" />
          </div>
        )}
      </form>
    </Modal>
  );
}
