/**
 * Cashier: payable orders, taking payments, voiding, today's register summary — and the
 * counter workflows, where the guest orders and pays here before anything is cooked.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAnyPermission, requirePermission } from '../http/auth.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { idParam, zName, zText } from '../http/validate.js';
import { cashierOrders, cashierSummary, recordPayment, voidPayment } from '../services/payments.js';
import { assignTable, counterQueue, createCounterOrder, handOver } from '../services/counter.js';

const router = Router();
const opt = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

router.get('/cashier/orders', requirePermission(P.CASHIER_WORK), (req, res) => {
  const filters = z.object({ view: opt(z.enum(['due', 'paid'])), q: opt(z.string().trim().max(40)) }).parse(req.query);
  res.json(cashierOrders(req.user, filters));
});

router.get('/cashier/summary', requirePermission(P.CASHIER_WORK), (req, res) => {
  res.json(cashierSummary(req.user));
});

const paymentSchema = z.strictObject({
  clientRequestId: z.string().trim().min(8).max(64),
  method: z.enum(['CASH', 'CARD', 'OTHER']),
  amount: z.number().int().positive(),
  receivedAmount: z.number().int().positive().optional(),
  reference: zText(60).optional(),
  completeOrder: z.boolean().optional(),
});

router.post('/orders/:id/payments', requirePermission(P.CASHIER_WORK), (req, res) => {
  const result = recordPayment(req.user, idParam(req.params.id), paymentSchema.parse(req.body));
  res.status(result.duplicate ? 200 : 201).json(result);
});

router.post('/payments/:id/void', requirePermission(P.CASHIER_WORK), (req, res) => {
  const { reason } = z.strictObject({ reason: zName(200) }).parse(req.body);
  res.json(voidPayment(req.user, idParam(req.params.id), { reason }));
});

/* ───────────── Counter ordering (order + payment in one step) ───────────── */

const counterOrderSchema = z.strictObject({
  clientRequestId: z.string().trim().min(8).max(64),
  mode: z.enum(['COUNTER_TABLE', 'COUNTER_PICKUP']),
  tableId: z.number().int().positive().nullable().optional(),
  customerName: zText(60).optional(),
  guestCount: z.number().int().min(1).max(100).optional(),
  note: zText(200).optional(),
  items: z
    .array(
      z.strictObject({
        menuItemId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(999),
        note: zText(200).optional(),
      }),
    )
    .min(1, 'حداقل یک آیتم اضافه کنید')
    .max(100),
  payment: z.strictObject({
    method: z.enum(['CASH', 'CARD', 'OTHER']),
    amount: z.number().int().positive(),
    receivedAmount: z.number().int().positive().optional(),
    reference: zText(60).optional(),
  }),
});

router.post('/counter-orders', requirePermission(P.COUNTER_ORDER), (req, res) => {
  const result = createCounterOrder(req.user, counterOrderSchema.parse(req.body));
  res.status(result.duplicate ? 200 : 201).json(result);
});

/** Counter orders still cooking, waiting to be handed over, or still without a table. */
router.get('/counter/queue', requireAnyPermission(P.COUNTER_ORDER, P.ORDER_WRITE), (req, res) => {
  res.json(counterQueue(req.user));
});

/** Attach a table to a counter order once the guest has sat down (null detaches it). */
router.post('/orders/:id/table', requireAnyPermission(P.COUNTER_ORDER, P.ORDER_WRITE), (req, res) => {
  const { tableId } = z.strictObject({ tableId: z.number().int().positive().nullable() }).parse(req.body);
  res.json(assignTable(req.user, idParam(req.params.id), { tableId }));
});

/** Hand a pickup order to the guest at the counter; this closes it. */
router.post('/orders/:id/hand-over', requireAnyPermission(P.COUNTER_ORDER, P.ORDER_WRITE), (req, res) => {
  res.json(handOver(req.user, idParam(req.params.id)));
});

export default router;
