const TOKEN_KEY = 'pt_admin_token'; // Share session token with admin for single sign-on

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  status: number;
  fields?: FieldErrors;
  constructor(message: string, status: number, fields?: FieldErrors) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  const serverError = (data as { error?: string }).error;
  const fields = (data as { fields?: FieldErrors }).fields;

  if (res.status === 401) {
    const isLogin = path.includes('/api/auth/login');
    if (!isLogin) {
      clearToken();
      onUnauthorized?.();
      throw new ApiError(serverError || 'Session expired', 401);
    }
    throw new ApiError(serverError || 'Invalid credentials', 401);
  }

  if (!res.ok) {
    throw new ApiError(serverError || 'Request failed', res.status, fields);
  }
  return data as T;
}

export function qs(params: object): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}
