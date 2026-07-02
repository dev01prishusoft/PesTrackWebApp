import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { Database, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table';
import { cn } from '../lib/utils';
import type { Pagination } from '../lib/types';

interface SortState {
  sort?: string;
  order?: 'asc' | 'desc';
}

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  pagination?: Pagination;
  onPageChange: (page: number) => void;
  sortState: SortState;
  onSortChange: (s: SortState) => void;
  isLoading?: boolean;
  emptyLabel?: string;
}

export function DataTable<T>({
  columns,
  data,
  pagination,
  onPageChange,
  sortState,
  onSortChange,
  isLoading,
  emptyLabel = 'records',
}: DataTableProps<T>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
  });

  function toggleSort(colId: string) {
    if (sortState.sort !== colId) return onSortChange({ sort: colId, order: 'asc' });
    if (sortState.order === 'asc') return onSortChange({ sort: colId, order: 'desc' });
    return onSortChange({ sort: undefined, order: undefined });
  }

  return (
    <div className="w-full max-w-full bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col flex-1 min-h-0">
      <div className="w-full overflow-auto flex-1 min-h-0">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => {
                  const sortable = !!h.column.id && h.column.id !== 'actions';
                  const active = sortState.sort === h.column.id;
                  const isActionsCol = h.column.id === 'actions';
                  return (
                    <TableHead
                      key={h.id}
                      onClick={sortable ? () => toggleSort(h.column.id) : undefined}
                      className={cn(
                        isActionsCol && 'text-right',
                        sortable && 'cursor-pointer select-none hover:text-foreground'
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {active &&
                          (sortState.order === 'asc' ? (
                            <ChevronUp size={13} />
                          ) : (
                            <ChevronDown size={13} />
                          ))}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading && data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center text-muted-foreground">
                    <div className="h-12 w-12 rounded-lg bg-accent flex items-center justify-center mb-3">
                      <Database size={22} className="text-primary" />
                    </div>
                    <p className="font-medium text-foreground">No {emptyLabel} found</p>
                    <p className="text-xs mt-1">Try adjusting your search or filters.</p>
                  </div>
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(cell.column.id === 'actions' && 'text-right')}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm text-muted-foreground">
          <span>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
          </span>
          <div className="flex items-center gap-1">
            <button
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-input bg-card hover:bg-muted disabled:opacity-50 disabled:pointer-events-none transition-colors"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange(pagination.page - 1)}
            >
              <ChevronLeft size={15} /> Prev
            </button>
            <button
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-input bg-card hover:bg-muted disabled:opacity-50 disabled:pointer-events-none transition-colors"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => onPageChange(pagination.page + 1)}
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
