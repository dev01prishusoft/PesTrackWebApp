import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
    },
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api(`/api/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin_users'] });
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

export function useAllSites() {
  return useQuery({
    queryKey: ['admin_sites', 'all'],
    queryFn: () => api<Paginated<Site>>(`/api/sites${qs({ page: 1, limit: 10000 })}`),
    select: (r) => r.data,
  });
}

export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api('/api/sites', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin_sites'] }),
  });
}

export function useUpdateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      api(`/api/sites/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
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
  params: ListParams & { action?: string; from?: string; to?: string }
) {
  return useQuery({
    queryKey: ['admin_audit', params],
    queryFn: () => api<Paginated<AuditLog>>(`/api/audit${qs(params)}`),
    placeholderData: (prev) => prev,
  });
}

export function useAllUsers() {
  return useQuery({
    queryKey: ['admin_users', 'all'],
    queryFn: () => api<Paginated<User>>(`/api/users${qs({ page: 1, limit: 10000 })}`),
    select: (r) => r.data,
  });
}

export function useAssignUserToSite() {
  return useMutation({
    mutationFn: ({ siteId, userId }: { siteId: number; userId: number }) =>
      api(`/api/sites/${siteId}/users`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      }),
  });
}

export function useRemoveUserFromSite() {
  return useMutation({
    mutationFn: ({ siteId, userId }: { siteId: number; userId: number }) =>
      api(`/api/sites/${siteId}/users/${userId}`, {
        method: 'DELETE',
      }),
  });
}
