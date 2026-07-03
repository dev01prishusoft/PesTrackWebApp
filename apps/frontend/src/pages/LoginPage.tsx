import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ApiError, type FieldErrors } from '../lib/api';

const inputCls =
  'w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [fieldErr, setFieldErr] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  
  const isAdminLogin = location.pathname.startsWith('/admin');

  useEffect(() => {
    if (user) {
      if (isAdminLogin) {
        if (user.role === 'admin') navigate('/admin/users', { replace: true });
        else navigate('/frontend/dashboard', { replace: true });
      } else {
        navigate('/frontend/dashboard', { replace: true });
      }
    }
  }, [user, navigate, isAdminLogin]);

  // Client-side check mirroring the backend rules — instant feedback, no round trip.
  function clientValidate(): FieldErrors {
    const f: FieldErrors = {};
    if (!username.trim()) f.username = 'Username or email is required';
    if (!password) f.password = 'Password is required';
    return f;
  }

  async function submit() {
    setErr('');
    const local = clientValidate();
    setFieldErr(local);
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      await login(username.trim(), password, isAdminLogin);
      // Let the useEffect handle the redirect so we have the latest user role
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFieldErr(e.fields);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-md p-8">
        <div className="flex flex-col items-center mb-6">
          <img src={`${import.meta.env.BASE_URL}sotaico-logo.png`} alt="SOTAICO PesTrack" className="h-12 w-auto" />
        </div>
        {err && <div className="px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm mb-3">{err}</div>}
        <label className="block text-xs font-medium text-muted-foreground mb-1">Username or email</label>
        <input
          className={inputCls}
          value={username}
          onChange={(e) => { setUsername(e.target.value); setFieldErr((p) => ({ ...p, username: '' })); }}
          placeholder="Enter username or email"
          autoComplete="username"
          aria-invalid={!!fieldErr.username}
        />
        {fieldErr.username && <p className="text-destructive text-xs mt-1">{fieldErr.username}</p>}
        <label className="block text-xs font-medium text-muted-foreground mt-3 mb-1">Password</label>
        <input
          className={inputCls} type="password" value={password}
          onChange={(e) => { setPassword(e.target.value); setFieldErr((p) => ({ ...p, password: '' })); }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Enter password"
          autoComplete="current-password"
          aria-invalid={!!fieldErr.password}
        />
        {fieldErr.password && <p className="text-destructive text-xs mt-1">{fieldErr.password}</p>}
        <button
          className="w-full mt-5 inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium h-9 px-4 py-2 bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50"
          onClick={submit}
          disabled={busy}
        >
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </div>
    </div>
  );
}
