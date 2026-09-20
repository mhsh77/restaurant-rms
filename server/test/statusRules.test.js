import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOrderStatus, deriveTableStatus, canTransition, derivePaymentStatus } from '../src/services/statusRules.js';

test('payment status is derived from total and valid payments', () => {
  assert.equal(derivePaymentStatus(500000, 0), 'UNPAID');
  assert.equal(derivePaymentStatus(500000, 200000), 'PARTIAL');
  assert.equal(derivePaymentStatus(500000, 500000), 'PAID');
  assert.equal(derivePaymentStatus(150000, 280000), 'OVERPAID');
  assert.equal(derivePaymentStatus(0, 0), 'PAID');
});

const items = (...statuses) => statuses.map((status) => ({ status }));

test('order status is derived from item statuses', () => {
  assert.equal(deriveOrderStatus('ACTIVE', []), 'OPEN');
  assert.equal(deriveOrderStatus('ACTIVE', items('PENDING', 'PENDING')), 'OPEN');
  assert.equal(deriveOrderStatus('ACTIVE', items('PREPARING', 'PENDING')), 'IN_PROGRESS');
  // Example from the specification: Pizza READY, Burger PREPARING, Coke READY.
  assert.equal(deriveOrderStatus('ACTIVE', items('READY', 'PREPARING', 'READY')), 'PARTIALLY_READY');
  assert.equal(deriveOrderStatus('ACTIVE', items('READY', 'DELIVERED')), 'READY');
  assert.equal(deriveOrderStatus('ACTIVE', items('DELIVERED', 'PREPARING')), 'IN_PROGRESS');
  assert.equal(deriveOrderStatus('ACTIVE', items('DELIVERED', 'DELIVERED', 'CANCELLED')), 'DELIVERED');
  assert.equal(deriveOrderStatus('ACTIVE', items('CANCELLED')), 'OPEN');
  assert.equal(deriveOrderStatus('COMPLETED', items('DELIVERED')), 'COMPLETED');
  assert.equal(deriveOrderStatus('CANCELLED', items('CANCELLED')), 'CANCELLED');
});

test('table status is derived from the live order', () => {
  const counts = (PENDING, PREPARING, READY, DELIVERED) => ({ PENDING, PREPARING, READY, DELIVERED });
  assert.equal(deriveTableStatus(null), 'AVAILABLE');
  assert.equal(deriveTableStatus({ lifecycle: 'ACTIVE', counts: counts(0, 0, 0, 0) }), 'WAITING_FOR_ORDER');
  assert.equal(deriveTableStatus({ lifecycle: 'ACTIVE', orderingUntil: new Date(Date.now() + 60_000).toISOString(), counts: counts(0, 0, 0, 0) }), 'ORDERING');
  assert.equal(deriveTableStatus({ lifecycle: 'ACTIVE', orderingUntil: new Date(Date.now() - 1).toISOString(), counts: counts(1, 0, 0, 0) }), 'PREPARING');
  assert.equal(deriveTableStatus({ lifecycle: 'ACTIVE', counts: counts(1, 0, 1, 0) }), 'READY');
  assert.equal(deriveTableStatus({ lifecycle: 'ACTIVE', counts: counts(0, 0, 0, 3) }), 'OCCUPIED');
  assert.equal(deriveTableStatus({ lifecycle: 'COMPLETED', counts: counts(0, 0, 0, 3) }), 'COMPLETED');
});

test('item transitions respect roles', () => {
  assert.ok(canTransition('KITCHEN', 'PENDING', 'PREPARING', { worksStation: true }));
  assert.ok(!canTransition('KITCHEN', 'PENDING', 'PREPARING', { worksStation: false }));
  assert.ok(!canTransition('KITCHEN', 'PENDING', 'CANCELLED', { worksStation: true }));
  assert.ok(!canTransition('WAITER', 'PENDING', 'PREPARING'));
  assert.ok(canTransition('WAITER', 'READY', 'DELIVERED'));
  assert.ok(canTransition('WAITER', 'PENDING', 'CANCELLED'));
  assert.ok(!canTransition('WAITER', 'PREPARING', 'CANCELLED'));
  assert.ok(canTransition('MANAGER', 'PREPARING', 'CANCELLED'));
  assert.ok(!canTransition('MANAGER', 'DELIVERED', 'CANCELLED'));
  assert.ok(!canTransition('BAR', 'DELIVERED', 'READY', { worksStation: true }));
});
