import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../http/auth.js';
import { PERMISSIONS as P } from '../auth/permissions.js';
import { zDate } from '../http/validate.js';
import { dashboard, summary, exportCsv, EXPORT_TYPES } from '../services/reports.js';
import { RANGE_PRESETS } from '../services/time.js';

const router = Router();
router.use(requirePermission(P.REPORTS_VIEW));

const opt = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());
const rangeSchema = z.object({
  range: opt(z.enum(RANGE_PRESETS)),
  from: opt(zDate),
  to: opt(zDate),
});

router.get('/dashboard', (req, res) => {
  res.json(dashboard(req.user));
});

router.get('/summary', (req, res) => {
  res.json(summary(req.user, rangeSchema.parse(req.query)));
});

router.get('/export', (req, res) => {
  const { type, ...range } = rangeSchema.extend({ type: z.enum(EXPORT_TYPES) }).parse(req.query);
  const { filename, content } = exportCsv(req.user, type, range);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(content);
});

export default router;
