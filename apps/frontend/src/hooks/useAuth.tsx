import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken, clearToken, getToken, setUnauthorizedHandler } from '../lib/api';
import type { AuthUser } from '../lib/types';

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string, requireAdmin?: boolean) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

const INACTIVITY_MS = 60 * 60 * 1000;
const LAST_ACTIVITY_KEY = 'pt_admin_last_activity';
const TOUCH_THROTTLE_MS = 15_000;

let lastTouchWrite = 0;

function touchActivity(force = false) {
  const now = Date.now();
  if (!force && now - lastTouchWrite < TOUCH_THROTTLE_MS) return;
  lastTouchWrite = now;
  localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
}

function idleMs() {
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
  if (!raw) return Infinity;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return Infinity;
  return Date.now() - ts;
}

function clearActivity() {
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  lastTouchWrite = 0;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearActivity();
      setUser(null);
    });
    if (!getToken()) {
      setLoading(false);
      return;
    }
    // Enforce idle across reloads / tab discard (timer alone is not enough).
    if (idleMs() >= INACTIVITY_MS) {
      clearToken();
      clearActivity();
      setLoading(false);
      return;
    }
    api<{ user: AuthUser }>('/api/auth/me')
      .then((d) => {
        touchActivity(true);
        setUser(d.user);
      })
      .catch(() => {
        clearToken();
        clearActivity();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // 60-Minute Inactivity Session Expiry (ISSUE-022 & ISSUE-023)
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout>;

    const scheduleFromLastActivity = () => {
      clearTimeout(timer);
      const remaining = Math.max(0, INACTIVITY_MS - idleMs());
      timer = setTimeout(() => {
        logout();
      }, remaining);
    };

    const resetTimer = () => {
      touchActivity();
      scheduleFromLastActivity();
    };

    const onResume = () => {
      if (idleMs() >= INACTIVITY_MS) {
        logout();
        return;
      }
      scheduleFromLastActivity();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') onResume();
    };

    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'] as const;
    events.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onResume);
    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((evt) => window.removeEventListener(evt, resetTimer));
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onResume);
    };
  }, [user]);

  async function login(usernameOrEmail: string, password: string, requireAdmin = false) {
    const d = await api<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: usernameOrEmail, password }),
    });
    
    if (requireAdmin && d.user.role !== 'admin') {
      throw new Error('Unauthorized: Admin access required.');
    }
    
    setToken(d.token);
    touchActivity(true);
    setUser(d.user);
  }

  function logout() {
    // State-only: clearing the token + user lets RequireAuth redirect to the
    // login route via React Router. Doing a hard window.location navigation here
    // too would double-fire (client redirect, then full reload) and flash.
    clearToken();
    clearActivity();
    setUser(null);
  }

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
