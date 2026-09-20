import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { PERM, homePathFor, useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import { LoadingBlock } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Floor from './pages/Floor.jsx';
import OrderScreen from './pages/OrderScreen.jsx';
import Orders from './pages/Orders.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import StationDisplay from './pages/StationDisplay.jsx';
import Cashier from './pages/Cashier.jsx';
import Dashboard from './pages/manager/Dashboard.jsx';
import Reports from './pages/manager/Reports.jsx';
import MenuAdmin from './pages/manager/MenuAdmin.jsx';
import TablesAdmin from './pages/manager/TablesAdmin.jsx';
import Staff from './pages/manager/Staff.jsx';
import AuditLog from './pages/manager/AuditLog.jsx';
import SettingsPage from './pages/manager/Settings.jsx';

function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingBlock label="در حال راه‌اندازی…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Hide screens the role may not use. The API enforces the same rules independently. */
function Guard({ perm, children }) {
  const { can } = useAuth();
  if (!can(perm)) {
    return (
      <div className="state-block">
        <strong>دسترسی ندارید</strong>
        <span className="muted">نقش شما اجازه باز کردن این صفحه را ندارد.</span>
      </div>
    );
  }
  return children;
}

function Home() {
  const { user, stations } = useAuth();
  return <Navigate to={homePathFor(user, stations)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route path="/station/:stationId" element={<Guard perm={PERM.STATION_WORK}><StationDisplay /></Guard>} />
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="/floor" element={<Guard perm={PERM.FLOOR_VIEW}><Floor /></Guard>} />
          <Route path="/tables/:tableId" element={<Guard perm={PERM.ORDER_WRITE}><OrderScreen /></Guard>} />
          <Route path="/orders" element={<Guard perm={PERM.ORDER_VIEW}><Orders /></Guard>} />
          <Route path="/orders/:orderId" element={<Guard perm={PERM.ORDER_VIEW}><OrderDetail /></Guard>} />
          <Route path="/cashier" element={<Guard perm={PERM.CASHIER_WORK}><Cashier /></Guard>} />
          <Route path="/dashboard" element={<Guard perm={PERM.REPORTS_VIEW}><Dashboard /></Guard>} />
          <Route path="/reports" element={<Guard perm={PERM.REPORTS_VIEW}><Reports /></Guard>} />
          <Route path="/menu" element={<Guard perm={PERM.MENU_MANAGE}><MenuAdmin /></Guard>} />
          <Route path="/tables" element={<Guard perm={PERM.TABLES_MANAGE}><TablesAdmin /></Guard>} />
          <Route path="/staff" element={<Guard perm={PERM.STAFF_MANAGE}><Staff /></Guard>} />
          <Route path="/audit" element={<Guard perm={PERM.AUDIT_VIEW}><AuditLog /></Guard>} />
          <Route path="/settings" element={<Guard perm={PERM.SETTINGS_MANAGE}><SettingsPage /></Guard>} />
          <Route path="*" element={<div className="state-block"><strong>صفحه یافت نشد</strong></div>} />
        </Route>
      </Route>
    </Routes>
  );
}
