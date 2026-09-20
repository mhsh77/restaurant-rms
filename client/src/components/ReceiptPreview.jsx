import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import { api } from '../lib/api.js';
import { PERM, useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';
import { PAYMENT_METHOD_LABEL, faDigits, faNumber, moneyFormatter, orderNo } from '../lib/format.js';
import { ErrorBlock, LoadingBlock, Modal } from './ui.jsx';

function Receipt({ data }) {
  const r = data.restaurant;
  const money = moneyFormatter({ currencySymbol: r.currencySymbol, currencyDecimals: r.currencyDecimals });
  const when = new Date(data.order.completedAt || data.printedAt);
  const date = new Intl.DateTimeFormat('fa-IR', { timeZone: r.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
  const time = new Intl.DateTimeFormat('fa-IR', { timeZone: r.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(when);

  return (
    <div className="receipt" dir="rtl">
      <div className="receipt-center">
        <div className="receipt-title">{r.name}</div>
        {r.address && <div>{r.address}</div>}
        {r.phone && (
          <div>
            تلفن: <span dir="ltr">{faDigits(r.phone)}</span>
          </div>
        )}
      </div>
      <div className="receipt-rule" />
      <div className="receipt-kv">
        <span>میز: {data.order.table}</span>
        <span>شماره سفارش: {orderNo(data.order.orderNumber)}</span>
      </div>
      <div className="receipt-kv">
        <span>گارسون: {data.order.waiter}</span>
        <span>مهمان: {faNumber(data.order.guestCount)} نفر</span>
      </div>
      <div className="receipt-kv">
        <span>تاریخ: {date}</span>
        <span>ساعت: {time}</span>
      </div>
      <div className="receipt-rule" />
      {data.lines.map((l) => (
        <div key={`${l.name}-${l.unitPrice}`} className="receipt-line">
          <div className="receipt-line-name">{l.name}</div>
          <div className="receipt-kv">
            <span>
              {faNumber(l.quantity)} × {money(l.unitPrice)}
            </span>
            <span>{money(l.lineTotal)}</span>
          </div>
        </div>
      ))}
      <div className="receipt-rule" />
      <div className="receipt-kv receipt-total">
        <span>جمع کل</span>
        <span>{money(data.total)}</span>
      </div>
      <div className="receipt-kv receipt-small">
        <span>{faNumber(data.itemCount)} قلم</span>
        {data.order.lifecycle !== 'COMPLETED' && <span>سفارش هنوز باز است</span>}
      </div>
      {data.payments.length > 0 && (
        <>
          <div className="receipt-rule" />
          {data.payments.map((p, i) => (
            <div key={i} className="receipt-kv">
              <span>
                {PAYMENT_METHOD_LABEL[p.method]}
                {p.reference ? ` (${faDigits(p.reference)})` : ''}
              </span>
              <span>{money(p.amount)}</span>
            </div>
          ))}
          {data.changeGiven > 0 && (
            <div className="receipt-kv receipt-small">
              <span>باقی پرداخت‌شده به مشتری</span>
              <span>{money(data.changeGiven)}</span>
            </div>
          )}
        </>
      )}
      <div className="receipt-kv receipt-total">
        <span>{data.remaining > 0 ? 'مانده قابل پرداخت' : data.remaining < 0 ? 'اضافه پرداخت' : 'پرداخت شد'}</span>
        <span>{data.remaining === 0 ? '✓' : money(Math.abs(data.remaining))}</span>
      </div>
      <div className="receipt-rule" />
      <div className="receipt-center">{r.footer}</div>
    </div>
  );
}

/** Print preview in a modal; the same markup is mirrored into #print-root for printing. */
export default function ReceiptPreview({ orderId, open, onClose }) {
  const { can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError(null);
    api.get(`/orders/${orderId}/receipt`).then(setData, setError);
  }, [open, orderId]);

  async function print() {
    window.print();
    if (can(PERM.ORDER_WRITE) || can(PERM.CASHIER_WORK)) {
      try {
        await api.post(`/orders/${orderId}/receipt/printed`);
      } catch (err) {
        toast.error(err.message);
      }
    }
  }

  const printRoot = document.getElementById('print-root');

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="پیش‌نمایش فیش"
        size="sm"
        footer={
          <>
            <span className="muted small">برای نسخه PDF، در پنجره چاپ گزینه «Save as PDF» را انتخاب کنید.</span>
            <button type="button" className="btn btn-primary" onClick={print} disabled={!data}>
              <Printer size={18} /> چاپ
            </button>
          </>
        }
      >
        {error && <ErrorBlock error={error} />}
        {!data && !error && <LoadingBlock />}
        {data && (
          <div className="receipt-paper">
            <Receipt data={data} />
          </div>
        )}
      </Modal>
      {open && data && printRoot && createPortal(<Receipt data={data} />, printRoot)}
    </>
  );
}
