import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { FileJson } from 'lucide-react';
import { DataTable } from '../components/DataTable';
import { SearchInput } from '../components/SearchInput';
import { PayloadModal } from '../components/PayloadModal';
import { useListState } from '../hooks/useListState';
import { useAudit, useSites } from '../api/queries';
import { cn } from '../lib/utils';
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
  const [siteId, setSiteId] = useState('');
  const [payloadRow, setPayloadRow] = useState<AuditLog | null>(null);
  const { data, isFetching, isError, error } = useAudit({
    ...ls.params,
    action: action || undefined,
    from: from || undefined,
    to: to || undefined,
    siteId: siteId || undefined,
  });
  // Every site in one page — the dropdown lists them all rather than paginating.
  const { data: sitesData } = useSites({ page: 1, limit: 500, sort: 'name', order: 'asc' });

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
    {
      // The site name is what identifies a row at a glance; the id is kept on the
      // tooltip for cross-referencing. Rows not scoped to a site (login, user
      // admin) carry neither.
      id: 's.name', header: 'Site',
      cell: ({ row }) => {
        const { site_name, site_id } = row.original;
        if (!site_id) return <span className="text-muted-foreground">—</span>;
        return <span title={site_id}>{site_name || site_id}</span>;
      },
    },
    {
      id: 'changes', header: 'Changes', enableSorting: false,
      cell: ({ row }) => {
        const l = row.original;
        const hasPayload = !!(l.old_values || l.new_values);
        if (!hasPayload) return <span className="text-muted-foreground">—</span>;
        return (
          <button
            type="button"
            onClick={() => setPayloadRow(l)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-input bg-card text-xs font-medium text-foreground hover:bg-muted transition-colors cursor-pointer"
            title="View old / new payload"
          >
            <FileJson size={14} />
            Payload
          </button>
        );
      },
    },
    { id: 'ip', header: 'IP', accessorFn: (l) => l.ip_address || '' },
  ], []);

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0 h-full">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 sm:flex-wrap">
        {/* Row 1 on mobile: search + action side by side */}
        <div className="flex items-center gap-2 sm:contents">
          <SearchInput value={ls.search} onChange={ls.changeSearch} placeholder="Search table, record, user, site…" />
          <select className={cn(selectCls, 'flex-1 min-w-[120px] sm:flex-none')} value={action} onChange={(e) => { setAction(e.target.value); ls.setPage(1); }}>
            <option value="">All actions</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
        <select
          className={cn(selectCls, 'min-w-[140px]')}
          value={siteId}
          onChange={(e) => { setSiteId(e.target.value); ls.setPage(1); }}
        >
          <option value="">All sites</option>
          {(sitesData?.data ?? []).map((s) => (
            <option key={s.id} value={String(s.id)}>{s.name}</option>
          ))}
        </select>
        {/* Row 2 on mobile: start + end date side by side */}
        <div className="flex items-center gap-2 sm:contents">
          <input className={cn(selectCls, 'flex-1 min-w-0 sm:flex-none')} type="date" value={from} onChange={(e) => { setFrom(e.target.value); ls.setPage(1); }} />
          <input className={cn(selectCls, 'flex-1 min-w-0 sm:flex-none')} type="date" value={to} onChange={(e) => { setTo(e.target.value); ls.setPage(1); }} />
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
        emptyLabel="audit entries"
      />

      {payloadRow && (
        <PayloadModal
          title={`${payloadRow.action} · ${payloadRow.table_name}`}
          oldValues={payloadRow.old_values}
          newValues={payloadRow.new_values}
          onClose={() => setPayloadRow(null)}
        />
      )}
    </div>
  );
}
