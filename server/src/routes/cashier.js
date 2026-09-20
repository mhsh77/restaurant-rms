/** Cashier: payable orders, taking payments, voiding, today's register summary. */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../http/auth.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { idParam, zName, zText } from '../http/validate.js';
import { cashierOrders, cashierSummary, recordPayment, voidPayment } from '../services/payments.js';

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

export default router;
