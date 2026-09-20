import { useState } from 'react';
import { CheckCheck, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { PERM, useAuth } from '../lib/auth.jsx';
import { useAction } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { ITEM_STATUS_LABEL, faDigits, formatTime } from '../lib/format.js';
import { ConfirmDialog, Field, StatusBadge, Stepper } from './ui.jsx';

/**
 * Submitted items of an order, grouped by round, with the actions the current role may take.
 * Every action reloads the order afterwards, so a 409 (someone else changed it) self-heals.
 */
export default function OrderItems({ order, editable, onChanged }) {
  const { user, can, money, restaurant } = useAuth();
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [reason, setReason] = useState('');
  const isManager = user.roleCode === 'MANAGER';
  const canWrite = editable && can(PERM.ORDER_WRITE);
  const tz = restaurant?.timezone;

  const act = (fn, success) =>
    run(async () => {
      try {
        await fn();
      } finally {
        await onChanged?.();
      }
    }, { success });

  const setStatus = (item, to, extra = {}) => act(() => api.post(`/order-items/${item.id}/status`, { from: item.status, to, ...extra }));

  if (!order.batches.length) {
    return <p className="muted pad">هنوز چیزی برای آشپزخانه یا بار ارسال نشده است.</p>;
  }

  return (
    <div className="rounds">
      {order.batches.map((batch) => (
        <section key={batch.id} className="round">
          <header className="round-head">
            <strong>مرحله {faDigits(batch.batchNo)}</strong>
            <span className="muted">
              {formatTime(batch.submittedAt, tz)} · {batch.createdByName}
            </span>
          </header>
          <ul className="item-rows">
            {batch.items.map((item) => {
              const cancellable = canWrite && (item.status === 'PENDING' || (isManager && (item.status === 'PREPARING' || item.status === 'READY')));
              return (
                <li key={item.id} className={`item-row st-row-${item.status.toLowerCase()}`}>
                  <div className="item-main">
                    <span className="item-name">
                      <b>{faDigits(item.quantity)}×</b> {item.name}
                    </span>
                    {item.note && <span className="item-note">«{item.note}»</span>}
                    <span className="item-sub muted">
                      {item.station.name} · {money(item.lineTotal)}
                      {item.readyAt && item.status === 'READY' && <> · آماده از {formatTime(item.readyAt, tz)}</>}
                      {item.status === 'CANCELLED' && item.cancelReason && <> · {item.cancelReason}</>}
                    </span>
                  </div>
                  <div className="item-actions">
                    {canWrite && item.status === 'PENDING' && (
                      <Stepper
                        size="sm"
                        value={item.quantity}
                        disabled={busy}
                        onChange={(quantity) => act(() => api.patch(`/order-items/${item.id}`, { quantity, version: item.version }))}
                      />
                    )}
                    <StatusBadge status={item.status} />
                    {canWrite && item.status === 'READY' && (
                      <button type="button" className="btn btn-success btn-sm" disabled={busy} onClick={() => setStatus(item, 'DELIVERED')}>
                        <CheckCheck size={18} /> تحویل
                      </button>
                    )}
                    {cancellable && (
                      <button
                        type="button"
                        className="icon-btn danger"
                        disabled={busy}
                        aria-label={`لغو ${item.name}`}
                        title="لغو آیتم"
                        onClick={() => {
                          setReason('');
                          setCancelTarget(item);
                        }}
                      >
                        <X size={20} />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <ConfirmDialog
        open={!!cancelTarget}
        title="لغو آیتم"
        confirmLabel="لغو آیتم"
        danger
        busy={busy}
        onClose={() => setCancelTarget(null)}
        onConfirm={async () => {
          const target = cancelTarget;
          setCancelTarget(null);
          await setStatus(target, 'CANCELLED', reason.trim() ? { reason: reason.trim() } : {});
        }}
      >
        {cancelTarget && (
          <>
            <p>
              <b>
                {faDigits(cancelTarget.quantity)}× {cancelTarget.name}
              </b>{' '}
              لغو شود؟
              {cancelTarget.status !== 'PENDING' && <> این آیتم در وضعیت «{ITEM_STATUS_LABEL[cancelTarget.status]}» است.</>}
            </p>
            <Field label="دلیل (اختیاری)">
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="مثلاً مشتری منصرف شد" />
            </Field>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
