import { useEffect, useMemo, useState } from 'react';
import { Banknote, CircleCheckBig, Printer, Search, ShoppingBasket, Trash2, Users } from 'lucide-react';
import { api, newRequestId } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useAction, useLiveQuery } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { PAYMENT_METHOD_LABEL, faNumber, minorToInput, orderNo, parseMoney } from '../lib/format.js';
import { Empty, Field, ItemThumb, LoadingBlock, Stepper } from './ui.jsx';
import { METHOD_ICON } from './PaymentList.jsx';
import ReceiptPreview from './ReceiptPreview.jsx';

/**
 * Taking an order at the counter: pick the items, say where it goes (a table, or away with
 * the guest), take the money, and send it to the kitchen — one step, because a counter order
 * is paid before anything is cooked.
 */
export default function CounterOrder({ modes, onDone }) {
  const { money, restaurant } = useAuth();
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const decimals = restaurant?.currencyDecimals ?? 0;

  const available = [modes.counterTable && 'COUNTER_TABLE', modes.counterPickup && 'COUNTER_PICKUP'].filter(Boolean);
  const [mode, setMode] = useState(available[0]);
  const [lines, setLines] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(0);
  const [tableId, setTableId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [method, setMethod] = useState('CASH');
  const [receivedText, setReceivedText] = useState('');
  const [reference, setReference] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);
  const [done, setDone] = useState(null); // the order just taken
  const [receiptOpen, setReceiptOpen] = useState(false);

  const menuQ = useLiveQuery(() => Promise.all([api.get('/menu/categories'), api.get('/menu/items')]), [], { events: ['menu:changed'], intervalMs: 120_000 });
  const tablesQ = useLiveQuery(() => api.get('/tables'), [], { events: ['orders:changed', 'tables:changed'], intervalMs: 30_000 });
  const [categories, items] = menuQ.data ?? [[], []];
  const freeTables = (tablesQ.data ?? []).filter((t) => !t.order);

  const filtered = useMemo(() => {
    const term = search.trim();
    return items.filter((i) => (!category || i.categoryId === category) && (!term || i.name.includes(term) || i.description.includes(term)));
  }, [items, search, category]);

  const total = lines.reduce((n, l) => n + l.quantity * l.price, 0);
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const received = method === 'CASH' ? (receivedText.trim() ? parseMoney(receivedText, decimals) : total) : null;
  const change = method === 'CASH' && received !== null ? received - total : 0;
  const steps = decimals === 0 ? [50_000, 100_000, 500_000, 1_000_000] : [500, 1_000, 2_000, 5_000];
  const quickCash = total > 0 ? [...new Set(steps.map((s) => Math.ceil(total / s) * s))].filter((v) => v > total).slice(0, 3) : [];

  const error =
    lines.length === 0
      ? 'هنوز آیتمی انتخاب نشده است'
      : method === 'CASH' && (received === null || received < total)
        ? 'وجه نقد دریافتی کمتر از مبلغ سفارش است'
        : null;

  useEffect(() => {
    if (mode === 'COUNTER_PICKUP') setTableId('');
  }, [mode]);

  const add = (item) =>
    setLines((ls) => {
      const found = ls.find((l) => l.menuItemId === item.id);
      return found
        ? ls.map((l) => (l === found ? { ...l, quantity: Math.min(999, l.quantity + 1) } : l))
        : [...ls, { menuItemId: item.id, name: item.name, price: item.price, quantity: 1, stationName: item.stationName }];
    });

  const reset = () => {
    setLines([]);
    setTableId('');
    setCustomerName('');
    setReceivedText('');
    setReference('');
    setMethod('CASH');
    setRequestId(newRequestId());
  };

  const submit = (e) => {
    e.preventDefault();
    if (error) return toast.error(error);
    return run(async () => {
      const res = await api.post('/counter-orders', {
        clientRequestId: requestId,
        mode,
        ...(mode === 'COUNTER_TABLE' && tableId ? { tableId: Number(tableId) } : {}),
        ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
        items: lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity })),
        payment: {
          method,
          amount: total,
          ...(method === 'CASH' ? { receivedAmount: received } : {}),
          ...(method !== 'CASH' && reference.trim() ? { reference: reference.trim() } : {}),
        },
      });
      setDone({ order: res.order, change: res.change });
      reset();
      onDone?.();
      toast.success(`سفارش ${orderNo(res.order.orderNumber)} ثبت و دریافت شد`);
    });
  };

  if (done) {
    const o = done.order;
    return (
      <div className="card center-card counter-done">
        <CircleCheckBig size={48} className="text-success" />
        <h2>سفارش {orderNo(o.orderNumber)} ثبت شد</h2>
        <p className="muted">
          {o.serviceModeLabel} · {o.place}
          {o.customerName ? ` · ${o.customerName}` : ''}
        </p>
        <div className="counter-done-amounts">
          <div>
            <span className="muted">مبلغ دریافتی</span>
            <strong>{money(o.total)}</strong>
          </div>
          {done.change > 0 && (
            <div className="change-box">
              <span>باقی پول مشتری</span>
              <span>{money(done.change)}</span>
            </div>
          )}
        </div>
        {o.serviceMode === 'COUNTER_PICKUP' && <p className="notice notice-info">شماره {orderNo(o.orderNumber)} را به مشتری بدهید؛ هنگام آماده شدن، از همین صفحه تحویل بزنید.</p>}
        {o.serviceMode === 'COUNTER_TABLE' && !o.table && <p className="notice notice-warn">میز این سفارش هنوز مشخص نیست؛ بعد از نشستن مهمان، در فهرست «صف پیشخوان» میز را انتخاب کنید.</p>}
        <div className="button-row">
          <button type="button" className="btn btn-ghost btn-lg" onClick={() => setReceiptOpen(true)}>
            <Printer size={20} /> فیش
          </button>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setDone(null)}>
            سفارش بعدی
          </button>
        </div>
        <ReceiptPreview orderId={o.id} open={receiptOpen} onClose={() => setReceiptOpen(false)} />
      </div>
    );
  }

  return (
    <form className="counter-order" onSubmit={submit}>
      <section className="menu-pane card" aria-label="منو">
        <div className="menu-toolbar">
          <div className="search">
            <Search size={20} aria-hidden />
            <input type="search" placeholder="جستجو در منو…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="جستجو در منو" />
          </div>
        </div>
        <div className="chips chips-scroll" role="group" aria-label="دسته‌بندی‌ها">
          <button type="button" className={`chip chip-lg ${!category ? 'is-active' : ''}`} onClick={() => setCategory(0)}>
            همه
          </button>
          {categories.map((c) => (
            <button key={c.id} type="button" className={`chip chip-lg ${category === c.id ? 'is-active' : ''}`} onClick={() => setCategory(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        {menuQ.loading && !menuQ.data ? (
          <LoadingBlock />
        ) : filtered.length === 0 ? (
          <Empty icon={Search} title="آیتمی پیدا نشد" />
        ) : (
          <div className="menu-grid">
            {filtered.map((item) => {
              const inCart = lines.find((l) => l.menuItemId === item.id)?.quantity ?? 0;
              return (
                <button key={item.id} type="button" className={`menu-tile ${!item.isAvailable ? 'is-unavailable' : ''} ${inCart ? 'in-cart' : ''}`} disabled={!item.isAvailable} onClick={() => add(item)}>
                  <ItemThumb item={item} size={52} />
                  <span className="menu-tile-text">
                    <span className="menu-tile-name">{item.name}</span>
                    <span className="menu-tile-meta">
                      {item.isAvailable ? money(item.price) : 'ناموجود'} · {item.stationName}
                    </span>
                  </span>
                  {inCart > 0 && <span className="menu-tile-count">{faNumber(inCart)}</span>}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="counter-ticket card" aria-label="سفارش پیشخوان">
        {available.length > 1 && (
          <div className="segmented" role="group" aria-label="نوع سفارش">
            <button type="button" className={mode === 'COUNTER_TABLE' ? 'is-active' : ''} onClick={() => setMode('COUNTER_TABLE')}>
              سر میز
            </button>
            <button type="button" className={mode === 'COUNTER_PICKUP' ? 'is-active' : ''} onClick={() => setMode('COUNTER_PICKUP')}>
              بیرون‌بر
            </button>
          </div>
        )}

        <div className="counter-scroll">
          {lines.length === 0 ? (
            <Empty icon={ShoppingBasket} title="سفارش خالی است">از منو انتخاب کنید.</Empty>
          ) : (
            <ul className="item-rows">
              {lines.map((l) => (
                <li key={l.menuItemId} className="item-row cart-row">
                  <div className="item-main">
                    <span className="item-name">{l.name}</span>
                    <span className="item-sub muted">
                      {money(l.price * l.quantity)} · {l.stationName}
                    </span>
                  </div>
                  <div className="item-actions">
                    <Stepper
                      value={l.quantity}
                      min={0}
                      onChange={(qty) => setLines((ls) => (qty <= 0 ? ls.filter((x) => x !== l) : ls.map((x) => (x === l ? { ...x, quantity: qty } : x))))}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {mode === 'COUNTER_TABLE' && (
            <Field label="میز" hint="اگر مهمان هنوز ننشسته، خالی بگذارید؛ بعداً میز را وصل کنید">
              <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
                <option value="">بدون میز — بعداً مشخص می‌شود</option>
                {freeTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({faNumber(t.capacity)} نفره{t.area ? ` · ${t.area}` : ''})
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="نام مشتری (اختیاری)" hint={mode === 'COUNTER_PICKUP' ? 'برای صدا زدن هنگام آماده شدن' : undefined}>
            <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={60} placeholder="مثلاً رضا" />
          </Field>
        </div>

        <footer className="counter-foot">
          <div className="ticket-total">
            <span>
              <Users size={18} aria-hidden /> {faNumber(count)} آیتم
            </span>
            <strong>{money(total)}</strong>
          </div>

          <div className="method-picker" role="radiogroup" aria-label="روش پرداخت">
            {['CASH', 'CARD', 'OTHER'].map((m) => {
              const Icon = METHOD_ICON[m];
              return (
                <button key={m} type="button" role="radio" aria-checked={method === m} className={`method-btn ${method === m ? 'is-active' : ''}`} onClick={() => setMethod(m)}>
                  <Icon size={24} aria-hidden />
                  {PAYMENT_METHOD_LABEL[m]}
                </button>
              );
            })}
          </div>

          {method === 'CASH' ? (
            <>
              <Field label="وجه نقد دریافتی" hint="خالی = مبلغ دقیق">
                <input className="amount-input" dir="ltr" inputMode="numeric" value={receivedText} placeholder={minorToInput(total, decimals)} onChange={(e) => setReceivedText(e.target.value)} aria-label="وجه نقد دریافتی" />
              </Field>
              {total > 0 && (
                <div className="quick-cash">
                  <button type="button" className="chip chip-lg" onClick={() => setReceivedText(minorToInput(total, decimals))}>
                    مبلغ دقیق
                  </button>
                  {quickCash.map((v) => (
                    <button key={v} type="button" className="chip chip-lg" onClick={() => setReceivedText(minorToInput(v, decimals))}>
                      {money(v)}
                    </button>
                  ))}
                </div>
              )}
              {change > 0 && (
                <div className="change-box">
                  <span>باقی پول مشتری</span>
                  <span>{money(change)}</span>
                </div>
              )}
            </>
          ) : (
            <Field label="شماره پیگیری / مرجع (اختیاری)">
              <input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
            </Field>
          )}

          <div className="button-row">
            <button type="button" className="btn btn-ghost" onClick={reset} disabled={busy || lines.length === 0}>
              <Trash2 size={18} /> پاک کردن
            </button>
            <button type="submit" className="btn btn-primary btn-xl" disabled={busy || !!error}>
              <Banknote size={22} /> دریافت وجه و ارسال {total > 0 ? `· ${money(total)}` : ''}
            </button>
          </div>
          {error && lines.length > 0 && <p className="field-error">{error}</p>}
        </footer>
      </section>
    </form>
  );
}
