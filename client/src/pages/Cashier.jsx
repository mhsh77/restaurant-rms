import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCheck, CircleCheckBig, Printer, Search, Users, Wallet } from 'lucide-react';
import { api, newRequestId, qs } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useAction, useLiveQuery } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { PAYMENT_METHOD_LABEL, SERVICE_MODE_SHORT, faNumber, formatBusinessDate, formatTime, latinDigits, minorToInput, orderNo, parseMoney } from '../lib/format.js';
import { ConfirmDialog, Empty, ErrorBlock, Field, LoadingBlock, PageHeader, StatusBadge, Stepper } from '../components/ui.jsx';
import { StatTile } from '../components/charts.jsx';
import PaymentList, { METHOD_ICON } from '../components/PaymentList.jsx';
import CounterOrder from '../components/CounterOrder.jsx';
import CounterQueue from '../components/CounterQueue.jsx';
import ReceiptPreview from '../components/ReceiptPreview.jsx';

/**
 * Cashier / register screen: bills waiting for payment, taking payments (cash with change,
 * card terminal, other; split between guests), voiding mistakes, and today's takings.
 */
export default function Cashier() {
  const { money, restaurant } = useAuth();
  const modes = restaurant?.serviceModes ?? { tableService: true, counterTable: false, counterPickup: false };
  const counterOn = modes.counterTable || modes.counterPickup;
  const [tab, setTab] = useState('bills'); // bills | new | queue
  const [view, setView] = useState('due');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchDraft.trim()), 250);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const listQ = useLiveQuery(() => api.get(`/cashier/orders${qs({ view, q: latinDigits(search) })}`), [view, search], {
    events: ['orders:changed'],
    intervalMs: 30_000,
  });
  const summaryQ = useLiveQuery(() => api.get('/cashier/summary'), [], { events: ['orders:changed'], intervalMs: 60_000 });
  const orderQ = useLiveQuery(() => (selectedId ? api.get(`/orders/${selectedId}`) : Promise.resolve(null)), [selectedId], {
    events: ['orders:changed', 'items:ready'],
    filter: (p) => p?.orderId === selectedId,
    intervalMs: 30_000,
  });

  const s = summaryQ.data;
  const order = orderQ.data && orderQ.data.id === selectedId ? orderQ.data : null;

  /** After a payment / void / completion: show the server's copy, refresh list and totals. */
  const refreshAll = (updatedOrder) => {
    if (updatedOrder) orderQ.setData(updatedOrder);
    else orderQ.reload();
    listQ.reload();
    summaryQ.reload();
  };

  return (
    <div className="page">
      <PageHeader title="صندوق" subtitle={s ? `روز کاری ${formatBusinessDate(s.businessDate, { weekday: 'long', day: 'numeric', month: 'long' })}` : ' '} />

      {counterOn && (
        <div className="segmented segmented-page" role="tablist" aria-label="بخش‌های صندوق">
          <button type="button" role="tab" aria-selected={tab === 'bills'} className={tab === 'bills' ? 'is-active' : ''} onClick={() => setTab('bills')}>
            صورتحساب‌ها
          </button>
          <button type="button" role="tab" aria-selected={tab === 'new'} className={tab === 'new' ? 'is-active' : ''} onClick={() => setTab('new')}>
            سفارش جدید در پیشخوان
          </button>
          <button type="button" role="tab" aria-selected={tab === 'queue'} className={tab === 'queue' ? 'is-active' : ''} onClick={() => setTab('queue')}>
            صف پیشخوان
          </button>
        </div>
      )}

      {counterOn && tab === 'new' && <CounterOrder modes={modes} onDone={() => { listQ.reload(); summaryQ.reload(); }} />}
      {counterOn && tab === 'queue' && (
        <div className="card">
          <CounterQueue />
        </div>
      )}

      {s && (
        <div className="stats">
          <StatTile hero label="دریافتی امروز" value={money(s.collected)} sub={`${faNumber(s.paidOrders)} سفارش · ${faNumber(s.paymentCount)} پرداخت`} />
          {s.byMethod.map((m) => (
            <StatTile
              key={m.method}
              label={PAYMENT_METHOD_LABEL[m.method]}
              value={money(m.amount)}
              sub={m.method === 'CASH' && s.changeGiven > 0 ? `${faNumber(m.count)} پرداخت · باقی داده‌شده ${money(s.changeGiven)}` : `${faNumber(m.count)} پرداخت`}
            />
          ))}
          <StatTile
            label="در انتظار پرداخت"
            value={money(s.due.amount)}
            sub={[
              `${faNumber(s.due.count)} صورتحساب`,
              s.overpaid.count ? `${faNumber(s.overpaid.count)} اضافه پرداخت` : null,
              s.voided.count ? `${faNumber(s.voided.count)} ابطال امروز` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          />
        </div>
      )}

      <div className="cashier" data-selected={selectedId ? 'true' : 'false'} hidden={counterOn && tab !== 'bills'}>
        <aside className="cashier-list card" aria-label="صورتحساب‌ها">
          <div className="segmented" role="tablist">
            <button type="button" role="tab" aria-selected={view === 'due'} className={view === 'due' ? 'is-active' : ''} onClick={() => setView('due')}>
              در انتظار پرداخت {s ? `(${faNumber(s.due.count + s.overpaid.count)})` : ''}
            </button>
            <button type="button" role="tab" aria-selected={view === 'paid'} className={view === 'paid' ? 'is-active' : ''} onClick={() => setView('paid')}>
              تسویه‌شده امروز
            </button>
          </div>
          <label className="search">
            <Search size={20} aria-hidden />
            <input type="search" placeholder="شماره سفارش، میز یا گارسون" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} aria-label="جستجوی صورتحساب" />
          </label>
          {listQ.error && !listQ.data && <ErrorBlock error={listQ.error} onRetry={listQ.reload} />}
          {listQ.loading && !listQ.data && <LoadingBlock />}
          {listQ.data && listQ.data.length === 0 && (
            <Empty icon={CheckCheck} title={view === 'due' ? 'صورتحسابی در انتظار پرداخت نیست' : 'امروز هنوز صورتحسابی تسویه نشده است'} />
          )}
          <div className="bill-rows">
            {(listQ.data ?? []).map((o) => (
              <BillRow key={o.id} bill={o} active={o.id === selectedId} onSelect={() => setSelectedId(o.id)} />
            ))}
          </div>
        </aside>

        <section className="cashier-bill" aria-label="صورتحساب">
          {!selectedId && (
            <div className="card">
              <Empty icon={Wallet} title="یک صورتحساب را انتخاب کنید">
                سفارش‌های سروشده که هنوز پرداخت نشده‌اند در فهرست نمایش داده می‌شوند.
              </Empty>
            </div>
          )}
          {selectedId && !order && (orderQ.error ? <ErrorBlock error={orderQ.error} onRetry={orderQ.reload} /> : <LoadingBlock />)}
          {order && <BillPanel key={order.id} order={order} onBack={() => setSelectedId(null)} onChanged={refreshAll} />}
        </section>
      </div>
    </div>
  );
}

function BillRow({ bill, active, onSelect }) {
  const { money } = useAuth();
  const state =
    bill.openItems > 0 ? `${faNumber(bill.openItems)} آیتم در حال سرو` : bill.lifecycle === 'COMPLETED' ? 'سفارش تکمیل‌شده' : 'سرو کامل';
  return (
    <button type="button" className={`bill-row ${active ? 'is-active' : ''}`} onClick={onSelect} aria-pressed={active}>
      <span className="bill-row-top">
        <b>{bill.place}</b>
        {bill.serviceMode !== 'TABLE' && <span className="badge st-pending mode-badge">{SERVICE_MODE_SHORT[bill.serviceMode]}</span>}
        <StatusBadge kind="payment" status={bill.paymentStatus} />
      </span>
      <span className="muted small">
        {orderNo(bill.orderNumber)} · {bill.waiter.name} · {state}
      </span>
      <span className="bill-row-amounts">
        <span className="muted">جمع {money(bill.total)}</span>
        <strong className={bill.remaining < 0 ? 'danger-text' : ''}>
          {bill.remaining > 0 ? `مانده ${money(bill.remaining)}` : bill.remaining < 0 ? `اضافه ${money(-bill.remaining)}` : 'تسویه‌شده'}
        </strong>
      </span>
    </button>
  );
}

function BillPanel({ order, onBack, onChanged }) {
  const { money, restaurant } = useAuth();
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('');
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [lastChange, setLastChange] = useState(0);
  const tz = restaurant?.timezone;

  const lines = useMemo(() => {
    const map = new Map();
    for (const batch of order.batches) {
      for (const item of batch.items) {
        if (item.status === 'CANCELLED') continue;
        const key = `${item.menuItemId}|${item.unitPrice}`;
        const line = map.get(key) ?? { key, name: item.name, unitPrice: item.unitPrice, quantity: 0, lineTotal: 0 };
        line.quantity += item.quantity;
        line.lineTotal += item.lineTotal;
        map.set(key, line);
      }
    }
    return [...map.values()];
  }, [order]);

  const openItems = order.counts.PENDING + order.counts.PREPARING + order.counts.READY;
  const settled = order.remaining === 0 && order.total > 0;

  return (
    <div className="card bill">
      <div className="bill-head">
        <button type="button" className="btn btn-ghost btn-sm bill-back" onClick={onBack}>
          <ArrowRight size={18} /> فهرست
        </button>
        <div className="bill-title">
          <h2>
            {order.place} · سفارش {orderNo(order.orderNumber)}
          </h2>
          <span className="muted">
            {order.waiter.name} · {faNumber(order.guestCount)} مهمان · ثبت {formatTime(order.openedAt, tz)}
          </span>
        </div>
        <div className="button-row">
          <StatusBadge kind="order" status={order.status} />
          <StatusBadge kind="payment" status={order.paymentStatus} />
        </div>
      </div>

      {order.lifecycle === 'CANCELLED' && <p className="notice notice-danger">این سفارش لغو شده است.</p>}
      {openItems > 0 && order.lifecycle === 'ACTIVE' && (
        <p className="notice notice-info">{faNumber(openItems)} آیتم هنوز سرو نشده است. پرداخت ممکن است، اما تکمیل سفارش پس از سرو انجام می‌شود.</p>
      )}

      <div className="table-wrap">
        <table className="bill-lines">
          <tbody>
            {lines.map((l) => (
              <tr key={l.key}>
                <td>{l.name}</td>
                <td className="muted nowrap">
                  {faNumber(l.quantity)} × {money(l.unitPrice)}
                </td>
                <td className="num">
                  <b>{money(l.lineTotal)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bill-totals">
        <div className="grand">
          <span>جمع کل</span>
          <span>{money(order.total)}</span>
        </div>
        <div>
          <span>پرداخت‌شده</span>
          <span>{money(order.paidAmount)}</span>
        </div>
        {order.remaining > 0 && (
          <div className="due">
            <span>مانده</span>
            <span>{money(order.remaining)}</span>
          </div>
        )}
        {order.remaining < 0 && (
          <div className="due danger-text">
            <span>اضافه پرداخت</span>
            <span>{money(-order.remaining)}</span>
          </div>
        )}
      </div>

      {lastChange > 0 && (
        <div className="change-box" role="status">
          <span>باقی پول مشتری</span>
          <span>{money(lastChange)}</span>
        </div>
      )}

      {order.remaining < 0 && (
        <p className="notice notice-danger">
          مبلغ پرداختی از صورتحساب بیشتر است (معمولاً چون آیتمی پس از پرداخت لغو شده). پرداخت نادرست را باطل کنید، وجه را به مشتری برگردانید و مبلغ صحیح را ثبت کنید.
        </p>
      )}

      <h3>پرداخت‌ها</h3>
      <PaymentList
        payments={order.payments}
        busy={busy}
        onVoid={(p) => {
          setVoidReason('');
          setVoidTarget(p);
        }}
      />

      {order.remaining > 0 && order.lifecycle !== 'CANCELLED' && (
        <PaymentForm
          order={order}
          onPaid={(res) => {
            setLastChange(res.change ?? 0);
            onChanged(res.order);
          }}
        />
      )}

      {settled && order.lifecycle === 'ACTIVE' && (
        <div className="notice notice-success settle-box">
          <span>
            <CircleCheckBig size={20} aria-hidden /> صورتحساب تسویه شد.
          </span>
          {order.canComplete ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => run(async () => onChanged(await api.post(`/orders/${order.id}/complete`)), { success: `سفارش ${orderNo(order.orderNumber)} تکمیل شد` })}
            >
              تکمیل سفارش
            </button>
          ) : (
            <span className="small">{order.completeBlockedReason}</span>
          )}
        </div>
      )}
      {settled && order.lifecycle === 'COMPLETED' && <p className="notice notice-success">صورتحساب تسویه و سفارش تکمیل شده است.</p>}

      <div className="button-row">
        <button type="button" className="btn btn-ghost btn-lg" onClick={() => setReceiptOpen(true)}>
          <Printer size={20} /> فیش
        </button>
      </div>
      <ReceiptPreview orderId={order.id} open={receiptOpen} onClose={() => setReceiptOpen(false)} />

      <ConfirmDialog
        open={!!voidTarget}
        danger
        busy={busy}
        title="ابطال پرداخت"
        confirmLabel="ابطال پرداخت"
        onClose={() => setVoidTarget(null)}
        onConfirm={() => {
          if (!voidReason.trim()) return toast.error('دلیل ابطال را وارد کنید');
          const target = voidTarget;
          return run(async () => {
            try {
              const res = await api.post(`/payments/${target.id}/void`, { reason: voidReason.trim() });
              setVoidTarget(null);
              setLastChange(0);
              onChanged(res.order);
            } catch (err) {
              onChanged(null);
              throw err;
            }
          }, { success: 'پرداخت باطل شد' });
        }}
      >
        {voidTarget && (
          <>
            <p>
              پرداخت <b>{money(voidTarget.amount)}</b> ({PAYMENT_METHOD_LABEL[voidTarget.method]}) باطل شود؟ اگر وجه دریافت شده است، آن را به مشتری برگردانید.
            </p>
            <Field label="دلیل ابطال">
              <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={200} autoFocus placeholder="مثلاً مبلغ اشتباه وارد شد" />
            </Field>
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}

function PaymentForm({ order, onPaid }) {
  const { money, restaurant } = useAuth();
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const decimals = restaurant?.currencyDecimals ?? 0;
  const [method, setMethod] = useState('CASH');
  const [amountText, setAmountText] = useState(() => minorToInput(order.remaining, decimals));
  const [receivedText, setReceivedText] = useState('');
  const [reference, setReference] = useState('');
  const [split, setSplit] = useState(1);
  const [completeAfter, setCompleteAfter] = useState(true);
  // One id per intended payment: a double tap or a retry after a network error is recorded once.
  const [requestId, setRequestId] = useState(newRequestId);

  useEffect(() => {
    setAmountText(minorToInput(order.remaining, decimals));
    setReceivedText('');
    setSplit(1);
  }, [order.remaining, decimals]);

  const amount = parseMoney(amountText, decimals);
  const received = method === 'CASH' ? (receivedText.trim() ? parseMoney(receivedText, decimals) : amount) : null;
  const change = method === 'CASH' && amount !== null && received !== null ? received - amount : 0;
  const error =
    amount === null || amount <= 0
      ? 'مبلغ معتبر وارد کنید'
      : amount > order.remaining
        ? `مبلغ نمی‌تواند بیشتر از مانده صورتحساب (${money(order.remaining)}) باشد`
        : method === 'CASH' && (received === null || received < amount)
          ? 'وجه نقد دریافتی کمتر از مبلغ پرداخت است'
          : null;

  const openItems = order.counts.PENDING + order.counts.PREPARING + order.counts.READY;
  const settles = amount === order.remaining;
  const canCompleteNow = order.lifecycle === 'ACTIVE' && openItems === 0 && order.counts.DELIVERED > 0;
  const steps = decimals === 0 ? [50_000, 100_000, 500_000, 1_000_000] : [500, 1_000, 2_000, 5_000];
  const quickCash = amount > 0 ? [...new Set(steps.map((step) => Math.ceil(amount / step) * step))].filter((v) => v > amount).slice(0, 3) : [];
  const share = Math.ceil(order.remaining / split);

  const submit = (e) => {
    e.preventDefault();
    if (error) return toast.error(error);
    return run(async () => {
      try {
        const res = await api.post(`/orders/${order.id}/payments`, {
          clientRequestId: requestId,
          method,
          amount,
          ...(method === 'CASH' ? { receivedAmount: received } : {}),
          ...(method !== 'CASH' && reference.trim() ? { reference: reference.trim() } : {}),
          completeOrder: settles && canCompleteNow && completeAfter,
        });
        setRequestId(newRequestId());
        setReference('');
        toast.success(`پرداخت ${money(amount)} (${PAYMENT_METHOD_LABEL[method]}) ثبت شد${res.completed ? ' · سفارش تکمیل شد' : ''}`);
        onPaid(res);
      } catch (err) {
        // Someone else changed the bill (another payment, an added item): show the fresh state.
        if (err.status === 409) onPaid({ change: 0, order: null });
        throw err;
      }
    });
  };

  return (
    <form className="pay-form" onSubmit={submit}>
      <h3>ثبت پرداخت</h3>
      <div className="method-picker" role="radiogroup" aria-label="روش پرداخت">
        {['CASH', 'CARD', 'OTHER'].map((m) => {
          const Icon = METHOD_ICON[m];
          return (
            <button key={m} type="button" role="radio" aria-checked={method === m} className={`method-btn ${method === m ? 'is-active' : ''}`} onClick={() => setMethod(m)}>
              <Icon size={26} aria-hidden />
              {PAYMENT_METHOD_LABEL[m]}
            </button>
          );
        })}
      </div>

      <div className="split-row">
        <span>
          <Users size={18} aria-hidden /> تقسیم بین
        </span>
        <Stepper
          size="sm"
          value={split}
          min={1}
          max={20}
          label="نفر"
          onChange={(n) => {
            setSplit(n);
            setAmountText(minorToInput(Math.min(order.remaining, Math.ceil(order.remaining / n)), decimals));
          }}
        />
        <span className="muted">{split > 1 ? `نفر · سهم هر نفر ${money(share)}` : 'نفر'}</span>
      </div>

      <Field label={`مبلغ این پرداخت (${restaurant?.currencySymbol})`} hint={amount ? money(amount) : undefined}>
        <input className="amount-input" dir="ltr" inputMode="numeric" value={amountText} onChange={(e) => setAmountText(e.target.value)} aria-label="مبلغ پرداخت" />
      </Field>

      {method === 'CASH' && (
        <>
          <Field label="وجه نقد دریافتی از مشتری" hint={receivedText.trim() && received ? money(received) : 'خالی = برابر مبلغ پرداخت'}>
            <input className="amount-input" dir="ltr" inputMode="numeric" value={receivedText} placeholder={amountText} onChange={(e) => setReceivedText(e.target.value)} aria-label="وجه نقد دریافتی" />
          </Field>
          {amount > 0 && (
            <div className="quick-cash">
              <button type="button" className="chip chip-lg" onClick={() => setReceivedText(minorToInput(amount, decimals))}>
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
      )}

      {method !== 'CASH' && (
        <Field label="شماره پیگیری / مرجع (اختیاری)">
          <input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
        </Field>
      )}

      {order.lifecycle === 'ACTIVE' && settles && (
        <label className={`check-row ${canCompleteNow ? '' : 'is-disabled'}`}>
          <input type="checkbox" checked={completeAfter && canCompleteNow} disabled={!canCompleteNow} onChange={(e) => setCompleteAfter(e.target.checked)} />
          پس از تسویه، سفارش تکمیل شود
          {!canCompleteNow && <span className="muted small">(پس از سرو همه اقلام)</span>}
        </label>
      )}

      {error && amountText && <p className="field-error">{error}</p>}
      <button type="submit" className="btn btn-primary btn-xl btn-block" disabled={busy || !!error}>
        ثبت پرداخت {amount ? money(amount) : ''}
      </button>
    </form>
  );
}
