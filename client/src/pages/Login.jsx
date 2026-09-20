import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { homePathFor, useAuth } from '../lib/auth.jsx';
import { Field, Spinner } from '../components/ui.jsx';

export default function Login() {
  const { user, stations, login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to={location.state?.from || homePathFor(user, stations)} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await login(username.trim(), password);
      navigate(location.state?.from || homePathFor(session.user, session.stations), { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span aria-hidden>🍽️</span>
          <h1>سامانه مدیریت رستوران</h1>
          <p className="muted">با حساب کاربری کارکنان وارد شوید</p>
        </div>
        <Field label="نام کاربری">
          <input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoFocus required />
        </Field>
        <Field label="رمز عبور">
          <input dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-xl btn-block" disabled={busy}>
          {busy ? <Spinner size={20} /> : <LogIn size={20} className="flip-rtl" />} ورود
        </button>
      </form>
    </div>
  );
}
