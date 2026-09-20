import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { chime, useAction, useLiveQuery, useNow } from '../lib/hooks.js';
import { useSocketEvent } from '../lib/realtime.jsx';
import { useToast } from '../lib/toast.jsx';
import { faNumber, formatElapsed, orderNo } from '../lib/format.js';

/**
 * Waiter notification centre: items waiting at the pass, grouped by table. A chime and a
 * toast announce newly ready items as they arrive over the socket.
 */
export default function ReadyBell() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const now = useNow(15_000);
  const [run, busy] = useAction(toast);

  const { data, reload } = useLiveQuery(() => api.get('/orders/ready'), [], { events: ['orders:changed', 'items:ready'], intervalMs: 30_000 });
  const groups = data ?? [];
  const mine = groups.filter((g) => g.waiter.id === user.id);
  const sorted = [...mine, ...groups.filter((g) => g.waiter.id !== user.id)];
  const itemCount = groups.reduce((n, g) => n + g.items.length, 0);

  useSocketEvent('items:ready', (p) => {
    chime('ready');
    const who = p.waiterId === user.id ? '' : ' (میز شما نیست)';
    toast.notify(`${p.tableName} · ${faNumber(p.count)} آیتم آماده است${who}`, {
      timeout: 8000,
      onClick: () => navigate(`/tables/${p.tableId}`),
    });
  });

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => panelRef.current && !panelRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div className="bell" ref={panelRef}>
      <button
        type="button"
        className={`icon-btn bell-btn ${itemCount ? 'has-items' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={`${faNumber(itemCount)} آیتم آماده سرو`}
        aria-expanded={open}
      >
        <Bell size={24} />
        {itemCount > 0 && <span className="bell-count">{faNumber(itemCount)}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="آماده سرو">
          <div className="bell-head">
            <strong>آماده سرو</strong>
            <span className="muted">{faNumber(itemCount)} آیتم</span>
          </div>
          {sorted.length === 0 && <p className="muted bell-empty">چیزی در انتظار سرو نیست.</p>}
          {sorted.map((g) => (
            <div key={g.orderId} className={`bell-group ${g.waiter.id === user.id ? 'is-mine' : ''}`}>
              <button
                type="button"
                className="bell-group-main"
                onClick={() => {
                  setOpen(false);
                  navigate(g.table ? `/tables/${g.table.id}` : `/orders/${g.orderId}`);
                }}
              >
                <span className="bell-table">{g.place}</span>
                <span className="muted">
                  {orderNo(g.orderNumber)} · {g.waiter.id === user.id ? 'میز شما' : g.waiter.name} · در انتظار {formatElapsed(now - new Date(g.oldestReadyAt).getTime())}
                </span>
                <span className="bell-items">{g.items.map((i) => `${i.name} ×${faNumber(i.quantity)}`).join('، ')}</span>
              </button>
              <button
                type="button"
                className="btn btn-success btn-sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.post(`/orders/${g.orderId}/deliver-ready`);
                    await reload();
                  }, { success: `${g.table.name}: تحویل داده شد` })
                }
              >
                <CheckCheck size={18} /> تحویل شد
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
