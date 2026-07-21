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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api<{ user: AuthUser }>('/api/auth/me')
      .then((d) => {
        setUser(d.user);
      })
      .catch(() => {
        clearToken();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // 60-Minute Inactivity Session Expiry (ISSUE-022 & ISSUE-023)
  useEffect(() => {
    if (!user) return;
    const INACTIVITY_MS = 60 * 60 * 1000;
    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        logout();
      }, INACTIVITY_MS);
    };

    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((evt) => window.removeEventListener(evt, resetTimer));
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
    setUser(d.user);
  }

  function logout() {
    // State-only: clearing the token + user lets RequireAuth redirect to the
    // login route via React Router. Doing a hard window.location navigation here
    // too would double-fire (client redirect, then full reload) and flash.
    clearToken();
    setUser(null);
  }

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
