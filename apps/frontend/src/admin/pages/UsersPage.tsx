import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { DataTable } from '../components/DataTable';
import { SearchInput } from '../components/SearchInput';
import { Button } from '../components/ui/button';
import { StatusBadge } from '../components/ui/badge';
import { useListState } from '../hooks/useListState';
import { useUsers, useDeactivateUser } from '../api/queries';
import { useAdminConfirm } from '../components/AdminConfirmDialog';
import { useToast } from '../../components/Toast';
import { UserModal } from './UserModal';
import type { User } from '../lib/types';

export function UsersPage() {
  const ls = useListState({ sort: 'u.created_at', order: 'desc' });
  const [roleFilter, setRoleFilter] = useState('');
  const { data, isFetching, isError, error } = useUsers({ ...ls.params, role: roleFilter || undefined });
  const [editing, setEditing] = useState<User | null | undefined>(undefined);
  const deleteUser = useDeactivateUser();
  const confirm = useAdminConfirm();
  const toast = useToast();

  async function handleDelete(user: User) {
    const ok = await confirm({
      title: 'Delete user?',
      message: 'This user will be permanently deleted. This can only be done if they have no recorded findings, visits, or construction zones.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteUser.mutateAsync(user.id);
      toast.success('Deleted successfully.');
    } catch (e) {
      // 409 -> the user has recorded work that must be preserved, so the delete
      // was blocked. Surface it as a warning (their data is safe), not an error.
      toast.warning((e as Error).message);
    }
  }

  const columns = useMemo<ColumnDef<User, unknown>[]>(() => [
    { id: 'u.full_name', header: 'Name', accessorFn: (u) => u.full_name || '—' },
    { id: 'u.username', header: 'Username', accessorFn: (u) => u.username || '—' },
    { id: 'u.email', header: 'Email', accessorKey: 'email' },
    { id: 'u.role', header: 'Role', cell: ({ row }) => <span className="capitalize">{row.original.role.replace('_', ' ')}</span> },
    {
      id: 'sites', header: 'Sites',
      cell: ({ row }) => (
        <span className="text-sm font-medium text-foreground">
          {row.original.role === 'admin'
            ? 'All sites'
            : row.original.sites.length
              ? row.original.sites.map((s) => s.name).join(', ')
              : <span className="text-muted-foreground">—</span>}
        </span>
      ),
    },
    { id: 'u.is_active', header: 'Status', cell: ({ row }) => <StatusBadge active={row.original.is_active} /> },
    {
      id: 'actions', header: 'Actions',
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => setEditing(row.original)}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            aria-label="Edit" title="Edit"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={() => handleDelete(row.original)}
            className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
            aria-label="Delete" title="Delete"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0 h-full">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 sm:flex-wrap">
        {/* Row 1 on mobile: full-width search */}
        <div className="w-full sm:w-auto sm:contents">
          <SearchInput value={ls.search} onChange={ls.changeSearch} placeholder="Search name, username, email…" />
        </div>
        {/* Row 2 on mobile: role filter + new user button */}
        <div className="flex items-center gap-2 sm:contents">
          <select
            className="px-2.5 py-2 text-sm rounded-lg border border-input bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 flex-1 min-w-0 sm:flex-none sm:min-w-[150px]"
            value={roleFilter}
            onChange={(e) => { setRoleFilter(e.target.value); ls.setPage(1); }}
          >
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="engineer">Engineer</option>
            <option value="client_viewer">Client Viewer</option>
          </select>
          <Button className="shrink-0 sm:ml-auto" onClick={() => setEditing(null)}><Plus size={16} /> New User</Button>
        </div>
      </div>

      {isError && <div className="px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">{(error as Error).message}</div>}

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        pagination={data?.pagination}
        onPageChange={ls.setPage}
        sortState={ls.sortState}
        onSortChange={ls.changeSort}
        isLoading={isFetching}
        emptyLabel="users"
      />

      {editing !== undefined && <UserModal user={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
