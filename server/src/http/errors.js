import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'ابتدا وارد حساب کاربری شوید') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'اجازه انجام این کار را ندارید') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'یافت نشد') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);
export const tooMany = (message) => new AppError(429, 'TOO_MANY_REQUESTS', message);

/** Persian names for request fields, used in validation messages. */
const FIELD_LABELS = {
  name: 'نام',
  username: 'نام کاربری',
  password: 'رمز عبور',
  newPassword: 'رمز عبور جدید',
  currentPassword: 'رمز عبور فعلی',
  roleCode: 'نقش',
  price: 'قیمت',
  description: 'توضیحات',
  categoryId: 'دسته‌بندی',
  stationId: 'محل آماده‌سازی',
  capacity: 'ظرفیت',
  area: 'بخش',
  sortOrder: 'ترتیب نمایش',
  guestCount: 'تعداد مهمان',
  quantity: 'تعداد',
  note: 'توضیحات',
  reason: 'دلیل',
  items: 'اقلام',
  menuItemId: 'آیتم منو',
  tableId: 'میز',
  from: 'از تاریخ',
  to: 'تا تاریخ',
  code: 'کد',
  currencyCode: 'کد ارز',
  currencySymbol: 'نماد ارز',
  timezone: 'منطقه زمانی',
  kdsWarnMinutes: 'زمان هشدار',
  kdsLateMinutes: 'زمان تأخیر',
};

const fieldLabel = (path) =>
  path
    .filter((p) => typeof p === 'string')
    .map((p) => FIELD_LABELS[p] ?? p)
    .join(' › ');

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: err.issues.map((i) => (i.path.length ? `${fieldLabel(i.path)}: ${i.message}` : i.message)).join('؛ '),
        details: err.issues,
      },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'بدنه درخواست JSON معتبر نیست' } });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'حجم فایل بیش از حد مجاز است' } });
  }
  // http-errors raised by middleware (e.g. express.static → 404 for a missing upload).
  const status = err?.status ?? err?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({ error: { code: status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', message: status === 404 ? 'یافت نشد' : 'درخواست نامعتبر است' } });
  }
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'خطای غیرمنتظره در سرور' } });
}
