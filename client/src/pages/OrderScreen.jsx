import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Ban, CheckCheck, CircleCheckBig, MessageSquarePlus, Pencil, Receipt, Search, Send, ShoppingBasket, Trash2, Users } from 'lucide-react';
import { api, newRequestId } from '../lib/api.js';
import { PERM, useAuth } from '../lib/auth.jsx';
import { useAction, useLiveQuery } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { TABLE_STATUS_LABEL, faDigits, faNumber, orderNo } from '../lib/format.js';
import { ConfirmDialog, Empty, ErrorBlock, Field, ItemThumb, LoadingBlock, Modal, StatusBadge, Stepper } from '../components/ui.jsx';
import OrderItems from '../components/OrderItems.jsx';
import ReceiptPreview from '../components/ReceiptPreview.jsx';

/* ───────────── cart (per order, survives a tablet refresh) ───────────── */

const emptyCart = (key) => ({ key, requestId: newRequestId(), lines: [] });

function loadCart(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved?.lines?.length) return { ...saved, key };
  } catch {
    /* storage unavailable */
  }
  return emptyCart(key);
}

function useCart(orderId) {
  const key = `rms-cart-${orderId ?? 'none'}`;
  const [cart, setCart] = useState(() => loadCart(key));

  useEffect(() => {
    setCart(loadCart(key));
  }, [key]);

  useEffect(() => {
    if (cart.key !== key) return;
    try {
      if (cart.lines.length) localStorage.setItem(key, JSON.stringify(cart));
      else localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }, [cart, key]);

  return {
    cart,
    add(item) {
      setCart((c) => {
        const existing = c.lines.find((l) => l.menuItemId === item.id && !l.note);
        const lines = existing
          ? c.lines.map((l) => (l === existing ? { ...l, quantity: Math.min(999, l.quantity + 1) } : l))
          : [...c.lines, { lineId: newRequestId(), menuItemId: item.id, name: item.name, price: item.price, quantity: 1, note: '' }];
        return { ...c, lines };
      });
    },
    update(lineId, patch) {
      setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)) }));
    },
    remove(lineId) {
      setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.lineId !== lineId) }));
    },
    clear() {
      setCart(emptyCart(key));
    },
  };
}

/* ───────────── screen ───────────── */

export default function OrderScreen() {
  const tableId = Number(useParams().tableId);
  const { money, user, can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [run, busy] = useAction(toast);

  const floor = useLiveQuery(() => api.get('/tables'), [], { events: ['orders:changed', 'tables:changed'], intervalMs: 30_000 });
  const table = floor.data?.find((t) => t.id === tableId);
  const orderId = table?.order?.id ?? null;

  const orderQ = useLiveQuery(() => (orderId ? api.get(`/orders/${orderId}`) : Promise.resolve(null)), [orderId], {
    events: ['orders:changed', 'items:ready'],
    filter: (p) => p?.orderId === orderId || p?.tableId === tableId,
    intervalMs: 45_000,
  });
  const order = orderQ.data && orderQ.data.id === orderId ? orderQ.data : null;

  if (floor.loading && !floor.data) return <LoadingBlock />;
  if (floor.error && !floor.data) return <ErrorBlock error={floor.error} onRetry={floor.reload} />;
  if (!table) return <Empty title="میز یافت نشد">ممکن است مدیر آن را حذف کرده باشد.</Empty>;

  const back = (
    <Link to="/floor" className="btn btn-ghost">
      <ArrowRight size={20} /> میزها
    </Link>
  );

  if (!table.order) {
    return <SeatGuests table={table} back={back} onOpened={() => floor.reload()} />;
  }
  if (!order) return <LoadingBlock />;

  if (order.lifecycle === 'COMPLETED') {
    return (
      <div className="page narrow">
        <div className="page-header">
          {back}
          <h1>
            {table.name} · سفارش {orderNo(order.orderNumber)}
          </h1>
        </div>
        <div className="card center-card">
          <CircleCheckBig size={48} className="text-success" />
          <h2>سفارش تکمیل شد · {money(order.total)}</h2>
          {order.remaining > 0 && (
            <p className="notice notice-warn">مبلغ {money(order.remaining)} از این سفارش هنوز پرداخت نشده است؛ مشتری را به صندوق راهنمایی کنید.</p>
          )}
          <p className="muted">میز را تمیز کنید، سپس آن را برای مهمانان بعدی آزاد کنید.</p>
          <div className="button-row">
            <ReceiptButton orderId={order.id} />
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.post(`/tables/${tableId}/release`);
                  navigate('/floor');
                }, { success: `${table.name} آزاد شد` })
              }
            >
              میز تمیز شد — آزاد کن
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ActiveOrder
      key={order.id}
      table={table}
      order={order}
      back={back}
      reloadOrder={orderQ.reload}
      setOrder={orderQ.setData}
      reloadFloor={floor.reload}
      canWrite={can(PERM.ORDER_WRITE)}
      userId={user.id}
    />
  );
}

function ReceiptButton({ orderId, className = 'btn btn-ghost btn-lg' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Receipt size={20} /> فیش
      </button>
      <ReceiptPreview orderId={orderId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function SeatGuests({ table, back, onOpened }) {
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const [guests, setGuests] = useState(Math.min(2, table.capacity));
  const quick = Array.from({ length: Math.max(8, table.capacity) }, (_, i) => i + 1).slice(0, 12);

  const open = () =>
    run(async () => {
      try {
        await api.post('/orders', { tableId: table.id, guestCount: guests });
      } catch (err) {
        // Someone else opened this table a moment ago: just show their order.
        if (err.status !== 409) throw err;
        toast.notify(err.message);
      }
      await onOpened();
    });

  return (
    <div className="page narrow">
      <div className="page-header">{back}</div>
      <div className="card center-card">
        <h1>{table.name}</h1>
        <p className="muted">
          {TABLE_STATUS_LABEL[table.status]} · {faNumber(table.capacity)} نفره
          {table.area && ` · ${table.area}`}
        </p>
        <h2 className="mt">چند نفر مهمان؟</h2>
        <div className="guest-grid">
          {quick.map((n) => (
            <button key={n} type="button" className={`guest-btn ${guests === n ? 'is-active' : ''}`} onClick={() => setGuests(n)}>
              {faDigits(n)}
            </button>
          ))}
        </div>
        <Stepper value={guests} onChange={setGuests} min={1} max={100} label="مهمان" size="lg" />
        {guests > table.capacity && <p className="field-hint">تعداد مهمان بیشتر از ظرفیت میز ({faNumber(table.capacity)} نفر) است.</p>}
        <button type="button" className="btn btn-primary btn-xl" disabled={busy} onClick={open}>
          <Users size={22} /> نشاندن {faNumber(guests)} مهمان و شروع سفارش
        </button>
      </div>
    </div>
  );
}

function ActiveOrder({ table, order, back, reloadOrder, setOrder, reloadFloor, canWrite }) {
  const { money, user } = useAuth();
  const toast = useToast();
  const [run, busy] = useAction(toast);
  const { cart, add, update, remove, clear } = useCart(order.id);
  const [view, setView] = useState('menu');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(0);
  const [noteLine, setNoteLine] = useState(null);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [guests, setGuests] = useState(order.guestCount);
  const [confirm, setConfirm] = useState(null); // 'complete' | 'cancel'
  const [cancelReason, setCancelReason] = useState('');

  const menuQ = useLiveQuery(() => Promise.all([api.get('/menu/categories'), api.get('/menu/items')]), [], { events: ['menu:changed'], intervalMs: 120_000 });
  const [categories, items] = menuQ.data ?? [[], []];

  const filtered = useMemo(() => {
    const term = search.trim();
    return items.filter((i) => (!category || i.categoryId === category) && (!term || i.name.includes(term) || i.description.includes(term)));
  }, [items, search, category]);

  const cartCount = cart.lines.reduce((n, l) => n + l.quantity, 0);
  const cartTotal = cart.lines.reduce((n, l) => n + l.quantity * l.price, 0);
  const readyCount = order.counts.READY;

  // Presence: tell the floor that someone is composing an order for this table.
  const hasLines = cart.lines.length > 0;
  useEffect(() => {
    if (!hasLines) return undefined;
    const ping = () => api.post(`/orders/${order.id}/ordering`, { active: true }).catch(() => {});
    ping();
    const id = setInterval(ping, 30_000);
    return () => {
      clearInterval(id);
      api.post(`/orders/${order.id}/ordering`, { active: false }).catch(() => {});
    };
  }, [hasLines, order.id]);

  const send = () =>
    run(async () => {
      try {
        const res = await api.post(`/orders/${order.id}/batches`, {
          clientRequestId: cart.requestId,
          items: cart.lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, ...(l.note.trim() ? { note: l.note.trim() } : {}) })),
        });
        clear();
        setOrder(res.order);
        setView('order');
        reloadFloor();
        toast.success(res.duplicate ? 'این سفارش قبلاً ارسال شده بود' : `${faNumber(cartCount)} آیتم ارسال شد · مرحله ${faNumber(res.order.batches.length)}`);
      } catch (err) {
        if (err.status === 409) menuQ.reload();
        throw err;
      }
    });

  const afterAction = async () => {
    await reloadOrder();
    reloadFloor();
  };

  const noteTarget = cart.lines.find((l) => l.lineId === noteLine);

  return (
    <div className="order-screen" data-view={view}>
      {/* ───── Menu ───── */}
      <section className="menu-pane" aria-label="منو">
        <div className="menu-toolbar">
          {back}
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
              const inCart = cart.lines.filter((l) => l.menuItemId === item.id).reduce((n, l) => n + l.quantity, 0);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`menu-tile ${!item.isAvailable ? 'is-unavailable' : ''} ${inCart ? 'in-cart' : ''}`}
                  disabled={!item.isAvailable || !canWrite}
                  onClick={() => add(item)}
                >
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

      {/* ───── Ticket ───── */}
      <section className="ticket-pane" aria-label="سفارش">
        <header className="ticket-head">
          <div>
            <h1>{table.name}</h1>
            <div className="muted">
              سفارش {orderNo(order.orderNumber)} · {order.waiter.id === user.id ? 'میز شما' : order.waiter.name}
            </div>
          </div>
          <div className="ticket-head-right">
            <StatusBadge kind="order" status={order.status} large />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setGuests(order.guestCount); setGuestsOpen(true); }} disabled={!canWrite} aria-label="ویرایش تعداد مهمان">
              <Users size={16} /> {faNumber(order.guestCount)} <Pencil size={14} />
            </button>
          </div>
        </header>

        <div className="ticket-scroll">
          {cart.lines.length > 0 && (
            <div className="cart">
              <div className="cart-head">
                <strong>
                  <ShoppingBasket size={18} /> اقلام جدید (ارسال نشده)
                </strong>
                <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
                  <Trash2 size={16} /> پاک کردن
                </button>
              </div>
              <ul className="item-rows">
                {cart.lines.map((l) => (
                  <li key={l.lineId} className="item-row cart-row">
                    <div className="item-main">
                      <span className="item-name">{l.name}</span>
                      {l.note && <span className="item-note">«{l.note}»</span>}
                      <span className="item-sub muted">{money(l.price * l.quantity)}</span>
                    </div>
                    <div className="item-actions">
                      <button type="button" className={`icon-btn ${l.note ? 'is-on' : ''}`} onClick={() => setNoteLine(l.lineId)} aria-label={`توضیح برای ${l.name}`} title="افزودن توضیح">
                        <MessageSquarePlus size={20} />
                      </button>
                      <Stepper value={l.quantity} min={0} onChange={(q) => (q <= 0 ? remove(l.lineId) : update(l.lineId, { quantity: q }))} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <OrderItems order={order} editable={order.lifecycle === 'ACTIVE'} onChanged={afterAction} />
        </div>

        <footer className="ticket-foot">
          {cart.lines.length > 0 ? (
            <button type="button" className="btn btn-primary btn-xl btn-block" disabled={busy || !canWrite} onClick={send}>
              <Send size={22} className="flip-rtl" /> ارسال {faNumber(cartCount)} آیتم · {money(cartTotal)}
            </button>
          ) : (
            <>
              <div className="ticket-total">
                <span>جمع کل</span>
                <strong>{money(order.total)}</strong>
              </div>
              {(order.paidAmount > 0 || order.paymentRequired) && (
                <div className="ticket-payment">
                  <StatusBadge kind="payment" status={order.paymentStatus} />
                  <span className="muted">پرداخت‌شده {money(order.paidAmount)}</span>
                  {order.remaining !== 0 && <b>{order.remaining > 0 ? `مانده ${money(order.remaining)}` : `اضافه پرداخت ${money(-order.remaining)}`}</b>}
                </div>
              )}
              <div className="button-row">
                {readyCount > 0 && (
                  <button type="button" className="btn btn-success btn-lg" disabled={busy} onClick={() => run(async () => { await api.post(`/orders/${order.id}/deliver-ready`); await afterAction(); }, { success: 'تحویل داده شد' })}>
                    <CheckCheck size={20} /> تحویل آماده‌ها ({faNumber(readyCount)})
                  </button>
                )}
                <ReceiptButton orderId={order.id} />
                <button type="button" className="btn btn-primary btn-lg" disabled={busy || !order.canComplete} onClick={() => setConfirm('complete')} title={order.completeBlockedReason ?? ''}>
                  <CircleCheckBig size={20} /> تکمیل
                </button>
                <button type="button" className="btn btn-ghost btn-lg danger-text" disabled={busy} onClick={() => { setCancelReason(''); setConfirm('cancel'); }}>
                  <Ban size={20} /> لغو سفارش
                </button>
              </div>
              {!order.canComplete && readyCount + order.counts.PENDING + order.counts.PREPARING === 0 && order.completeBlockedReason && (
                <p className="notice notice-warn">{order.completeBlockedReason}</p>
              )}
            </>
          )}
        </footer>
      </section>

      {/* ───── Mobile pane switch ───── */}
      <nav className="pane-switch" aria-label="تغییر نما">
        <button type="button" className={view === 'menu' ? 'is-active' : ''} onClick={() => setView('menu')}>
          منو
        </button>
        <button type="button" className={view === 'order' ? 'is-active' : ''} onClick={() => setView('order')}>
          سفارش {cartCount > 0 && <span className="pill">{faNumber(cartCount)} جدید</span>}
          {readyCount > 0 && <span className="pill pill-success">{faNumber(readyCount)} آماده</span>}
        </button>
      </nav>

      <Modal
        open={!!noteTarget}
        onClose={() => setNoteLine(null)}
        title={noteTarget ? `توضیح · ${noteTarget.name}` : ''}
        size="sm"
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setNoteLine(null)}>
            تأیید
          </button>
        }
      >
        {noteTarget && (
          <>
            <Field label="توضیحات برای آشپزخانه / بار">
              <textarea rows={3} maxLength={200} autoFocus value={noteTarget.note} onChange={(e) => update(noteTarget.lineId, { note: e.target.value })} placeholder="مثلاً یکی بدون پیاز" />
            </Field>
            <div className="chips">
              {['بدون پیاز', 'شیر بیشتر', 'بدون یخ', 'خوب پخته', 'تند', 'حساسیت به آجیل', 'بعداً سرو شود'].map((s) => (
                <button key={s} type="button" className="chip" onClick={() => update(noteTarget.lineId, { note: noteTarget.note ? `${noteTarget.note}، ${s}` : s })}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={guestsOpen}
        onClose={() => setGuestsOpen(false)}
        title="تعداد مهمان"
        size="sm"
        footer={
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                setOrder(await api.patch(`/orders/${order.id}`, { guestCount: guests, version: order.version }));
                setGuestsOpen(false);
                reloadFloor();
              })
            }
          >
            ذخیره
          </button>
        }
      >
        <Stepper value={guests} onChange={setGuests} min={1} max={100} size="lg" label="مهمان" />
      </Modal>

      <ConfirmDialog
        open={confirm === 'complete'}
        title={`تکمیل سفارش ${orderNo(order.orderNumber)}؟`}
        confirmLabel="تکمیل سفارش"
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          run(async () => {
            setOrder(await api.post(`/orders/${order.id}/complete`));
            setConfirm(null);
            reloadFloor();
          }, { success: `سفارش ${orderNo(order.orderNumber)} تکمیل شد` })
        }
        message={`مبلغ کل ${money(order.total)}. سفارش بسته می‌شود و میز برای تمیز شدن علامت می‌خورد.`}
      />

      <ConfirmDialog
        open={confirm === 'cancel'}
        title={`لغو سفارش ${orderNo(order.orderNumber)}؟`}
        confirmLabel="لغو سفارش"
        danger
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!cancelReason.trim()) return toast.error('دلیل لغو را وارد کنید');
          return run(async () => {
            await api.post(`/orders/${order.id}/cancel`, { reason: cancelReason.trim() });
            setConfirm(null);
            clear();
            await reloadFloor();
          }, { success: 'سفارش لغو شد' });
        }}
      >
        <p>همه اقلامی که تحویل نشده‌اند لغو می‌شوند و میز آزاد می‌شود.</p>
        <Field label="دلیل">
          <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={200} placeholder="مثلاً مهمان‌ها رفتند" autoFocus />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
