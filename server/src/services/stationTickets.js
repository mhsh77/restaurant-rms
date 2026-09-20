import { q, nowIso } from '../db/connection.js';
import { worksStation } from '../auth/session.js';
import { SERVICE_MODE_FA, placeLabel } from './labels.js';
import { notFound } from '../http/errors.js';
import { toStationDto } from './stations.js';

/**
 * Tickets for one station display. A ticket is one submitted round (batch) of one order,
 * limited to the items routed to this station. Other stations' items are never returned.
 *
 * Lane: NEW (nothing started) → PREPARING (something started) → READY (all done, awaiting pickup).
 * A ticket disappears once none of its items is pending, preparing or ready.
 */
export function getStationTickets(actor, stationId) {
  const station = q.get('SELECT s.*, r.code AS role_code FROM stations s LEFT JOIN roles r ON r.id = s.role_id WHERE s.id = ? AND s.restaurant_id = ?', stationId, actor.restaurantId);
  if (!station || !station.is_active || !worksStation(actor, stationId)) throw notFound('ایستگاه یافت نشد');

  const rows = q.all(
    `SELECT oi.id, oi.batch_id, oi.item_name, oi.quantity, oi.note, oi.status, oi.version,
            oi.submitted_at, oi.started_at, oi.ready_at, oi.cancel_reason,
            b.batch_no, b.submitted_at AS batch_submitted_at,
            o.id AS order_id, o.order_number, o.guest_count, o.note AS order_note,
            o.service_mode, o.customer_name, t.name AS table_name, w.name AS waiter_name
       FROM order_items oi
       JOIN order_batches b ON b.id = oi.batch_id
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN dining_tables t ON t.id = o.table_id
       JOIN users w ON w.id = o.waiter_id
      WHERE oi.station_id = ?
        AND o.restaurant_id = ?
        AND o.lifecycle = 'ACTIVE'
        AND oi.batch_id IN (
              SELECT DISTINCT batch_id FROM order_items
               WHERE station_id = ? AND status IN ('PENDING','PREPARING','READY'))
      ORDER BY b.submitted_at, oi.id`,
    stationId,
    actor.restaurantId,
    stationId,
  );

  const tickets = new Map();
  for (const r of rows) {
    if (!tickets.has(r.batch_id)) {
      tickets.set(r.batch_id, {
        batchId: r.batch_id,
        batchNo: r.batch_no,
        orderId: r.order_id,
        orderNumber: r.order_number,
        tableName: placeLabel(r),
        serviceMode: r.service_mode,
        serviceModeLabel: SERVICE_MODE_FA[r.service_mode],
        customerName: r.customer_name,
        waiterName: r.waiter_name,
        guestCount: r.guest_count,
        orderNote: r.order_note,
        submittedAt: r.batch_submitted_at,
        items: [],
      });
    }
    tickets.get(r.batch_id).items.push({
      id: r.id,
      name: r.item_name,
      quantity: r.quantity,
      note: r.note,
      status: r.status,
      version: r.version,
      startedAt: r.started_at,
      readyAt: r.ready_at,
      cancelReason: r.cancel_reason,
    });
  }

  const list = [...tickets.values()].map((t) => {
    // NEW only while nothing on the ticket has been touched; once work started (even if some items
    // were already served) it stays in PREPARING until every open item is ready.
    const active = t.items.filter((i) => i.status !== 'CANCELLED');
    const allPending = active.every((i) => i.status === 'PENDING');
    const openWork = active.some((i) => i.status === 'PENDING' || i.status === 'PREPARING');
    const lane = allPending ? 'NEW' : openWork ? 'PREPARING' : 'READY';
    const readyTimes = active.filter((i) => i.status === 'READY').map((i) => i.readyAt).filter(Boolean).sort();
    return { ...t, lane, readyAt: lane === 'READY' ? readyTimes.at(-1) ?? null : null };
  });

  return {
    station: toStationDto(station),
    serverTime: nowIso(),
    counts: {
      NEW: list.filter((t) => t.lane === 'NEW').length,
      PREPARING: list.filter((t) => t.lane === 'PREPARING').length,
      READY: list.filter((t) => t.lane === 'READY').length,
    },
    tickets: list,
  };
}
