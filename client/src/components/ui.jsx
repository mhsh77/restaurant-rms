import { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Minus, Plus, X } from 'lucide-react';
import { ITEM_STATUS_LABEL, ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, TABLE_STATUS_LABEL, faDigits, faNumber } from '../lib/format.js';

export function Modal({ open, onClose, title, children, footer, size = 'md', className = '' }) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal modal-${size} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          {onClose && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="بستن">
              <X size={22} />
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'تأیید', danger = false, busy = false, onConfirm, onClose, children }) {
  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            بازگشت
          </button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="spin" size={18} />} {confirmLabel}
          </button>
        </>
      }
    >
      {message && <p>{message}</p>}
      {children}
    </Modal>
  );
}

const LABELS = { item: ITEM_STATUS_LABEL, order: ORDER_STATUS_LABEL, table: TABLE_STATUS_LABEL, payment: PAYMENT_STATUS_LABEL };

export function StatusBadge({ kind = 'item', status, large = false }) {
  if (!status) return null;
  return <span className={`badge st-${status.toLowerCase()} ${large ? 'badge-lg' : ''}`}>{LABELS[kind][status] ?? status}</span>;
}

export const Spinner = ({ size = 22 }) => <Loader2 className="spin" size={size} aria-label="در حال بارگذاری" />;

export function LoadingBlock({ label = 'در حال بارگذاری…' }) {
  return (
    <div className="state-block">
      <Spinner size={28} />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBlock({ error, onRetry }) {
  return (
    <div className="state-block state-error" role="alert">
      <AlertTriangle size={28} />
      <span>{error?.message || 'دریافت اطلاعات ممکن نشد'}</span>
      {onRetry && (
        <button type="button" className="btn btn-ghost" onClick={onRetry}>
          تلاش دوباره
        </button>
      )}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="state-block">
      {Icon && <Icon size={32} aria-hidden />}
      <strong>{title}</strong>
      {children && <span className="muted">{children}</span>}
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, max = 999, disabled = false, size = 'md', label = 'تعداد' }) {
  return (
    <div className={`stepper stepper-${size}`}>
      <button type="button" onClick={() => onChange(value + 1)} disabled={disabled || value >= max} aria-label={`افزایش ${label}`}>
        <Plus size={18} />
      </button>
      <span aria-live="polite">{faDigits(value)}</span>
      <button type="button" onClick={() => onChange(value - 1)} disabled={disabled || value <= min} aria-label={`کاهش ${label}`}>
        <Minus size={18} />
      </button>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
      {children}
    </div>
  );
}

export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

export function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="pagination muted">{faNumber(total)} نتیجه</div>;
  return (
    <div className="pagination">
      <span className="muted">
        {faNumber((page - 1) * pageSize + 1)} تا {faNumber(Math.min(total, page * pageSize))} از {faNumber(total)}
      </span>
      <button type="button" className="icon-btn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="صفحه قبل">
        <ChevronRight size={20} />
      </button>
      <span>
        {faNumber(page)} / {faNumber(pages)}
      </span>
      <button type="button" className="icon-btn" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="صفحه بعد">
        <ChevronLeft size={20} />
      </button>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={`toggle ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="toggle-track" aria-hidden />
      {label && <span>{label}</span>}
    </label>
  );
}

/** Coloured initial tile used when a menu item has no photo. */
export function ItemThumb({ item, size = 56 }) {
  if (item.imageUrl) return <img className="thumb" src={item.imageUrl} alt="" width={size} height={size} loading="lazy" />;
  const hue = [...item.name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  return (
    <span className="thumb thumb-initial" style={{ width: size, height: size, background: `hsl(${hue} 55% 88%)`, color: `hsl(${hue} 45% 30%)` }} aria-hidden>
      {item.name.slice(0, 1)}
    </span>
  );
}
