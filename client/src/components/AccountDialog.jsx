import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { ROLE_LABEL } from '../lib/format.js';
import { Field, Modal, Spinner } from './ui.jsx';

export default function AccountDialog({ open, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setForm({ currentPassword: '', newPassword: '', confirm: '' });
    setError('');
    onClose();
  };

  async function submit(e) {
    e.preventDefault();
    if (form.newPassword.length < 8) return setError('رمز عبور جدید باید حداقل ۸ کاراکتر باشد');
    if (form.newPassword !== form.confirm) return setError('تکرار رمز عبور جدید یکسان نیست');
    setBusy(true);
    try {
      await api.post('/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success('رمز عبور تغییر کرد. از سایر دستگاه‌ها خارج شدید.');
      close();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title="حساب کاربری" size="sm">
      <p className="muted">
        {user?.name} · <span dir="ltr">@{user?.username}</span> · {ROLE_LABEL[user?.roleCode]}
      </p>
      <form className="form-grid" onSubmit={submit}>
        <Field label="رمز عبور فعلی">
          <input type="password" dir="ltr" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} required />
        </Field>
        <Field label="رمز عبور جدید" hint="حداقل ۸ کاراکتر">
          <input type="password" dir="ltr" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} required />
        </Field>
        <Field label="تکرار رمز عبور جدید">
          <input type="password" dir="ltr" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} required />
        </Field>
        {error && <p className="field-error">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={18} />} تغییر رمز عبور
          </button>
        </div>
      </form>
    </Modal>
  );
}
