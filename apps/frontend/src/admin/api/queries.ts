import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import type { Paginated, User, Site, AuditLog, ListParams } from '../lib/types';

// ---------- Users ----------
export function useUsers(params: ListParams & { role?: string; isActive?: string }) {
  return useQuery({
    queryKey: ['admin_users', params],
    queryFn: () => api<Paginated<User>>(`/api/users${qs(params)}`),
    placeholderData: (prev) => prev,
  });
}

export function useUser(id: number | undefined) {
  return useQuery({
    queryKey: ['admin_user', id],
    queryFn: () => api<{ user: User }>(`/api/users/${id}`).then(res => res.user),
    enabled: !!id,
  });
}

export function useActiveAdminCount(enabled = true) {
  return useQuery({
    queryKey: ['admin_users', 'active_admin_count'],
    queryFn: () =>
      api<Paginated<User>>(`/api/users${qs({ page: 1, limit: 1, role: 'admin', isActive: 'true' })}`),
    select: (r) => r.pagination.total,
    enabled,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/api/users', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin_users'] });
      qc.invalidateQueries({ queryKey: ['admin_sites'] });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin_users'] });
      qc.invalidateQueries({ queryKey: ['admin_sites'] });
    },
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/api/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin_users'] });
      qc.invalidateQueries({ queryKey: ['admin_sites'] });
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      api(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
  });
}

// ---------- Sites ----------
export function useSites(params: ListParams & { status?: string }) {
  return useQuery({
    queryKey: ['admin_sites', params],
    queryFn: () => api<Paginated<Site>>(`/api/sites${qs(params)}`),
    placeholderData: (prev) => prev,
  });
}


export function useInfiniteSites(limit: number = 5, search: string = '') {
  return useInfiniteQuery({
    queryKey: ['admin_sites', 'infinite', limit, search],
    queryFn: ({ pageParam = 1 }) => api<Paginated<Site>>(`/api/sites${qs({ page: pageParam, limit, search })}`),
    getNextPageParam: (lastPage) => 
      lastPage.pagination.page < lastPage.pagination.totalPages ? lastPage.pagination.page + 1 : undefined,
    initialPageParam: 1,
  });
}


// A site save carries its fields, its user assignments and — when one was picked
// — a parcel sheet. Sending them together makes the whole save one action, and
// one audit entry. A file forces multipart; otherwise it stays a plain JSON body.
type SiteBody = Record<string, unknown> & { file?: File | null };

function siteRequest(path: string, method: 'POST' | 'PUT', { file, ...body }: SiteBody) {
  if (!file) return api(path, { method, body: JSON.stringify(body) });
  const form = new FormData();
  Object.entries(body).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    // Arrays and objects go over as JSON; the server parses them back.
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  });
  form.append('file', file);
  return api(path, { method, body: form });
}

export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SiteBody) => siteRequest('/api/sites', 'POST', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sites'] }),
  });
}

export function useUpdateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: SiteBody }) =>
      siteRequest(`/api/sites/${id}`, 'PUT', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sites'] }),
  });
}

export function useDeleteSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/api/sites/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sites'] }),
  });
}

// ---------- Audit ----------
export function useAudit(
  params: ListParams & { action?: string; from?: string; to?: string; siteId?: string }
) {
  return useQuery({
    queryKey: ['admin_audit', params],
    queryFn: () => api<Paginated<AuditLog>>(`/api/audit${qs(params)}`),
    placeholderData: (prev) => prev,
  });
}

export function useSite(id: number | undefined) {
  return useQuery({
    queryKey: ['admin_sites', id],
    queryFn: () => api<{ site: Site }>(`/api/sites/${id}`).then(res => res.site),
    enabled: !!id,
  });
}

export function useInfiniteUsers(limit: number = 50, search: string = '') {
  return useInfiniteQuery({
    queryKey: ['admin_users', 'infinite', limit, search],
    queryFn: ({ pageParam = 1 }) => api<Paginated<User>>(`/api/users${qs({ page: pageParam, limit, search })}`),
    getNextPageParam: (lastPage) => 
      lastPage.pagination.page < lastPage.pagination.totalPages ? lastPage.pagination.page + 1 : undefined,
    initialPageParam: 1,
  });
}

export function useAssignUserToSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, userId }: { siteId: number; userId: number }) =>
      api(`/api/sites/${siteId}/users`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin_sites'] });
      qc.invalidateQueries({ queryKey: ['admin_users'] });
    },
  });
}

export function useRemoveUserFromSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, userId }: { siteId: number; userId: number }) =>
      api(`/api/sites/${siteId}/users/${userId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin_sites'] });
      qc.invalidateQueries({ queryKey: ['admin_users'] });
    },
  });
}
