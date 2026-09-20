import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Printer, UtensilsCrossed } from 'lucide-react';
import { api } from '../lib/api.js';
import { PERM, useAuth } from '../lib/auth.jsx';
import { useLiveQuery } from '../lib/hooks.js';
import { faNumber, formatDateTime, orderNo } from '../lib/format.js';
import { ErrorBlock, LoadingBlock, StatusBadge } from '../components/ui.jsx';
import OrderItems from '../components/OrderItems.jsx';
import PaymentList from '../components/PaymentList.jsx';
import ReceiptPreview from '../components/ReceiptPreview.jsx';

export default function OrderDetail() {
  const orderId = Number(useParams().orderId);
  const { money, can, restaurant } = useAuth();
  const [receiptOpen, setReceiptOpen] = useState(false);
  const { data: order, error, loading, reload } = useLiveQuery(() => api.get(`/orders/${orderId}`), [orderId], {
    events: ['orders:changed', 'items:ready'],
    filter: (p) => p?.orderId === orderId,
  });
  const tz = restaurant?.timezone;

  if (loading && !order) return <LoadingBlock />;
  if (error && !order) return <ErrorBlock error={error} onRetry={reload} />;

  const live = order.lifecycle === 'ACTIVE' || (order.lifecycle === 'COMPLETED' && !order.releasedAt);

  return (
    <div className="page narrow">
      <div className="page-header">
        <Link to="/orders" className="btn btn-ghost">
          <ArrowRight size={20} /> سفارش‌ها
        </Link>
        <h1>سفارش {orderNo(order.orderNumber)}</h1>
        <StatusBadge kind="order" status={order.status} large />
        <StatusBadge kind="payment" status={order.paymentStatus} large />
        <div className="page-actions">
          {live && can(PERM.ORDER_WRITE) && (
            <Link to={`/tables/${order.table.id}`} className="btn btn-primary">
              <UtensilsCrossed size={18} /> باز کردن صفحه میز
            </Link>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => setReceiptOpen(true)}>
            <Printer size={18} /> فیش
          </button>
        </div>
      </div>

      <div className="card detail-grid">
        <div>
          <span className="muted">میز</span>
          <strong>{order.table.name}</strong>
        </div>
        <div>
          <span className="muted">گارسون</span>
          <strong>{order.waiter.name}</strong>
        </div>
        <div>
          <span className="muted">مهمان</span>
          <strong>{faNumber(order.guestCount)} نفر</strong>
        </div>
        <div>
          <span className="muted">زمان ثبت</span>
          <strong>{formatDateTime(order.openedAt, tz)}</strong>
        </div>
        <div>
          <span className="muted">{order.lifecycle === 'CANCELLED' ? 'زمان لغو' : 'زمان تکمیل'}</span>
          <strong>{formatDateTime(order.completedAt || order.cancelledAt, tz) || '—'}</strong>
        </div>
        <div>
          <span className="muted">مبلغ کل</span>
          <strong className="big-number">{money(order.total)}</strong>
        </div>
        <div>
          <span className="muted">پرداخت‌شده</span>
          <strong>{money(order.paidAmount)}</strong>
        </div>
        <div>
          <span className="muted">{order.remaining < 0 ? 'اضافه پرداخت' : 'مانده'}</span>
          <strong>{money(Math.abs(order.remaining))}</strong>
        </div>
        {order.cancelReason && (
          <div className="span-all">
            <span className="muted">دلیل لغو</span>
            <strong>{order.cancelReason}</strong>
          </div>
        )}
        <div>
          <span className="muted">دفعات چاپ فیش</span>
          <strong>{faNumber(order.receiptPrintCount)} بار</strong>
        </div>
      </div>

      <div className="card">
        <h2>پرداخت‌ها</h2>
        <PaymentList payments={order.payments} />
      </div>

      <div className="card">
        <OrderItems order={order} editable={order.lifecycle === 'ACTIVE'} onChanged={reload} />
      </div>

      <ReceiptPreview orderId={order.id} open={receiptOpen} onClose={() => setReceiptOpen(false)} />
    </div>
  );
}
