import { q, transaction, nowIso } from '../db/connection.js';
import { audit } from './audit.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { isValidTimeZone } from './time.js';
import { notify } from '../realtime/hub.js';
import { SETTINGS_FIELD_FA, joinFa } from './labels.js';

export function getRestaurant(restaurantId) {
  const r = q.get('SELECT * FROM restaurants WHERE id = ?', restaurantId);
  if (!r) throw notFound('رستوران یافت نشد');
  return r;
}

export function toSettings(r) {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    phone: r.phone,
    receiptFooter: r.receipt_footer,
    currencySymbol: r.currency_symbol,
    currencyCode: r.currency_code,
    currencyDecimals: r.currency_decimals,
    timezone: r.timezone,
    dayStartHour: r.day_start_hour,
    weekStartDay: r.week_start_day,
    kdsWarnMinutes: r.kds_warn_minutes,
    kdsLateMinutes: r.kds_late_minutes,
    requirePaymentToComplete: !!r.require_payment_to_complete,
    serviceModes: {
      tableService: !!r.mode_table_service,
      counterTable: !!r.mode_counter_table,
      counterPickup: !!r.mode_counter_pickup,
    },
  };
}

const COLUMNS = {
  name: 'name',
  address: 'address',
  phone: 'phone',
  receiptFooter: 'receipt_footer',
  currencySymbol: 'currency_symbol',
  currencyCode: 'currency_code',
  currencyDecimals: 'currency_decimals',
  timezone: 'timezone',
  dayStartHour: 'day_start_hour',
  weekStartDay: 'week_start_day',
  kdsWarnMinutes: 'kds_warn_minutes',
  kdsLateMinutes: 'kds_late_minutes',
  requirePaymentToComplete: 'require_payment_to_complete',
  modeTableService: 'mode_table_service',
  modeCounterTable: 'mode_counter_table',
  modeCounterPickup: 'mode_counter_pickup',
};

/** The workflows in use, as flags the services can read. */
export function serviceModes(restaurant) {
  return {
    TABLE: !!restaurant.mode_table_service,
    COUNTER_TABLE: !!restaurant.mode_counter_table,
    COUNTER_PICKUP: !!restaurant.mode_counter_pickup,
  };
}

export function updateSettings(actor, input) {
  const result = transaction(() => {
    const current = getRestaurant(actor.restaurantId);
    if (input.timezone !== undefined && !isValidTimeZone(input.timezone)) throw badRequest('منطقه زمانی نامعتبر است');
    if (input.currencyDecimals !== undefined && input.currencyDecimals !== current.currency_decimals) {
      // Prices are stored in minor units; changing the scale would silently change every
      // historical amount, so it is only allowed before the first order exists.
      const hasOrders = q.get('SELECT 1 AS x FROM orders WHERE restaurant_id = ? LIMIT 1', actor.restaurantId);
      if (hasOrders) throw conflict('پس از ثبت اولین سفارش، تعداد رقم اعشار ارز قابل تغییر نیست');
      const factor = 10 ** (input.currencyDecimals - current.currency_decimals);
      q.run('UPDATE menu_items SET price = CAST(ROUND(price * ?) AS INTEGER) WHERE restaurant_id = ?', factor, actor.restaurantId);
    }
    const modes = {
      mode_table_service: input.modeTableService ?? !!current.mode_table_service,
      mode_counter_table: input.modeCounterTable ?? !!current.mode_counter_table,
      mode_counter_pickup: input.modeCounterPickup ?? !!current.mode_counter_pickup,
    };
    if (!Object.values(modes).some(Boolean)) throw badRequest('دست‌کم یکی از روش‌های سفارش‌گیری باید فعال باشد');
    if (!modes.mode_table_service) {
      const seated = q.get(
        "SELECT COUNT(*) AS n FROM orders WHERE restaurant_id = ? AND lifecycle = 'ACTIVE' AND service_mode = 'TABLE'",
        actor.restaurantId,
      ).n;
      if (seated) throw conflict(`${seated} سفارش باز سر میز وجود دارد؛ ابتدا آن‌ها را ببندید و بعد این روش را خاموش کنید`);
    }

    const warn = input.kdsWarnMinutes ?? current.kds_warn_minutes;
    const late = input.kdsLateMinutes ?? current.kds_late_minutes;
    if (late <= warn) throw badRequest('زمان «تأخیر» باید بیشتر از زمان «هشدار» باشد');

    const changed = {};
    for (const [field, column] of Object.entries(COLUMNS)) {
      if (input[field] === undefined) continue;
      const value = typeof input[field] === 'boolean' ? Number(input[field]) : input[field];
      if (value !== current[column]) changed[column] = value;
    }
    if (Object.keys(changed).length === 0) return toSettings(current);

    const sets = Object.keys(changed).map((c) => `${c} = ?`).join(', ');
    q.run(`UPDATE restaurants SET ${sets}, updated_at = ? WHERE id = ?`, ...Object.values(changed), nowIso(), actor.restaurantId);
    audit(actor, {
      action: 'settings.update',
      entityType: 'restaurant',
      entityId: actor.restaurantId,
      summary: `${actor.name} تنظیمات رستوران را تغییر داد (${joinFa(Object.keys(changed).map((c) => SETTINGS_FIELD_FA[c] ?? c))})`,
      metadata: { before: Object.fromEntries(Object.keys(changed).map((c) => [c, current[c]])), after: changed },
    });
    return toSettings(getRestaurant(actor.restaurantId));
  });
  notify.settingsChanged(actor.restaurantId);
  return result;
}
