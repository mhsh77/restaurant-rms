/** Restaurant settings, staff, roles, stations (config) and the audit log. */
import { Router } from 'express';
import { z } from 'zod';
import { requirePermission, requireAnyPermission } from '../http/auth.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { idParam, zName, zText, zDate } from '../http/validate.js';
import { getRestaurant, toSettings, updateSettings } from '../services/restaurant.js';
import { listRoles, listUsers, createUser, updateUser } from '../services/users.js';
import { listStations, createStation, updateStation } from '../services/stations.js';
import { getStationTickets } from '../services/stationTickets.js';
import { advanceTicket } from '../services/orders.js';
import { listAuditLogs } from '../services/reports.js';

const router = Router();
const opt = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/* Restaurant settings */
router.get('/restaurant', (req, res) => {
  res.json(toSettings(getRestaurant(req.user.restaurantId)));
});

const settingsSchema = z
  .strictObject({
    name: zName(120),
    address: zText(240),
    phone: zText(60),
    receiptFooter: zText(240),
    currencySymbol: z.string().trim().min(1).max(8),
    currencyCode: z.string().trim().regex(/^[A-Z]{3}$/, 'باید سه حرف بزرگ لاتین باشد (مثلاً IRT)'),
    currencyDecimals: z.number().int().min(0).max(3),
    timezone: z.string().trim().min(1).max(64),
    dayStartHour: z.number().int().min(0).max(23),
    weekStartDay: z.number().int().min(0).max(6),
    kdsWarnMinutes: z.number().int().min(1).max(240),
    kdsLateMinutes: z.number().int().min(2).max(480),
    requirePaymentToComplete: z.boolean(),
  })
  .partial();

router.put('/restaurant', requirePermission(P.SETTINGS_MANAGE), (req, res) => {
  res.json(updateSettings(req.user, settingsSchema.parse(req.body)));
});

/* Staff */
const roleCode = z.enum(['MANAGER', 'WAITER', 'KITCHEN', 'BAR', 'CASHIER']);
const username = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, 'فقط حروف لاتین، عدد، نقطه، خط تیره و زیرخط مجاز است');
const password = z.string().min(8, 'باید حداقل ۸ کاراکتر باشد').max(200);

router.get('/roles', requirePermission(P.STAFF_MANAGE), (req, res) => res.json(listRoles()));

router.get('/users', requirePermission(P.STAFF_MANAGE), (req, res) => {
  const filters = z
    .object({ q: opt(z.string().max(60)), role: opt(roleCode), active: opt(z.enum(['true', 'false'])) })
    .parse(req.query);
  res.json(listUsers(req.user, { q: filters.q, roleCode: filters.role, active: filters.active === undefined ? undefined : filters.active === 'true' }));
});

router.post('/users', requirePermission(P.STAFF_MANAGE), (req, res) => {
  const input = z.strictObject({ name: zName(80), username, password, roleCode, isActive: z.boolean().optional() }).parse(req.body);
  res.status(201).json(createUser(req.user, input));
});

router.put('/users/:id', requirePermission(P.STAFF_MANAGE), (req, res) => {
  const input = z
    .strictObject({ name: zName(80), username, password, roleCode, isActive: z.boolean() })
    .partial()
    .parse(req.body);
  res.json(updateUser(req.user, idParam(req.params.id), input));
});

/* Stations */
router.get('/stations', (req, res) => {
  res.json(listStations(req.user, { includeInactive: req.user.roleCode === 'MANAGER' && req.query.all === '1' }));
});

const stationSchema = z.strictObject({
  code: z.string().trim().min(2).max(30).regex(/^[a-z0-9_-]+$/, 'فقط حروف کوچک لاتین، عدد، خط تیره و زیرخط مجاز است'),
  name: zName(60),
  roleCode: z.enum(['KITCHEN', 'BAR']).nullable(),
  autoReady: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
  isActive: z.boolean(),
});

router.post('/stations', requirePermission(P.SETTINGS_MANAGE), (req, res) => {
  const input = stationSchema.omit({ isActive: true }).partial({ roleCode: true, autoReady: true, sortOrder: true }).parse(req.body);
  res.status(201).json(createStation(req.user, input));
});

router.put('/stations/:id', requirePermission(P.SETTINGS_MANAGE), (req, res) => {
  const input = stationSchema.omit({ code: true }).partial().parse(req.body);
  res.json(updateStation(req.user, idParam(req.params.id), input));
});

router.get('/stations/:id/tickets', requireAnyPermission(P.STATION_WORK), (req, res) => {
  res.json(getStationTickets(req.user, idParam(req.params.id)));
});

router.post('/stations/:id/tickets/:batchId/advance', requireAnyPermission(P.STATION_WORK), (req, res) => {
  const { to } = z.strictObject({ to: z.enum(['PREPARING', 'READY', 'DELIVERED']) }).parse(req.body);
  res.json(advanceTicket(req.user, idParam(req.params.id), idParam(req.params.batchId, 'ticket'), { to }));
});

/* Audit log */
router.get('/audit-logs', requirePermission(P.AUDIT_VIEW), (req, res) => {
  const filters = z
    .object({
      userId: opt(z.coerce.number().int().positive()),
      entityType: opt(z.string().max(40)),
      action: opt(z.string().max(60)),
      q: opt(z.string().max(100)),
      from: opt(zDate),
      to: opt(zDate),
      page: opt(z.coerce.number().int().min(1).max(100000)),
      pageSize: opt(z.coerce.number().int().min(1).max(200)),
    })
    .parse(req.query);
  res.json(listAuditLogs(req.user, filters));
});

export default router;
