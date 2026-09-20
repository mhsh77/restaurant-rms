/**
 * Role → permission matrix. Roles live in the database; what a role may do lives here,
 * because permissions change together with the code that enforces them.
 */
export const ROLES = Object.freeze({
  MANAGER: 'MANAGER',
  WAITER: 'WAITER',
  KITCHEN: 'KITCHEN',
  BAR: 'BAR',
  CASHIER: 'CASHIER',
});

export const PERMISSIONS = Object.freeze({
  FLOOR_VIEW: 'floor:view',
  ORDER_WRITE: 'order:write',
  ORDER_VIEW: 'order:view',
  STATION_WORK: 'station:work',
  CASHIER_WORK: 'cashier:work',
  MENU_MANAGE: 'menu:manage',
  TABLES_MANAGE: 'tables:manage',
  STAFF_MANAGE: 'staff:manage',
  SETTINGS_MANAGE: 'settings:manage',
  REPORTS_VIEW: 'reports:view',
  AUDIT_VIEW: 'audit:view',
});

const P = PERMISSIONS;

const MATRIX = {
  [ROLES.MANAGER]: Object.values(PERMISSIONS),
  [ROLES.WAITER]: [P.FLOOR_VIEW, P.ORDER_WRITE, P.ORDER_VIEW],
  [ROLES.KITCHEN]: [P.STATION_WORK],
  [ROLES.BAR]: [P.STATION_WORK],
  [ROLES.CASHIER]: [P.ORDER_VIEW, P.CASHIER_WORK],
};

export function roleHas(roleCode, permission) {
  return (MATRIX[roleCode] || []).includes(permission);
}

export function permissionsFor(roleCode) {
  return [...(MATRIX[roleCode] || [])];
}
