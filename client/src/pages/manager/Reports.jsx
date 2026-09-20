import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useLiveQuery } from '../../lib/hooks.js';
import { PAYMENT_METHOD_LABEL, faDigits, faNumber, formatBusinessDate, formatMinutes } from '../../lib/format.js';
import { ErrorBlock, LoadingBlock, PageHeader } from '../../components/ui.jsx';
import { ColumnChart, HBarList, StatTile, compactMoney } from '../../components/charts.jsx';
import JalaliDateInput from '../../components/JalaliDateInput.jsx';

const PRESETS = [
  ['today', 'امروز'],
  ['yesterday', 'دیروز'],
  ['week', 'این هفته'],
  ['month', 'این ماه'],
  ['custom', 'بازه دلخواه'],
];

function ExportLink({ type, params, label = 'CSV' }) {
  return (
    <a className="btn btn-ghost btn-sm" href={`/api/reports/export${qs({ type, ...params })}`}>
      <Download size={16} /> {label}
    </a>
  );
}

export default function Reports() {
  const { money, restaurant } = useAuth();
  const [range, setRange] = useState('today');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [params, setParams] = useState({ range: 'today' });
  const [dailyView, setDailyView] = useState('chart');

  const { data, error, loading, reload } = useLiveQuery(() => api.get(`/reports/summary${qs(params)}`), [params], { intervalMs: 0 });

  const choose = (value) => {
    setRange(value);
    if (value !== 'custom') setParams({ range: value });
  };
  const applyCustom = (e) => {
    e.preventDefault();
    if (custom.from && custom.to) setParams({ range: 'custom', ...custom });
  };

  const compact = compactMoney(restaurant);
  const hour = (h) => faDigits(`${String(h).padStart(2, '0')}:00`);

  return (
    <div className="page">
      <PageHeader
        title="گزارش‌ها"
        subtitle={data ? `${formatBusinessDate(data.range.from)} تا ${formatBusinessDate(data.range.to)} · ${faNumber(data.range.days)} روز` : ' '}
      />

      <div className="filter-bar">
        <div className="segmented" role="group" aria-label="بازه زمانی">
          {PRESETS.map(([value, label]) => (
            <button key={value} type="button" className={range === value ? 'is-active' : ''} onClick={() => choose(value)}>
              {label}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <form className="inline-form" onSubmit={applyCustom}>
            <JalaliDateInput label="از" value={custom.from} onChange={(v) => setCustom({ ...custom, from: v })} required />
            <JalaliDateInput label="تا" value={custom.to} onChange={(v) => setCustom({ ...custom, to: v })} required />
            <button type="submit" className="btn btn-primary" disabled={!custom.from || !custom.to}>
              اعمال
            </button>
          </form>
        )}
      </div>

      {error && <ErrorBlock error={error} onRetry={reload} />}
      {loading && !data && <LoadingBlock />}
      {data && (
        <div className={loading ? 'is-refreshing' : ''}>
          <div className="stats">
            <StatTile hero label="فروش" value={money(data.totals.sales)} sub="سفارش‌های تکمیل‌شده" />
            <StatTile label="سفارش‌ها" value={faNumber(data.totals.completedOrders)} sub={`${faNumber(data.totals.cancelledOrders)} لغوشده · ${faNumber(data.totals.activeOrders)} هنوز باز`} />
            <StatTile label="میانگین ارزش سفارش" value={money(data.totals.averageOrderValue)} />
            <StatTile label="مهمان" value={faNumber(data.totals.guests)} sub={`${money(data.totals.averagePerGuest)} برای هر مهمان`} />
            <StatTile label="میانگین زمان حضور سر میز" value={formatMinutes(data.totals.averageTableMinutes)} />
          </div>

          <section className="card">
            <div className="card-head">
              <h2>فروش روزانه ({restaurant?.currencySymbol})</h2>
              <div className="button-row">
                <div className="segmented segmented-sm" role="group" aria-label="نما">
                  <button type="button" className={dailyView === 'chart' ? 'is-active' : ''} onClick={() => setDailyView('chart')}>
                    نمودار
                  </button>
                  <button type="button" className={dailyView === 'table' ? 'is-active' : ''} onClick={() => setDailyView('table')}>
                    جدول
                  </button>
                </div>
                <ExportLink type="daily" params={params} label="CSV روزانه" />
                <ExportLink type="orders" params={params} label="CSV سفارش‌ها" />
              </div>
            </div>
            {dailyView === 'chart' ? (
              data.daily.length > 1 ? (
                <ColumnChart
                  label="فروش روزانه"
                  data={data.daily.map((d) => ({
                    key: d.date,
                    label: formatBusinessDate(d.date, { weekday: 'long', day: 'numeric', month: 'long' }),
                    short: formatBusinessDate(d.date, data.daily.length > 20 ? { day: 'numeric' } : { day: 'numeric', month: 'short' }),
                    value: d.sales,
                    extra: `${faNumber(d.orders)} سفارش · میانگین ${money(d.averageOrderValue)}`,
                  }))}
                  format={money}
                  formatTick={compact}
                  height={240}
                />
              ) : (
                <ColumnChart
                  label="فروش بر اساس ساعت"
                  data={data.hourly
                    .filter((h) => h.hour >= 10)
                    .map((h) => ({ key: h.hour, label: `ساعت ${hour(h.hour)}`, short: faDigits(String(h.hour).padStart(2, '0')), value: h.sales, extra: `${faNumber(h.orders)} سفارش` }))}
                  format={money}
                  formatTick={compact}
                  height={240}
                />
              )
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>تاریخ</th>
                      <th className="num">سفارش</th>
                      <th className="num">لغوشده</th>
                      <th className="num">مهمان</th>
                      <th className="num">میانگین سفارش</th>
                      <th className="num">فروش</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((d) => (
                      <tr key={d.date}>
                        <td>{formatBusinessDate(d.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</td>
                        <td className="num">{faNumber(d.orders)}</td>
                        <td className="num">{faNumber(d.cancelled)}</td>
                        <td className="num">{faNumber(d.guests)}</td>
                        <td className="num">{money(d.averageOrderValue)}</td>
                        <td className="num">
                          <b>{money(d.sales)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid-2">
            <section className="card">
              <div className="card-head">
                <h2>پرفروش‌ترین آیتم‌ها</h2>
                <ExportLink type="items" params={params} />
              </div>
              <HBarList rows={data.items.top.map((i) => ({ key: i.id, label: i.name, value: i.quantity, sub: money(i.revenue) }))} format={(v) => `${faNumber(v)} فروش`} />
            </section>
            <section className="card">
              <div className="card-head">
                <h2>کم‌فروش‌ترین آیتم‌ها</h2>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>آیتم</th>
                      <th>دسته‌بندی</th>
                      <th className="num">فروش</th>
                      <th className="num">درآمد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.bottom.map((i) => (
                      <tr key={i.id}>
                        <td>{i.name}</td>
                        <td className="muted">{i.category}</td>
                        <td className="num">{faNumber(i.quantity)}</td>
                        <td className="num">{money(i.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="grid-2">
            <section className="card">
              <div className="card-head">
                <h2>فروش بر اساس دسته‌بندی</h2>
                <ExportLink type="categories" params={params} />
              </div>
              <HBarList rows={data.categories.map((c) => ({ key: c.id, label: c.name, value: c.revenue, sub: `${faNumber(c.share)}٪ · ${faNumber(c.quantity)} فروش` }))} format={money} />
            </section>
            <section className="card">
              <div className="card-head">
                <h2>گارسون‌ها</h2>
                <ExportLink type="waiters" params={params} />
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>گارسون</th>
                      <th className="num">سفارش</th>
                      <th className="num">لغوشده</th>
                      <th className="num">مهمان</th>
                      <th className="num">میانگین سفارش</th>
                      <th className="num">میانگین زمان میز</th>
                      <th className="num">فروش</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.waiters.map((w) => (
                      <tr key={w.id}>
                        <td>{w.name}</td>
                        <td className="num">{faNumber(w.orders)}</td>
                        <td className="num">{faNumber(w.cancelled)}</td>
                        <td className="num">{faNumber(w.guests)}</td>
                        <td className="num">{money(w.averageOrderValue)}</td>
                        <td className="num">{formatMinutes(w.averageTableMinutes)}</td>
                        <td className="num">
                          <b>{money(w.sales)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>دریافتی صندوق</h2>
                <p className="muted">بر اساس روز دریافت وجه؛ پرداخت‌های باطل‌شده حساب نمی‌شوند</p>
              </div>
              <ExportLink type="payments" params={params} label="CSV پرداخت‌ها" />
            </div>
            <div className="grid-2">
              <div className="station-perf">
                <div className="mini-stats">
                  <StatTile label="جمع دریافتی" value={money(data.payments.collected)} sub={`${faNumber(data.payments.paymentCount)} پرداخت`} />
                  <StatTile label="باقی داده‌شده (نقدی)" value={money(data.payments.changeGiven)} />
                  <StatTile label="پرداخت‌های باطل‌شده" value={faNumber(data.payments.voided.count)} sub={money(data.payments.voided.amount)} />
                  <StatTile label="تکمیل‌شده ولی پرداخت نشده" value={faNumber(data.unpaid.count)} sub={money(data.unpaid.amount)} />
                </div>
              </div>
              <HBarList
                rows={data.payments.byMethod.map((m) => ({ key: m.method, label: PAYMENT_METHOD_LABEL[m.method], value: m.amount, sub: `${faNumber(m.count)} پرداخت` }))}
                format={money}
              />
            </div>
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <h2>عملکرد آشپزخانه و بار</h2>
                <p className="muted">انتظار = ثبت تا شروع · آماده‌سازی = شروع تا آماده · کل = ثبت تا آماده</p>
              </div>
              <ExportLink type="stations" params={params} />
            </div>
            <div className="grid-2">
              {data.stations.map((s) => (
                <div key={s.id} className="station-perf">
                  <h3>{s.name}</h3>
                  <div className="mini-stats">
                    <StatTile label="میانگین کل" value={formatMinutes(s.averageTotalMinutes)} sub={`۹۰٪ در کمتر از ${formatMinutes(s.p90TotalMinutes)}`} />
                    <StatTile label="میانگین انتظار" value={formatMinutes(s.averageQueueMinutes)} />
                    <StatTile label="میانگین آماده‌سازی" value={formatMinutes(s.averageCookMinutes)} />
                    <StatTile label="اقلام" value={faNumber(s.itemsPrepared)} sub={`${faNumber(s.quantityPrepared)} پرس`} />
                  </div>
                  {s.slowestItems.length > 0 && (
                    <>
                      <h4 className="muted">کندترین آیتم‌ها (میانگین ثبت تا آماده)</h4>
                      <HBarList rows={s.slowestItems.map((i) => ({ key: i.name, label: i.name, value: i.averageTotalMinutes, sub: `${faNumber(i.count)} بار` }))} format={formatMinutes} />
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
