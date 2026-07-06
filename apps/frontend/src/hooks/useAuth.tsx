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
    clearToken();
    setUser(null);
    // Send the user back to the admin login (this React app is the admin panel).
    // A hard navigation guarantees a clean slate regardless of the current route.
    window.location.assign('/admin/login');
  }

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
