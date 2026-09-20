/** Persian labels used in server messages and audit summaries. */
export const ITEM_STATUS_FA = {
  PENDING: 'در انتظار',
  PREPARING: 'در حال آماده‌سازی',
  READY: 'آماده',
  DELIVERED: 'تحویل‌شده',
  CANCELLED: 'لغوشده',
};

export const LIFECYCLE_FA = {
  ACTIVE: 'باز',
  COMPLETED: 'تکمیل شده',
  CANCELLED: 'لغو شده',
};

export const ORDER_STATUS_FA = {
  OPEN: 'باز',
  IN_PROGRESS: 'در حال انجام',
  PARTIALLY_READY: 'بخشی آماده',
  READY: 'آماده',
  DELIVERED: 'تحویل‌شده',
  COMPLETED: 'تکمیل‌شده',
  CANCELLED: 'لغوشده',
};

export const SETTINGS_FIELD_FA = {
  name: 'نام',
  address: 'نشانی',
  phone: 'تلفن',
  receipt_footer: 'متن پایین فیش',
  currency_symbol: 'نماد ارز',
  currency_code: 'کد ارز',
  currency_decimals: 'رقم اعشار',
  timezone: 'منطقه زمانی',
  day_start_hour: 'شروع روز کاری',
  week_start_day: 'شروع هفته',
  kds_warn_minutes: 'زمان هشدار',
  kds_late_minutes: 'زمان تأخیر',
  require_payment_to_complete: 'تکمیل فقط پس از تسویه',
  mode_table_service: 'سفارش سر میز',
  mode_counter_table: 'سفارش در پیشخوان با سرو سر میز',
  mode_counter_pickup: 'سفارش در پیشخوان به‌صورت بیرون‌بر',
};

export const SERVICE_MODE_FA = {
  TABLE: 'سر میز',
  COUNTER_TABLE: 'پیشخوان، سرو سر میز',
  COUNTER_PICKUP: 'پیشخوان، تحویل بیرون‌بر',
};

/** Where an order belongs: its table, or the counter when it has none. */
export const placeLabel = (order) =>
  order.table_name ?? order.tableName ?? (order.service_mode === 'COUNTER_PICKUP' || order.serviceMode === 'COUNTER_PICKUP' ? 'بیرون‌بر' : 'بدون میز');

export const PAYMENT_METHOD_FA = {
  CASH: 'نقدی',
  CARD: 'کارت‌خوان',
  OTHER: 'سایر',
};

export const PAYMENT_STATUS_FA = {
  UNPAID: 'پرداخت نشده',
  PARTIAL: 'بخشی پرداخت‌شده',
  PAID: 'تسویه‌شده',
  OVERPAID: 'اضافه پرداخت',
};

export const MENU_FIELD_FA = {
  name: 'نام',
  description: 'توضیحات',
  item_type: 'نوع',
  category_id: 'دسته‌بندی',
  station_id: 'محل آماده‌سازی',
  is_active: 'نمایش در منو',
  is_available: 'موجودی',
  sort_order: 'ترتیب',
};

export const joinFa = (parts) => parts.join('، ');
