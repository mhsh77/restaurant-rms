import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Armchair, HandPlatter, Timer } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useAction, useLiveQuery, useNow } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { faNumber, formatElapsed, orderNo } from '../lib/format.js';
import { Empty, Modal, StatusBadge } from './ui.jsx';

/**
 * Counter orders that are still on their way: cooking, waiting to be handed over, or sitting
 * somewhere without a table yet. The cashier sees all of them; the floor only shows the ones
 * that still need a table, because that is the waiter's part.
 */
export default function CounterQueue({ only = 'all', title = 'صف پیشخوان' }) {
  const { money } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const now = useNow(1000);
  const [run, busy] = useAction(toast);
  const [seating, setSeating] = useState(null); // the order we are choosing a table for

  const queueQ = useLiveQuery(() => api.get('/counter/queue'), [], { events: ['orders:changed'], intervalMs: 30_000 });
  const tablesQ = useLiveQuery(() => api.get('/tables'), [], { events: ['orders:changed', 'tables:changed'], intervalMs: 60_000 });
  const all = queueQ.data ?? [];
  const rows = only === 'needs-table' ? all.filter((o) => o.needsTable) : all;
  const freeTables = (tablesQ.data ?? []).filter((t) => !t.order);

  if (!rows.length) {
    if (only === 'needs-table') return null; // nothing to say on the floor
    return <Empty icon={HandPlatter} title="سفارشی در صف پیشخوان نیست">سفارش‌های ثبت‌شده در پیشخوان اینجا دنبال می‌شوند.</Empty>;
  }

  const seat = (order, tableId) =>
    run(async () => {
      await api.post(`/orders/${order.id}/table`, { tableId });
      setSeating(null);
      queueQ.reload();
      tablesQ.reload();
    }, { success: 'میز سفارش ثبت شد' });

  return (
    <div className="counter-queue">
      {only !== 'needs-table' && <h3>{title}</h3>}
      {only === 'needs-table' && (
        <h3>
          <Armchair size={18} aria-hidden /> سفارش‌های پیشخوان بدون میز ({faNumber(rows.length)})
        </h3>
      )}
      <div className="queue-rows">
        {rows.map((o) => (
          <article key={o.id} className={`queue-row ${o.canHandOver ? 'is-ready' : ''}`}>
            <button type="button" className="queue-main" onClick={() => navigate(`/orders/${o.id}`)}>
              <span className="queue-top">
                <b>{o.place}</b>
                <span className="badge st-pending">{o.serviceModeLabel}</span>
                {o.canHandOver && <span className="badge st-ready">آماده تحویل</span>}
              </span>
              <span className="muted small">
                {orderNo(o.orderNumber)}
                {o.customerName ? ` · ${o.customerName}` : ''} · {money(o.total)} · <Timer size={13} aria-hidden /> {formatElapsed(now - new Date(o.openedAt).getTime())}
              </span>
              <span className="queue-state muted small">
                {o.working > 0 ? `${faNumber(o.working)} آیتم در حال آماده‌سازی` : o.ready > 0 ? `${faNumber(o.ready)} آیتم آماده` : 'سرو شده'}
                {o.needsTable ? ' · میز مشخص نشده' : ''}
              </span>
            </button>
            <div className="queue-actions">
              {o.needsTable && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setSeating(o)}>
                  <Armchair size={18} /> انتخاب میز
                </button>
              )}
              {o.canHandOver && (
                <button
                  type="button"
                  className="btn btn-success btn-sm"
                  disabled={busy}
                  onClick={() => run(async () => { await api.post(`/orders/${o.id}/hand-over`); queueQ.reload(); }, { success: `${orderNo(o.orderNumber)} تحویل مشتری شد` })}
                >
                  <HandPlatter size={18} /> تحویل مشتری
                </button>
              )}
              {!o.needsTable && !o.canHandOver && <StatusBadge kind="order" status={o.status} />}
            </div>
          </article>
        ))}
      </div>

      <Modal open={!!seating} onClose={() => setSeating(null)} title={seating ? `میز سفارش ${orderNo(seating.orderNumber)}` : ''} size="sm">
        {freeTables.length === 0 ? (
          <Empty title="میز آزادی وجود ندارد" />
        ) : (
          <div className="guest-grid">
            {freeTables.map((t) => (
              <button key={t.id} type="button" className="guest-btn" disabled={busy} onClick={() => seat(seating, t.id)}>
                {t.name}
              </button>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
