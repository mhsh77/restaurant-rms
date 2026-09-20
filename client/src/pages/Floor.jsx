import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, Clock, Pencil, Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { PERM, useAuth } from '../lib/auth.jsx';
import { useLiveQuery, useNow } from '../lib/hooks.js';
import { PAYMENT_STATUS_LABEL, TABLE_STATUS_LABEL, faDigits, faNumber, formatElapsed, orderNo } from '../lib/format.js';
import { ErrorBlock, LoadingBlock, PageHeader, Empty } from '../components/ui.jsx';
import CounterQueue from '../components/CounterQueue.jsx';

const STATUS_ORDER = ['READY', 'PREPARING', 'ORDERING', 'WAITING_FOR_ORDER', 'OCCUPIED', 'COMPLETED', 'AVAILABLE'];

export default function Floor() {
  const { user, money, can } = useAuth();
  const navigate = useNavigate();
  const now = useNow(1000);
  const [area, setArea] = useState('');
  const [status, setStatus] = useState('');
  const [mineOnly, setMineOnly] = useState(false);

  const { data, error, loading, reload } = useLiveQuery(() => api.get('/tables'), [], {
    events: ['orders:changed', 'tables:changed', 'items:ready'],
    intervalMs: 20_000, // "Ordering" presence expires by time
  });

  const tables = data ?? [];
  const areas = useMemo(() => [...new Set(tables.map((t) => t.area).filter(Boolean))], [tables]);
  const counts = useMemo(() => Object.fromEntries(STATUS_ORDER.map((s) => [s, tables.filter((t) => t.status === s).length])), [tables]);
  const visible = tables.filter(
    (t) => (!area || t.area === area) && (!status || t.status === status) && (!mineOnly || t.order?.waiter.id === user.id),
  );

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;

  return (
    <div className="page floor-page">
      <PageHeader
        title="میزها"
        subtitle={`${faNumber(tables.length - counts.AVAILABLE)} از ${faNumber(tables.length)} میز در حال استفاده`}
        actions={
          can(PERM.TABLES_MANAGE) && (
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/tables')}>
              <Pencil size={18} /> ویرایش میزها
            </button>
          )
        }
      />

      {can(PERM.ORDER_WRITE) && <CounterQueue only="needs-table" />}

      <div className="filter-bar">
        <div className="chips" role="group" aria-label="فیلتر وضعیت">
          <button type="button" className={`chip ${!status ? 'is-active' : ''}`} onClick={() => setStatus('')}>
            همه <b>{faNumber(tables.length)}</b>
          </button>
          {STATUS_ORDER.filter((s) => counts[s] > 0 || s === status).map((s) => (
            <button key={s} type="button" className={`chip chip-status st-${s.toLowerCase()} ${status === s ? 'is-active' : ''}`} onClick={() => setStatus(status === s ? '' : s)}>
              {TABLE_STATUS_LABEL[s]} <b>{faNumber(counts[s])}</b>
            </button>
          ))}
        </div>
        <div className="chips">
          {areas.length > 1 && (
            <>
              <button type="button" className={`chip ${!area ? 'is-active' : ''}`} onClick={() => setArea('')}>
                همه بخش‌ها
              </button>
              {areas.map((a) => (
                <button key={a} type="button" className={`chip ${area === a ? 'is-active' : ''}`} onClick={() => setArea(area === a ? '' : a)}>
                  {a}
                </button>
              ))}
            </>
          )}
          {user.roleCode === 'WAITER' && (
            <button type="button" className={`chip ${mineOnly ? 'is-active' : ''}`} onClick={() => setMineOnly((m) => !m)}>
              میزهای من
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty title="میزی با این فیلتر وجود ندارد" />
      ) : (
        <div className="table-grid">
          {visible.map((t) => {
            const o = t.order;
            const mine = o?.waiter.id === user.id;
            return (
              <button key={t.id} type="button" className={`table-tile st-${t.status.toLowerCase()} ${mine ? 'is-mine' : ''}`} onClick={() => navigate(`/tables/${t.id}`)}>
                <div className="tile-top">
                  <span className="tile-name">{t.name}</span>
                  <span className="tile-cap">
                    <Users size={16} aria-hidden /> {o ? faDigits(`${o.guestCount}/${t.capacity}`) : faDigits(t.capacity)}
                  </span>
                </div>
                <span className="tile-status">{TABLE_STATUS_LABEL[t.status]}</span>
                {o ? (
                  <div className="tile-order">
                    <span>
                      {orderNo(o.orderNumber)} · {mine ? 'شما' : o.waiter.name}
                    </span>
                    <span className="tile-meta">
                      <Clock size={14} aria-hidden /> {formatElapsed(now - new Date(o.openedAt).getTime())}
                      {o.subtotal > 0 && <> · {money(o.subtotal)}</>}
                    </span>
                    {t.status === 'ORDERING' && o.orderingUserName && <span className="tile-meta">{o.orderingUserName} در حال سفارش…</span>}
                    {o.paidAmount > 0 && <span className={`tile-pay pay-${o.paymentStatus.toLowerCase()}`}>{PAYMENT_STATUS_LABEL[o.paymentStatus]}</span>}
                  </div>
                ) : (
                  <div className="tile-order muted">{t.area}</div>
                )}
                {o?.counts.READY > 0 && (
                  <span className="tile-ready">
                    <BellRing size={16} aria-hidden /> {faNumber(o.counts.READY)} آماده
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
