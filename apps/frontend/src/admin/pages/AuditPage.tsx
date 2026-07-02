import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '../components/DataTable';
import { SearchInput } from '../components/SearchInput';
import { useListState } from '../hooks/useListState';
import { useAudit } from '../api/queries';
import type { AuditLog } from '../lib/types';

const selectCls =
  'px-2.5 py-2 text-sm rounded-lg border border-input bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40';

const ACTION_STYLES: Record<string, string> = {
  CREATE: 'bg-emerald-500/15 text-emerald-700',
  UPDATE: 'bg-primary/15 text-primary',
  DELETE: 'bg-destructive/15 text-destructive',
};

export function AuditPage() {
  const ls = useListState({ sort: 'a.created_at', order: 'desc' });
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, isLoading, isError, error } = useAudit({
    ...ls.params,
    action: action || undefined,
    from: from || undefined,
    to: to || undefined,
  });

  const columns = useMemo<ColumnDef<AuditLog, unknown>[]>(() => [
    { id: 'a.created_at', header: 'When', accessorFn: (l) => new Date(l.created_at).toLocaleString() },
    { id: 'u.username', header: 'User', accessorFn: (l) => l.username || '—' },
    {
      id: 'a.action', header: 'Action',
      cell: ({ row }) => (
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_STYLES[row.original.action] ?? 'bg-muted text-muted-foreground'}`}>
          {row.original.action}
        </span>
      ),
    },
    { id: 'a.table_name', header: 'Table', accessorKey: 'table_name' },
    { id: 'record', header: 'Record', accessorFn: (l) => l.record_id || '' },
    { id: 'ip', header: 'IP', accessorFn: (l) => l.ip_address || '' },
  ], []);

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0 h-full">
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput value={ls.search} onChange={ls.changeSearch} placeholder="Search table, record, user…" />
        <select className={selectCls} value={action} onChange={(e) => { setAction(e.target.value); ls.setPage(1); }}>
          <option value="">All actions</option>
          <option value="CREATE">CREATE</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
        </select>
        <input className={selectCls} type="date" value={from} onChange={(e) => { setFrom(e.target.value); ls.setPage(1); }} />
        <input className={selectCls} type="date" value={to} onChange={(e) => { setTo(e.target.value); ls.setPage(1); }} />
      </div>
      {isError && <div className="px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">{(error as Error).message}</div>}
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        pagination={data?.pagination}
        onPageChange={ls.setPage}
        sortState={ls.sortState}
        onSortChange={ls.changeSort}
        isLoading={isLoading}
        emptyLabel="audit entries"
      />
    </div>
  );
}
