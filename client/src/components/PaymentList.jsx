import { Banknote, CreditCard, Wallet } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { PAYMENT_METHOD_LABEL, faDigits, formatTime } from '../lib/format.js';

export const METHOD_ICON = { CASH: Banknote, CARD: CreditCard, OTHER: Wallet };

/** Payments of an order. Voided ones stay visible (struck through) with who voided and why. */
export default function PaymentList({ payments, onVoid, busy }) {
  const { money, restaurant } = useAuth();
  const tz = restaurant?.timezone;
  if (!payments.length) return <p className="muted">هنوز پرداختی ثبت نشده است.</p>;
  return (
    <ul className="payment-rows">
      {payments.map((p) => {
        const Icon = METHOD_ICON[p.method];
        return (
          <li key={p.id} className={`payment-row ${p.voidedAt ? 'is-void' : ''}`}>
            <Icon size={22} aria-hidden className="muted" />
            <div className="payment-main">
              <span>
                <b className="payment-amount">{money(p.amount)}</b> · {PAYMENT_METHOD_LABEL[p.method]}
                {p.reference && (
                  <>
                    {' '}
                    · پیگیری <span dir="ltr">{faDigits(p.reference)}</span>
                  </>
                )}
              </span>
              <span className="muted small">
                {formatTime(p.createdAt, tz)} · {p.createdByName}
                {p.change > 0 && ` · دریافتی ${money(p.receivedAmount)}، باقی ${money(p.change)}`}
              </span>
              {p.voidedAt && (
                <span className="danger-text small">
                  باطل‌شده توسط {p.voidedByName} در {formatTime(p.voidedAt, tz)}: {p.voidReason}
                </span>
              )}
            </div>
            {onVoid && !p.voidedAt && (
              <button type="button" className="btn btn-ghost btn-sm danger-text" disabled={busy} onClick={() => onVoid(p)}>
                ابطال
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
