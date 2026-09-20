import { useState } from 'react';
import { History, Search } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useLiveQuery } from '../../lib/hooks.js';
import { faDigits, formatDateTime } from '../../lib/format.js';
import { Empty, ErrorBlock, LoadingBlock, PageHeader, Pagination } from '../../components/ui.jsx';
import JalaliDateInput from '../../components/JalaliDateInput.jsx';

const EMPTY = { q: '', userId: '', action: '', entityType: '', from: '', to: '' };

const ENTITY_LABEL = {
  order: 'سفارش',
  order_item: 'آیتم سفارش',
  menu_item: 'آیتم منو',
  category: 'دسته‌بندی',
  table: 'میز',
  user: 'کاربر',
  station: 'ایستگاه',
  restaurant: 'رستوران',
};

const ACTION_LABEL = {
  'order.create': 'ثبت سفارش',
  'order.items_add': 'افزودن اقلام',
  'order.update': 'ویرایش سفارش',
  'order.complete': 'تکمیل سفارش',
  'order.cancel': 'لغو سفارش',
  'order.receipt_print': 'چاپ فیش',
  'payment.create': 'دریافت وجه',
  'payment.void': 'ابطال پرداخت',
  'order_item.status': 'تغییر وضعیت',
  'order_item.update': 'ویرایش آیتم سفارش',
  'order_item.cancel': 'لغو آیتم',
  'menu_item.create': 'افزودن به منو',
  'menu_item.update': 'ویرایش منو',
  'menu_item.price_change': 'تغییر قیمت',
  'menu_item.availability': 'تغییر موجودی',
  'menu_item.delete': 'حذف از منو',
  'menu_item.image': 'تصویر منو',
  'category.create': 'ایجاد دسته‌بندی',
  'category.update': 'ویرایش دسته‌بندی',
  'category.delete': 'حذف دسته‌بندی',
  'table.create': 'ایجاد میز',
  'table.update': 'ویرایش میز',
  'table.delete': 'حذف میز',
  'table.release': 'آزادسازی میز',
  'user.create': 'ایجاد کاربر',
  'user.update': 'ویرایش کاربر',
  'station.create': 'ایجاد ایستگاه',
  'station.update': 'ویرایش ایستگاه',
  'settings.update': 'تغییر تنظیمات',
  'auth.login': 'ورود',
  'auth.login_failed': 'ورود ناموفق',
  'auth.password_change': 'تغییر رمز عبور',
  'system.seed': 'سیستم',
};

export default function AuditLog() {
  const { restaurant } = useAuth();
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState(null);

  const usersQ = useLiveQuery(() => api.get('/users'), [], { intervalMs: 0 });
  const q = useLiveQuery(() => api.get(`/audit-logs${qs({ ...filters, page, pageSize: 50 })}`), [filters, page], { intervalMs: 0 });

  const apply = (e) => {
    e.preventDefault();
    setPage(1);
    setFilters(draft);
  };

  return (
    <div className="page">
      <PageHeader title="رویدادها" subtitle="چه کسی، چه کاری، چه زمانی انجام داده است" />
      <form className="filters card" onSubmit={apply}>
        <label className="search grow">
          <Search size={20} aria-hidden />
          <input type="search" placeholder="جستجو در شرح (مثلاً ۱۰۴۸ یا پیتزا)" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} aria-label="جستجو" />
        </label>
        <select value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })} aria-label="کاربر">
          <option value="">همه کاربران</option>
          {(usersQ.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select value={draft.entityType} onChange={(e) => setDraft({ ...draft, entityType: e.target.value })} aria-label="موضوع">
          <option value="">همه موضوع‌ها</option>
          {Object.entries(ENTITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })} aria-label="عملیات">
          <option value="">همه عملیات</option>
          {(q.data?.actions ?? []).map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a] ?? a}
            </option>
          ))}
        </select>
        <JalaliDateInput label="از" value={draft.from} onChange={(v) => setDraft({ ...draft, from: v })} />
        <JalaliDateInput label="تا" value={draft.to} onChange={(v) => setDraft({ ...draft, to: v })} />
        <button type="submit" className="btn btn-primary">
          اعمال فیلتر
        </button>
      </form>

      {q.error && !q.data && <ErrorBlock error={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && <LoadingBlock />}
      {q.data && q.data.logs.length === 0 && <Empty icon={History} title="رویدادی پیدا نشد" />}
      {q.data && q.data.logs.length > 0 && (
        <div className="card table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>زمان</th>
                <th>کاربر</th>
                <th>عملیات</th>
                <th>شرح</th>
              </tr>
            </thead>
            <tbody>
              {q.data.logs.map((log) => (
                <tr key={log.id} onClick={() => setExpanded(expanded === log.id ? null : log.id)} className={log.metadata ? 'clickable-row' : ''}>
                  <td className="nowrap muted">{formatDateTime(log.createdAt, restaurant?.timezone)}</td>
                  <td className="nowrap">{log.user?.name ?? <span className="muted">سیستم</span>}</td>
                  <td className="nowrap">
                    <span className="action-code" title={log.action}>
                      {ACTION_LABEL[log.action] ?? log.action}
                    </span>
                  </td>
                  <td>
                    {faDigits(log.summary)}
                    {expanded === log.id && log.metadata && (
                      <pre className="meta-json" dir="ltr">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={q.data.page} pageSize={q.data.pageSize} total={q.data.total} onChange={setPage} />
        </div>
      )}
    </div>
  );
}
