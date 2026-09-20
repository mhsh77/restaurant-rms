/**
 * Pure status rules: item state machine, order status derivation, table status derivation.
 * No database access here, so these are trivially unit-testable.
 */
import { ROLES } from '../auth/permissions.js';

export const ITEM = Object.freeze({
  PENDING: 'PENDING',
  PREPARING: 'PREPARING',
  READY: 'READY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
});

export const ORDER = Object.freeze({
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  PARTIALLY_READY: 'PARTIALLY_READY',
  READY: 'READY',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

export const TABLE = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  OCCUPIED: 'OCCUPIED',
  WAITING_FOR_ORDER: 'WAITING_FOR_ORDER',
  ORDERING: 'ORDERING',
  PREPARING: 'PREPARING',
  READY: 'READY',
  COMPLETED: 'COMPLETED',
});

const I = ITEM;
const key = (from, to) => `${from}>${to}`;

const STATION_MOVES = [key(I.PENDING, I.PREPARING), key(I.PREPARING, I.READY), key(I.PREPARING, I.PENDING), key(I.READY, I.PREPARING), key(I.READY, I.DELIVERED)];
const WAITER_MOVES = [key(I.READY, I.DELIVERED), key(I.PENDING, I.CANCELLED)];
const MANAGER_MOVES = [...STATION_MOVES, key(I.PENDING, I.CANCELLED), key(I.PREPARING, I.CANCELLED), key(I.READY, I.CANCELLED)];

/**
 * May `roleCode` move an item from → to?
 * `worksStation` must be true for station roles acting on an item of their own station.
 */
export function canTransition(roleCode, from, to, { worksStation = false } = {}) {
  const k = key(from, to);
  switch (roleCode) {
    case ROLES.MANAGER:
      return MANAGER_MOVES.includes(k);
    case ROLES.WAITER:
      return WAITER_MOVES.includes(k);
    case ROLES.KITCHEN:
    case ROLES.BAR:
      return worksStation && STATION_MOVES.includes(k);
    default:
      return false;
  }
}

/** Timestamp column to stamp when an item enters a status. */
export const STATUS_TIMESTAMP = {
  [I.PREPARING]: 'started_at',
  [I.READY]: 'ready_at',
  [I.DELIVERED]: 'delivered_at',
  [I.CANCELLED]: 'cancelled_at',
};

/** Derive the overall order status. `items` = [{status}] (all items, cancelled included). */
export function deriveOrderStatus(lifecycle, items) {
  if (lifecycle === 'COMPLETED') return ORDER.COMPLETED;
  if (lifecycle === 'CANCELLED') return ORDER.CANCELLED;
  const active = items.filter((i) => i.status !== I.CANCELLED);
  if (active.length === 0) return ORDER.OPEN;
  const count = (s) => active.filter((i) => i.status === s).length;
  const delivered = count(I.DELIVERED);
  const ready = count(I.READY);
  const pending = count(I.PENDING);
  if (delivered === active.length) return ORDER.DELIVERED;
  if (pending === active.length) return ORDER.OPEN;
  if (ready + delivered === active.length) return ORDER.READY;
  if (ready > 0) return ORDER.PARTIALLY_READY;
  return ORDER.IN_PROGRESS;
}

export const PAYMENT = Object.freeze({
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  OVERPAID: 'OVERPAID',
});

/** Payment state from the order total and the sum of valid (non-voided) payments. */
export function derivePaymentStatus(total, paid) {
  if (paid === 0) return total === 0 ? PAYMENT.PAID : PAYMENT.UNPAID;
  if (paid < total) return PAYMENT.PARTIAL;
  if (paid === total) return PAYMENT.PAID;
  return PAYMENT.OVERPAID;
}

/**
 * Derive a table's floor status from its live (unreleased) order.
 * `live` = null or { lifecycle, orderingUntil, counts: {PENDING, PREPARING, READY, DELIVERED} }
 */
export function deriveTableStatus(live, now = new Date()) {
  if (!live) return TABLE.AVAILABLE;
  if (live.lifecycle === 'COMPLETED') return TABLE.COMPLETED;
  if (live.orderingUntil && new Date(live.orderingUntil) > now) return TABLE.ORDERING;
  const c = live.counts;
  if (c.READY > 0) return TABLE.READY;
  if (c.PENDING + c.PREPARING > 0) return TABLE.PREPARING;
  if (c.DELIVERED === 0) return TABLE.WAITING_FOR_ORDER;
  return TABLE.OCCUPIED;
}
