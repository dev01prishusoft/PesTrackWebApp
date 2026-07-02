import { useState } from 'react';
import type { ListParams } from '../lib/types';

// Manages page/limit/sort/order/search for a list view. Resets to page 1
// whenever the search term or sort changes.
export function useListState(initial?: Partial<ListParams>) {
  const [page, setPage] = useState(initial?.page ?? 1);
  const [limit] = useState(initial?.limit ?? 20);
  const [sort, setSort] = useState<string | undefined>(initial?.sort);
  const [order, setOrder] = useState<'asc' | 'desc' | undefined>(initial?.order);
  const [search, setSearch] = useState(initial?.search ?? '');

  function changeSort(s: { sort?: string; order?: 'asc' | 'desc' }) {
    setSort(s.sort);
    setOrder(s.order);
    setPage(1);
  }

  function changeSearch(v: string) {
    setSearch(v);
    setPage(1);
  }

  const params: ListParams = { page, limit, sort, order, search };

  return {
    params,
    page,
    setPage,
    sortState: { sort, order },
    changeSort,
    search,
    changeSearch,
  };
}
