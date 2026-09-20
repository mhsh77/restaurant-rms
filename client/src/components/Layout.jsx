import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  ChefHat,
  ClipboardList,
  GlassWater,
  History,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Settings,
  Table2,
  Users,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react';
import { PERM, useAuth } from '../lib/auth.jsx';
import { useRealtime } from '../lib/realtime.jsx';
import { unlockAudio } from '../lib/hooks.js';
import { ROLE_LABEL } from '../lib/format.js';
import ReadyBell from './ReadyBell.jsx';
import AccountDialog from './AccountDialog.jsx';

export function ConnectionDot() {
  const { connected } = useRealtime();
  return (
    <span className={`conn ${connected ? 'conn-on' : 'conn-off'}`} title={connected ? 'به‌روزرسانی زنده برقرار است' : 'در حال اتصال دوباره… اطلاعات ممکن است قدیمی باشد'}>
      <span className="conn-dot" aria-hidden />
      <span className="conn-label">{connected ? 'آنلاین' : 'قطع'}</span>
    </span>
  );
}

export default function Layout() {
  const { user, stations, restaurant, can, logout } = useAuth();
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(false);

  const links = [
    can(PERM.REPORTS_VIEW) && { to: '/dashboard', label: 'داشبورد', icon: LayoutDashboard },
    can(PERM.FLOOR_VIEW) && { to: '/floor', label: 'میزها', icon: LayoutGrid },
    can(PERM.CASHIER_WORK) && { to: '/cashier', label: 'صندوق', icon: Wallet },
    can(PERM.ORDER_VIEW) && { to: '/orders', label: 'سفارش‌ها', icon: ClipboardList },
    ...(can(PERM.STATION_WORK)
      ? stations.filter((s) => !s.autoReady).map((s) => ({ to: `/station/${s.id}`, label: s.name, icon: s.roleCode === 'BAR' ? GlassWater : ChefHat }))
      : []),
    can(PERM.MENU_MANAGE) && { to: '/menu', label: 'منو', icon: UtensilsCrossed },
    can(PERM.TABLES_MANAGE) && { to: '/tables', label: 'مدیریت میزها', icon: Table2 },
    can(PERM.REPORTS_VIEW) && { to: '/reports', label: 'گزارش‌ها', icon: BarChart3 },
    can(PERM.STAFF_MANAGE) && { to: '/staff', label: 'کارکنان', icon: Users },
    can(PERM.AUDIT_VIEW) && { to: '/audit', label: 'رویدادها', icon: History },
    can(PERM.SETTINGS_MANAGE) && { to: '/settings', label: 'تنظیمات', icon: Settings },
  ].filter(Boolean);

  return (
    <div className="app-shell" onPointerDown={unlockAudio}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            🍽️
          </span>
          <span className="brand-name">{restaurant?.name}</span>
        </div>
        <nav className="mainnav" aria-label="منوی اصلی">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `navlink ${isActive ? 'is-active' : ''}`}>
              <Icon size={20} aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          <ConnectionDot />
          {can(PERM.FLOOR_VIEW) && <ReadyBell />}
          <button type="button" className="user-chip" onClick={() => setAccountOpen(true)} title="حساب کاربری">
            <span className="avatar" aria-hidden>
              {user.name.slice(0, 1)}
            </span>
            <span className="user-meta">
              <strong>{user.name}</strong>
              <small>{ROLE_LABEL[user.roleCode]}</small>
            </span>
            <KeyRound size={16} className="muted hide-sm" aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            aria-label="خروج"
            title="خروج"
          >
            <LogOut size={22} className="flip-rtl" />
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
    </div>
  );
}
