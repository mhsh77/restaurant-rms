/** Tables, menu, orders and order items. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { requirePermission, requireAnyPermission } from '../http/auth.js';
import { roleHas, PERMISSIONS as P } from '../auth/permissions.js';
import { badRequest } from '../http/errors.js';
import { idParam, zName, zText, zDate } from '../http/validate.js';
import * as tables from '../services/tables.js';
import * as menu from '../services/menu.js';
import * as orders from '../services/orders.js';

const router = Router();
const opt = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/* ───────────── Tables ───────────── */

router.get('/tables', requireAnyPermission(P.FLOOR_VIEW, P.TABLES_MANAGE, P.COUNTER_ORDER), (req, res) => {
  res.json(tables.listFloor(req.user));
});

const tableSchema = z.strictObject({
  name: zName(40),
  capacity: z.number().int().min(1).max(100),
  area: zText(40),
  sortOrder: z.number().int().min(0).max(10000),
});

router.post('/tables', requirePermission(P.TABLES_MANAGE), (req, res) => {
  res.status(201).json(tables.createTable(req.user, tableSchema.partial({ area: true, sortOrder: true }).parse(req.body)));
});

router.put('/tables/:id', requirePermission(P.TABLES_MANAGE), (req, res) => {
  res.json(tables.updateTable(req.user, idParam(req.params.id), tableSchema.partial().parse(req.body)));
});

router.delete('/tables/:id', requirePermission(P.TABLES_MANAGE), (req, res) => {
  res.json(tables.deleteTable(req.user, idParam(req.params.id)));
});

router.post('/tables/:id/release', requirePermission(P.ORDER_WRITE), (req, res) => {
  res.json(tables.releaseTable(req.user, idParam(req.params.id)));
});

/* ───────────── Menu ───────────── */

const canManageMenu = (user) => roleHas(user.roleCode, P.MENU_MANAGE);

router.get('/menu/categories', requireAnyPermission(P.FLOOR_VIEW, P.MENU_MANAGE, P.COUNTER_ORDER), (req, res) => {
  res.json(menu.listCategories(req.user, { includeInactive: canManageMenu(req.user) && req.query.all === '1' }));
});

const categorySchema = z.strictObject({ name: zName(60), sortOrder: z.number().int().min(0).max(10000), isActive: z.boolean() });

router.post('/menu/categories', requirePermission(P.MENU_MANAGE), (req, res) => {
  res.status(201).json(menu.createCategory(req.user, categorySchema.partial({ sortOrder: true, isActive: true }).parse(req.body)));
});
router.put('/menu/categories/:id', requirePermission(P.MENU_MANAGE), (req, res) => {
  res.json(menu.updateCategory(req.user, idParam(req.params.id), categorySchema.partial().parse(req.body)));
});
router.delete('/menu/categories/:id', requirePermission(P.MENU_MANAGE), (req, res) => {
  res.json(menu.deleteCategory(req.user, idParam(req.params.id)));
});

router.get('/menu/items', requireAnyPermission(P.FLOOR_VIEW, P.MENU_MANAGE, P.COUNTER_ORDER), (req, res) => {
  res.json(menu.listItems(req.user, { includeInactive: canManageMenu(req.user) && req.query.all === '1' }));
});

const itemSchema = z.strictObject({
  name: zName(80),
  description: zText(500),
  price: z.number().int('قیمت باید عدد صحیح باشد').min(0).max(1_000_000_000_000),
  itemType: z.enum(['FOOD', 'DRINK', 'NON_FOOD']),
  categoryId: z.number().int().positive(),
  stationId: z.number().int().positive(),
  isActive: z.boolean(),
  isAvailable: z.boolean(),
  sortOrder: z.number().int().min(0).max(10000),
});

router.post('/menu/items', requirePermission(P.MENU_MANAGE), (req, res) => {
  const input = itemSchema.partial({ description: true, itemType: true, isActive: true, isAvailable: true, sortOrder: true }).parse(req.body);
  res.status(201).json(menu.createItem(req.user, input));
});
router.put('/menu/items/:id', requirePermission(P.MENU_MANAGE), (req, res) => {
  res.json(menu.updateItem(req.user, idParam(req.params.id), itemSchema.partial().parse(req.body)));
});
router.patch('/menu/items/:id/availability', requirePermission(P.MENU_MANAGE), (req, res) => {
  const { isAvailable } = z.strictObject({ isAvailable: z.boolean() }).parse(req.body);
  res.json(menu.setAvailability(req.user, idParam(req.params.id), isAvailable));
});
router.delete('/menu/items/:id', requirePermission(P.MENU_MANAGE), (req, res) => {
  res.json(menu.deleteItem(req.user, idParam(req.params.id)));
});

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const menuImageDir = path.join(config.uploadDir, 'menu');
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(menuImageDir, { recursive: true });
      cb(null, menuImageDir);
    },
    filename: (_req, file, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(IMAGE_TYPES[file.mimetype] ? null : badRequest('تصویر باید JPG، PNG یا WebP باشد'), !!IMAGE_TYPES[file.mimetype]),
});

/** Check magic bytes so a renamed non-image cannot be served from /uploads. */
function looksLikeImage(file) {
  const fd = fs.openSync(file.path, 'r');
  const head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, 12, 0);
  fs.closeSync(fd);
  const jpg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const png = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
  return jpg || png || webp;
}

router.post('/menu/items/:id/image', requirePermission(P.MENU_MANAGE), upload.single('image'), (req, res) => {
  if (!req.file) throw badRequest('یک فایل تصویر انتخاب کنید');
  if (!looksLikeImage(req.file)) {
    fs.rmSync(req.file.path, { force: true });
    throw badRequest('محتوای فایل، تصویر معتبری نیست');
  }
  try {
    res.json(menu.setItemImage(req.user, idParam(req.params.id), `menu/${req.file.filename}`));
  } catch (err) {
    fs.rmSync(req.file.path, { force: true });
    throw err;
  }
});

router.delete('/menu/items/:id/image', requirePermission(P.MENU_MANAGE), (req, res) => {
  res.json(menu.setItemImage(req.user, idParam(req.params.id), null));
});

/* ───────────── Orders ───────────── */

const ORDER_STATUSES = ['OPEN', 'IN_PROGRESS', 'PARTIALLY_READY', 'READY', 'DELIVERED', 'COMPLETED', 'CANCELLED'];

router.get('/orders', requirePermission(P.ORDER_VIEW), (req, res) => {
  const filters = z
    .object({
      q: opt(z.string().trim().max(40)),
      tableId: opt(z.coerce.number().int().positive()),
      waiterId: opt(z.coerce.number().int().positive()),
      status: opt(z.enum(ORDER_STATUSES)),
      paymentStatus: opt(z.enum(['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID'])),
      from: opt(zDate),
      to: opt(zDate),
      page: opt(z.coerce.number().int().min(1).max(100000)),
      pageSize: opt(z.coerce.number().int().min(1).max(100)),
    })
    .parse(req.query);
  res.json(orders.searchOrders(req.user, filters));
});

router.get('/orders/ready', requirePermission(P.ORDER_VIEW), (req, res) => {
  res.json(orders.readySummary(req.user));
});

router.get('/orders/:id', requirePermission(P.ORDER_VIEW), (req, res) => {
  res.json(orders.getOrderDetail(req.user, idParam(req.params.id)));
});

router.post('/orders', requirePermission(P.ORDER_WRITE), (req, res) => {
  const input = z
    .strictObject({ tableId: z.number().int().positive(), guestCount: z.number().int().min(1).max(100), note: zText(300).optional() })
    .parse(req.body);
  res.status(201).json(orders.openOrder(req.user, input));
});

router.patch('/orders/:id', requirePermission(P.ORDER_WRITE), (req, res) => {
  const input = z
    .strictObject({ guestCount: z.number().int().min(1).max(100).optional(), note: zText(300).optional(), version: z.number().int().positive() })
    .parse(req.body);
  res.json(orders.updateOrder(req.user, idParam(req.params.id), input));
});

router.post('/orders/:id/ordering', requirePermission(P.ORDER_WRITE), (req, res) => {
  const { active } = z.strictObject({ active: z.boolean() }).parse(req.body);
  res.json(orders.setOrderingPresence(req.user, idParam(req.params.id), active));
});

const batchSchema = z.strictObject({
  clientRequestId: z.string().trim().min(8).max(64),
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
});

router.post('/orders/:id/batches', requirePermission(P.ORDER_WRITE), (req, res) => {
  const result = orders.submitBatch(req.user, idParam(req.params.id), batchSchema.parse(req.body));
  res.status(result.duplicate ? 200 : 201).json(result);
});

router.post('/orders/:id/deliver-ready', requirePermission(P.ORDER_WRITE), (req, res) => {
  res.json(orders.deliverReady(req.user, idParam(req.params.id)));
});

router.post('/orders/:id/complete', requirePermission(P.ORDER_WRITE), (req, res) => {
  res.json(orders.completeOrder(req.user, idParam(req.params.id)));
});

router.post('/orders/:id/cancel', requirePermission(P.ORDER_WRITE), (req, res) => {
  const { reason } = z.strictObject({ reason: zName(200) }).parse(req.body);
  res.json(orders.cancelOrder(req.user, idParam(req.params.id), { reason }));
});

router.get('/orders/:id/receipt', requirePermission(P.ORDER_VIEW), (req, res) => {
  res.json(orders.getReceipt(req.user, idParam(req.params.id)));
});

router.post('/orders/:id/receipt/printed', requireAnyPermission(P.ORDER_WRITE, P.CASHIER_WORK), (req, res) => {
  res.json(orders.markReceiptPrinted(req.user, idParam(req.params.id)));
});

/* ───────────── Order items ───────────── */

router.patch('/order-items/:id', requirePermission(P.ORDER_WRITE), (req, res) => {
  const input = z
    .strictObject({ quantity: z.number().int().min(1).max(999).optional(), note: zText(200).optional(), version: z.number().int().positive() })
    .parse(req.body);
  res.json(orders.editItem(req.user, idParam(req.params.id), input));
});

const ITEM_STATUSES = ['PENDING', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];

router.post('/order-items/:id/status', requireAnyPermission(P.ORDER_WRITE, P.STATION_WORK), (req, res) => {
  const input = z
    .strictObject({ from: z.enum(ITEM_STATUSES), to: z.enum(ITEM_STATUSES), reason: zText(200).optional() })
    .parse(req.body);
  res.json(orders.changeItemStatus(req.user, idParam(req.params.id), input));
});

export default router;
