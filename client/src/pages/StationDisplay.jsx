import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCheck, ChefHat, Flame, GlassWater, KeyRound, LogOut, Play, Undo2, Volume2, VolumeX } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { chime, unlockAudio, useAction, useLiveQuery, useNow } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { faDigits, faNumber, formatElapsed, formatTime, orderNo } from '../lib/format.js';
import { ConnectionDot } from '../components/Layout.jsx';
import { ErrorBlock, LoadingBlock } from '../components/ui.jsx';
import AccountDialog from '../components/AccountDialog.jsx';

const LANES = [
  { key: 'NEW', title: 'جدید', action: { to: 'PREPARING', label: 'شروع', icon: Play, className: 'btn-kds-start' } },
  { key: 'PREPARING', title: 'در حال آماده‌سازی', action: { to: 'READY', label: 'آماده شد', icon: Flame, className: 'btn-kds-ready' } },
  { key: 'READY', title: 'آماده تحویل', action: { to: 'DELIVERED', label: 'تحویل شد', icon: CheckCheck, className: 'btn-kds-done' } },
];

const NEXT = { PENDING: 'PREPARING', PREPARING: 'READY', READY: 'DELIVERED' };
const PREV = { PREPARING: 'PENDING', READY: 'PREPARING' };
const KDS_STATUS = { PENDING: 'جدید', PREPARING: 'آماده‌سازی', READY: 'آماده', DELIVERED: 'تحویل‌شده', CANCELLED: 'لغوشده' };
const NEXT_LABEL = { PREPARING: 'شروع آماده‌سازی', READY: 'علامت آماده' };

export default function StationDisplay() {
  const stationId = Number(useParams().stationId);
  const { user, stations, restaurant, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [run, busy] = useAction(toast);
  const [lane, setLane] = useState('NEW');
  const [sound, setSound] = useState(() => localStorage.getItem('rms-kds-sound') !== 'off');
  const [accountOpen, setAccountOpen] = useState(false);
  const now = useNow(1000);
  const known = useRef(null);

  const { data, error, loading, reload } = useLiveQuery(() => api.get(`/stations/${stationId}/tickets`), [stationId], {
    events: ['station:changed'],
    filter: (p) => p?.stationId === stationId,
    intervalMs: 30_000,
  });

  // Chime when a ticket we have not seen before arrives.
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.tickets.map((t) => t.batchId));
    if (known.current && sound && data.tickets.some((t) => !known.current.has(t.batchId) && t.lane === 'NEW')) chime('new');
    known.current = ids;
  }, [data, sound]);

  useEffect(() => {
    known.current = null;
  }, [stationId]);

  useEffect(() => {
    try {
      localStorage.setItem('rms-kds-sound', sound ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, [sound]);

  const offset = data ? new Date(data.serverTime).getTime() - Date.now() : 0;
  const warnMs = (restaurant?.kdsWarnMinutes ?? 10) * 60_000;
  const lateMs = (restaurant?.kdsLateMinutes ?? 20) * 60_000;

  const act = (fn) =>
    run(async () => {
      try {
        await fn();
      } finally {
        await reload();
      }
    });

  const advanceTicket = (ticket, to) => act(() => api.post(`/stations/${stationId}/tickets/${ticket.batchId}/advance`, { to }));
  const moveItem = (item, to) => act(() => api.post(`/order-items/${item.id}/status`, { from: item.status, to }));

  const isStationRole = user.roleCode === 'KITCHEN' || user.roleCode === 'BAR';

  return (
    <div className="kds" onPointerDown={unlockAudio}>
      <header className="kds-bar">
        <div className="kds-bar-left">
          {!isStationRole && (
            <Link to="/dashboard" className="kds-icon" aria-label="بازگشت به داشبورد">
              <ArrowRight size={24} />
            </Link>
          )}
          {data?.station.roleCode === 'BAR' ? <GlassWater size={26} aria-hidden /> : <ChefHat size={26} aria-hidden />}
          {stations.length > 1 ? (
            <select className="kds-select" value={stationId} onChange={(e) => navigate(`/station/${e.target.value}`)} aria-label="ایستگاه">
              {stations.filter((s) => !s.autoReady).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <h1>{data?.station.name ?? 'ایستگاه'}</h1>
          )}
        </div>
        <div className="kds-counts">
          {LANES.map((l) => (
            <button key={l.key} type="button" className={`kds-count lane-${l.key.toLowerCase()} ${lane === l.key ? 'is-active' : ''}`} onClick={() => setLane(l.key)}>
              {l.title} <b>{faNumber(data?.counts[l.key] ?? 0)}</b>
            </button>
          ))}
        </div>
        <div className="kds-bar-right">
          <span className="kds-clock">{formatTime(new Date(now + offset).toISOString(), restaurant?.timezone)}</span>
          <ConnectionDot />
          <button type="button" className="kds-icon" onClick={() => setSound((s) => !s)} aria-label={sound ? 'قطع صدای فیش جدید' : 'پخش صدای فیش جدید'} title="صدای فیش جدید">
            {sound ? <Volume2 size={24} /> : <VolumeX size={24} />}
          </button>
          {isStationRole && (
            <>
              <button type="button" className="kds-icon" onClick={() => setAccountOpen(true)} aria-label="حساب کاربری" title={user.name}>
                <KeyRound size={22} />
              </button>
              <button type="button" className="kds-icon" onClick={async () => { await logout(); navigate('/login'); }} aria-label="خروج" title="خروج">
                <LogOut size={22} className="flip-rtl" />
              </button>
            </>
          )}
        </div>
      </header>

      {error && !data && <ErrorBlock error={error} onRetry={reload} />}
      {loading && !data && <LoadingBlock />}

      {data && (
        <div className="kds-board" data-lane={lane}>
          {LANES.map((l) => {
            const tickets = data.tickets.filter((t) => t.lane === l.key);
            return (
              <section key={l.key} className={`kds-lane lane-${l.key.toLowerCase()} ${lane === l.key ? 'is-current' : ''}`} aria-label={l.title}>
                <h2 className="kds-lane-title">
                  {l.title} <span>{faNumber(tickets.length)}</span>
                </h2>
                <div className="kds-cards">
                  {tickets.length === 0 && <p className="kds-empty">فیشی وجود ندارد</p>}
                  {tickets.map((t) => {
                    const waited = now + offset - new Date(t.submittedAt).getTime();
                    const urgency = l.key === 'READY' ? '' : waited >= lateMs ? 'is-late' : waited >= warnMs ? 'is-warn' : '';
                    const Icon = l.action.icon;
                    const notes = t.items.filter((i) => i.note && i.status !== 'CANCELLED');
                    return (
                      <article key={t.batchId} className={`kds-card ${urgency}`}>
                        <header className="kds-card-head">
                          <div>
                            <div className="kds-table">
                              {t.tableName}
                              {t.serviceMode !== 'TABLE' && <span className="kds-mode">{t.customerName || 'پیشخوان'}</span>}
                            </div>
                            <div className="kds-order">
                              سفارش {orderNo(t.orderNumber)}
                              {t.batchNo > 1 && <span className="kds-round">مرحله {faDigits(t.batchNo)}</span>}
                            </div>
                          </div>
                          <div className="kds-timer">
                            <span>{l.key === 'READY' ? 'آماده از' : 'انتظار'}</span>
                            <b>{formatElapsed(l.key === 'READY' && t.readyAt ? now + offset - new Date(t.readyAt).getTime() : waited)}</b>
                            <small>
                              {formatTime(t.submittedAt, restaurant?.timezone)} · {t.waiterName}
                            </small>
                          </div>
                        </header>

                        <ul className="kds-items">
                          {t.items.map((i) => {
                            const next = NEXT[i.status];
                            const tappable = next && i.status !== 'READY' && i.status !== 'CANCELLED' && i.status !== 'DELIVERED';
                            return (
                              <li key={i.id} className={`kds-item ist-${i.status.toLowerCase()}`}>
                                <button type="button" className="kds-item-main" disabled={!tappable || busy} onClick={() => moveItem(i, next)} title={tappable ? NEXT_LABEL[next] : undefined}>
                                  <span className="kds-qty">{faDigits(i.quantity)}×</span>
                                  <span className="kds-name">
                                    {i.name}
                                    {i.note && <span className="kds-note">{i.note}</span>}
                                  </span>
                                  <span className="kds-item-status">{KDS_STATUS[i.status]}</span>
                                </button>
                                {PREV[i.status] && (
                                  <button type="button" className="kds-undo" disabled={busy} onClick={() => moveItem(i, PREV[i.status])} aria-label={`برگرداندن ${i.name}`} title="برگرداندن">
                                    <Undo2 size={18} />
                                  </button>
                                )}
                              </li>
                            );
                          })}
                        </ul>

                        {notes.length > 0 && (
                          <div className="kds-instructions">
                            <b>دستورات ویژه</b>
                            {notes.map((i) => (
                              <span key={i.id}>
                                {i.name}: {i.note}
                              </span>
                            ))}
                          </div>
                        )}
                        {t.orderNote && <div className="kds-instructions">{t.orderNote}</div>}

                        <button type="button" className={`btn-kds ${l.action.className}`} disabled={busy} onClick={() => advanceTicket(t, l.action.to)}>
                          <Icon size={26} /> {l.action.label}
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
