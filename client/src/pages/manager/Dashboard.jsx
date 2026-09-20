import { Link } from 'react-router-dom';
import { ChefHat, GlassWater } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useLiveQuery } from '../../lib/hooks.js';
import { PAYMENT_METHOD_LABEL, faDigits, faNumber, formatBusinessDate, formatMinutes } from '../../lib/format.js';
import { ErrorBlock, LoadingBlock, PageHeader } from '../../components/ui.jsx';
import { ColumnChart, HBarList, StatTile, compactMoney } from '../../components/charts.jsx';

export default function Dashboard() {
  const { money, restaurant, stations } = useAuth();
  const { data, error, loading, reload } = useLiveQuery(() => api.get('/reports/dashboard'), [], {
    events: ['orders:changed', 'items:ready'],
    intervalMs: 60_000,
  });

  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;

  const t = data.totals;
  const compact = compactMoney(restaurant);
  const withOrders = data.hourly.filter((h) => h.orders);
  const firstHour = Math.min(11, ...withOrders.map((h) => h.hour));
  const lastHour = Math.max(23, ...withOrders.map((h) => h.hour));
  const hours = data.hourly.filter((h) => h.hour >= firstHour && h.hour <= lastHour);

  return (
    <div className="page">
      <PageHeader title="امروز" subtitle={`روز کاری ${formatBusinessDate(data.businessDate, { weekday: 'long', day: 'numeric', month: 'long' })} · به‌روزرسانی زنده`} />

      <div className="stats">
        <StatTile hero label="فروش امروز" value={money(t.sales)} sub={`${faNumber(t.completedOrders)} سفارش تکمیل‌شده`} />
        <StatTile label="سفارش‌های امروز" value={faNumber(t.totalOrders)} sub={`${faNumber(t.activeOrders)} باز · ${faNumber(t.cancelledOrders)} لغوشده`} />
        <StatTile
          label="میزهای فعال"
          value={`${faNumber(data.floor.activeTables)} از ${faNumber(data.floor.tables)}`}
          sub={`${faNumber(data.floor.guestsSeated)} مهمان حاضر${data.floor.awaitingRelease ? ` · ${faNumber(data.floor.awaitingRelease)} میز منتظر آزادسازی` : ''}`}
        />
        <StatTile label="میانگین ارزش سفارش" value={money(t.averageOrderValue)} sub={t.guests ? `${money(t.averagePerGuest)} برای هر مهمان` : 'هنوز سفارشی تکمیل نشده'} />
        <StatTile label="ارزش سفارش‌های باز" value={money(t.openOrdersValue)} sub="هنوز تکمیل نشده" />
        <StatTile
          label="دریافتی صندوق امروز"
          value={money(data.payments.collected)}
          sub={[
            ...data.payments.byMethod.filter((m) => m.amount > 0).map((m) => `${PAYMENT_METHOD_LABEL[m.method]} ${money(m.amount)}`),
            data.unpaid.count ? `${faNumber(data.unpaid.count)} سفارش تکمیل‌شده پرداخت نشده` : null,
          ]
            .filter(Boolean)
            .join(' · ') || 'هنوز پرداختی ثبت نشده'}
        />
      </div>

      <div className="grid-2">
        {data.stations.map((s) => {
          const station = stations.find((x) => x.id === s.id);
          const Icon = station?.roleCode === 'BAR' ? GlassWater : ChefHat;
          return (
            <section key={s.id} className="card">
              <div className="card-head">
                <h2>
                  <Icon size={20} aria-hidden /> عملکرد {s.name}
                </h2>
                <Link to={`/station/${s.id}`} className="btn btn-ghost btn-sm">
                  نمایشگر
                </Link>
              </div>
              <div className="mini-stats">
                <StatTile label="میانگین تا آماده شدن" value={formatMinutes(s.averageTotalMinutes)} sub={`۹۰٪ در کمتر از ${formatMinutes(s.p90TotalMinutes)}`} />
                <StatTile label="میانگین انتظار تا شروع" value={formatMinutes(s.averageQueueMinutes)} />
                <StatTile label="میانگین آماده‌سازی" value={formatMinutes(s.averageCookMinutes)} />
                <StatTile label="اقلام آماده‌شده" value={faNumber(s.itemsPrepared)} sub={`${faNumber(s.quantityPrepared)} پرس`} />
              </div>
              <div className="live-queue">
                <span className="badge st-pending">جدید {faNumber(s.live.PENDING)}</span>
                <span className="badge st-preparing">در حال آماده‌سازی {faNumber(s.live.PREPARING)}</span>
                <span className="badge st-ready">منتظر تحویل {faNumber(s.live.READY)}</span>
              </div>
            </section>
          );
        })}
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>پرفروش‌ترین آیتم‌ها</h2>
          <HBarList rows={data.topItems.map((i) => ({ key: i.id, label: i.name, value: i.quantity, sub: money(i.revenue) }))} format={(v) => `${faNumber(v)} فروش`} />
        </section>
        <section className="card">
          <h2>فروش بر اساس دسته‌بندی</h2>
          <HBarList rows={data.categories.map((c) => ({ key: c.id, label: c.name, value: c.revenue, sub: `${faNumber(c.share)}٪` }))} format={money} />
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>فروش تکمیل‌شده بر اساس ساعت ({restaurant?.currencySymbol})</h2>
          <ColumnChart
            label="فروش تکمیل‌شده بر اساس ساعت ثبت سفارش"
            data={hours.map((h) => ({
              key: h.hour,
              label: `ساعت ${faDigits(String(h.hour).padStart(2, '0'))} تا ${faDigits(String(h.hour + 1).padStart(2, '0'))}`,
              short: faDigits(String(h.hour).padStart(2, '0')),
              value: h.sales,
              extra: `${faNumber(h.orders)} سفارش`,
            }))}
            format={money}
            formatTick={compact}
          />
        </section>
        <section className="card">
          <h2>فروش بر اساس گارسون</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>گارسون</th>
                  <th className="num">سفارش</th>
                  <th className="num">باز</th>
                  <th className="num">فروش</th>
                  <th className="num">میانگین سفارش</th>
                </tr>
              </thead>
              <tbody>
                {data.waiters.map((w) => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td className="num">{faNumber(w.orders)}</td>
                    <td className="num">{faNumber(w.active)}</td>
                    <td className="num">
                      <b>{money(w.sales)}</b>
                    </td>
                    <td className="num">{money(w.averageOrderValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
