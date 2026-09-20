import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, Search } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { PERM, useAuth } from '../lib/auth.jsx';
import { useLiveQuery } from '../lib/hooks.js';
import { ORDER_STATUS_LABEL, PAYMENT_STATUS_LABEL, faNumber, formatBusinessDate, formatTime, latinDigits, orderNo } from '../lib/format.js';
import { Empty, ErrorBlock, LoadingBlock, PageHeader, Pagination, StatusBadge } from '../components/ui.jsx';
import JalaliDateInput from '../components/JalaliDateInput.jsx';

const EMPTY = { q: '', tableId: '', waiterId: '', status: '', paymentStatus: '', from: '', to: '' };

export default function Orders() {
  const { money, can, restaurant } = useAuth();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);

  const tablesQ = useLiveQuery(() => api.get('/tables'), [], { events: ['tables:changed'], intervalMs: 0 });
  const waitersQ = useLiveQuery(() => (can(PERM.STAFF_MANAGE) ? api.get('/users') : Promise.resolve([])), [], { intervalMs: 0 });
  const ordersQ = useLiveQuery(() => api.get(`/orders${qs({ ...filters, q: latinDigits(filters.q), page, pageSize: 25 })}`), [filters, page], {
    events: ['orders:changed'],
    intervalMs: 60_000,
  });

  const apply = (e) => {
    e?.preventDefault();
    setPage(1);
    setFilters(draft);
  };

  return (
    <div className="page">
      <PageHeader title="سفارش‌ها" subtitle="جستجو بر اساس شماره سفارش، میز، گارسون، تاریخ یا وضعیت" />

      <form className="filters card" onSubmit={apply}>
        <label className="search grow">
          <Search size={20} aria-hidden />
          <input type="search" placeholder="شماره سفارش، نام میز یا گارسون" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} aria-label="جستجوی سفارش" />
        </label>
        <select value={draft.tableId} onChange={(e) => setDraft({ ...draft, tableId: e.target.value })} aria-label="میز">
          <option value="">همه میزها</option>
          {(tablesQ.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {can(PERM.STAFF_MANAGE) && (
          <select value={draft.waiterId} onChange={(e) => setDraft({ ...draft, waiterId: e.target.value })} aria-label="گارسون">
            <option value="">همه کارکنان</option>
            {(waitersQ.data ?? [])
              .filter((u) => u.role.code === 'WAITER' || u.role.code === 'MANAGER')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        )}
        <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} aria-label="وضعیت">
          <option value="">همه وضعیت‌ها</option>
          {Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={draft.paymentStatus} onChange={(e) => setDraft({ ...draft, paymentStatus: e.target.value })} aria-label="وضعیت پرداخت">
          <option value="">همه وضعیت‌های پرداخت</option>
          {Object.entries(PAYMENT_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <JalaliDateInput label="از" value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} />
        <JalaliDateInput label="تا" value={draft.to} onChange={(v) => setDraft({ ...draft, to: v })} />
        <button type="submit" className="btn btn-primary">
          جستجو
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setDraft(EMPTY);
            setFilters(EMPTY);
            setPage(1);
          }}
        >
          پاک کردن فیلترها
        </button>
      </form>

      {ordersQ.error && !ordersQ.data && <ErrorBlock error={ordersQ.error} onRetry={ordersQ.reload} />}
      {ordersQ.loading && !ordersQ.data && <LoadingBlock />}
      {ordersQ.data && ordersQ.data.orders.length === 0 && <Empty icon={ClipboardList} title="سفارشی پیدا نشد" />}
      {ordersQ.data && ordersQ.data.orders.length > 0 && (
        <div className="card table-wrap">
          <table className="data-table clickable">
            <thead>
              <tr>
                <th>سفارش</th>
                <th>تاریخ</th>
                <th>میز</th>
                <th>گارسون</th>
                <th className="num">مهمان</th>
                <th className="num">اقلام</th>
                <th>وضعیت</th>
                <th>پرداخت</th>
                <th className="num">مبلغ</th>
              </tr>
            </thead>
            <tbody>
              {ordersQ.data.orders.map((o) => (
                <tr key={o.id} onClick={() => navigate(`/orders/${o.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/orders/${o.id}`)}>
                  <td>
                    <b>{orderNo(o.orderNumber)}</b>
                  </td>
                  <td className="nowrap">
                    {formatBusinessDate(o.businessDate, { day: 'numeric', month: 'long' })} <span className="muted">{formatTime(o.openedAt, restaurant?.timezone)}</span>
                  </td>
                  <td>{o.table.name}</td>
                  <td>{o.waiter.name}</td>
                  <td className="num">{faNumber(o.guestCount)}</td>
                  <td className="num">{faNumber(o.itemCount)}</td>
                  <td>
                    <StatusBadge kind="order" status={o.status} />
                  </td>
                  <td>{o.lifecycle !== 'CANCELLED' && o.total > 0 && <StatusBadge kind="payment" status={o.paymentStatus} />}</td>
                  <td className="num">
                    <b>{money(o.total)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={ordersQ.data.page} pageSize={ordersQ.data.pageSize} total={ordersQ.data.total} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
