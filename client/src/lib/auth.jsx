import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { moneyFormatter } from './format.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null); // { user, stations, restaurant }
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.get('/auth/me'));
    } catch (err) {
      if (err.status === 401) setSession(null);
      else throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
    const onUnauthorized = () => setSession(null);
    window.addEventListener('rms:unauthorized', onUnauthorized);
    return () => window.removeEventListener('rms:unauthorized', onUnauthorized);
  }, [refresh]);

  const login = useCallback(async (username, password) => {
    const data = await api.post('/auth/login', { username, password });
    setSession(data);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setSession(null);
    }
  }, []);

  const value = useMemo(() => {
    const user = session?.user ?? null;
    return {
      loading,
      user,
      stations: session?.stations ?? [],
      restaurant: session?.restaurant ?? null,
      money: moneyFormatter(session?.restaurant),
      can: (permission) => !!user?.permissions.includes(permission),
      login,
      logout,
      refresh,
    };
  }, [session, loading, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export const PERM = {
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
};

export function homePathFor(user, stations) {
  if (!user) return '/login';
  if (user.roleCode === 'MANAGER') return '/dashboard';
  if (user.roleCode === 'WAITER') return '/floor';
  if (user.roleCode === 'CASHIER') return '/cashier';
  if (stations.length) return `/station/${stations[0].id}`;
  return '/no-access';
}
