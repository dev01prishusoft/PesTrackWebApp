import { useMemo, useState, useEffect } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, X, Trash2 } from 'lucide-react';
import { DataTable } from '../components/DataTable';
import { SearchInput } from '../components/SearchInput';
import { Button } from '../components/ui/button';
import { StatusBadge } from '../components/ui/badge';
import { useListState } from '../hooks/useListState';
import { useAdminConfirm } from '../components/AdminConfirmDialog';
import { useToast } from '../../components/Toast';
import {
  useSites,
  useCreateSite,
  useUpdateSite,
  useInfiniteUsers,
  useSite,
  useAssignUserToSite,
  useRemoveUserFromSite,
  useDeleteSite,
} from '../api/queries';
import type { Site } from '../lib/types';
import { getToken } from '../../lib/api';
import { MultiSelect } from '../components/ui/MultiSelect';

const inputCls =
  'w-full px-3 py-2 text-sm rounded-lg border border-input bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40';
const labelCls = 'block text-xs font-semibold text-muted-foreground mb-1';

function SiteModal({ site, onClose }: { site: Site | null; onClose: () => void }) {
  const editing = !!site;
  const toast = useToast();
  const create = useCreateSite();
  const update = useUpdateSite();
  const { data: siteDetails, isLoading: isLoadingSite } = useSite(site?.id);
  const [userSearch, setUserSearch] = useState('');
  const { data: infiniteUsersData, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteUsers(50, userSearch);
  const assignUser = useAssignUserToSite();
  const removeUser = useRemoveUserFromSite();

  const [name, setName] = useState(site?.name ?? '');
  const [lat, setLat] = useState(site?.map_center_lat?.toString() ?? '');
  const [lng, setLng] = useState(site?.map_center_lng?.toString() ?? '');
  const [zoom, setZoom] = useState(site?.default_zoom?.toString() ?? '14');
  const [file, setFile] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (siteDetails) {
      setName(siteDetails.name ?? '');
      setLat(siteDetails.map_center_lat?.toString() ?? '');
      setLng(siteDetails.map_center_lng?.toString() ?? '');
      setZoom(siteDetails.default_zoom?.toString() ?? '14');
    }
  }, [siteDetails]);

  const initialUserIds = useMemo(() => {
    if (!editing || !siteDetails?.users) return [];
    return siteDetails.users.map((u) => u.id);
  }, [editing, siteDetails]);

  const [userIds, setUserIds] = useState<number[]>([]);

  useEffect(() => {
    if (initialUserIds.length > 0) {
      setUserIds(initialUserIds);
    }
  }, [initialUserIds]);

  const userOptions = useMemo(() => {
    const infiniteUsers = infiniteUsersData?.pages.flatMap((p) => p.data) ?? [];
    
    // Map infinite users to the same shape as assignedUsers
    const mappedInfinite = infiniteUsers
      .filter((u: any) => u.role !== 'admin' && u.is_active)
      .map((u: any) => ({
        id: u.id,
        name: `${u.full_name || u.username} (${u.role.replace('_', ' ')})`,
      }));

    const assignedUsers = siteDetails?.users ?? [];
    
    // Merge them and remove duplicates by ID
    const merged = [...mappedInfinite];
    for (const au of assignedUsers) {
      if (!merged.some((m) => m.id === au.id)) {
        merged.push(au);
      }
    }
    
    return merged;
  }, [infiniteUsersData, siteDetails]);

  async function save() {
    const errors: Record<string, string> = {};

    if (!name.trim()) errors.name = 'Site name is required';
    if (!lat.trim()) {
      errors.lat = 'Map center latitude is required';
    } else {
      const latVal = parseFloat(lat);
      if (isNaN(latVal) || latVal < -90 || latVal > 90) errors.lat = 'Latitude must be between -90 and 90';
    }
    if (!lng.trim()) {
      errors.lng = 'Map center longitude is required';
    } else {
      const lngVal = parseFloat(lng);
      if (isNaN(lngVal) || lngVal < -180 || lngVal > 180) errors.lng = 'Longitude must be between -180 and 180';
    }
    if (!zoom.trim()) {
      errors.zoom = 'Default zoom is required';
    } else {
      const zVal = parseInt(zoom, 10);
      if (isNaN(zVal) || zVal < 1 || zVal > 20) errors.zoom = 'Must be a valid integer between 1 and 20';
    }

    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    setFieldErrors({});

    const body = {
      name,
      mapCenterLat: parseFloat(parseFloat(lat).toFixed(6)),
      mapCenterLng: parseFloat(parseFloat(lng).toFixed(6)),
      defaultZoom: parseInt(zoom, 10),
    };

    try {
      let savedSiteId = site?.id;
      if (editing) {
        await update.mutateAsync({ id: site!.id, body });
      } else {
        const res = await create.mutateAsync(body) as { site: Site };
        savedSiteId = res.site.id;
      }

      if (!savedSiteId) throw new Error('Site ID could not be determined');

      if (file) {
        const token = getToken();
        const formData = new FormData();
        formData.append('siteId', savedSiteId.toString());
        formData.append('file', file);
        const uploadRes = await fetch('/api/parcels/upload', {
          method: 'POST',
          headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: formData,
        });
        if (!uploadRes.ok) {
          const uploadData = await uploadRes.json().catch(() => ({}));
          throw new Error(uploadData.error || 'Failed to upload parcel list');
        }
      }

      const toAssign = userIds.filter((id) => !initialUserIds.includes(id));
      const toRemove = initialUserIds.filter((id) => !userIds.includes(id));
      // The site itself is already saved; a hiccup on an individual user
      // assignment shouldn't keep the dialog open. Run them, collect failures.
      const assignErrors: string[] = [];
      for (const uId of toAssign) {
        try { await assignUser.mutateAsync({ siteId: savedSiteId, userId: uId }); }
        catch (e) { assignErrors.push((e as Error).message); }
      }
      for (const uId of toRemove) {
        try { await removeUser.mutateAsync({ siteId: savedSiteId, userId: uId }); }
        catch (e) { assignErrors.push((e as Error).message); }
      }
      toast.success(editing ? 'Updated successfully.' : 'Saved successfully.');
      if (assignErrors.length) {
        // Surface but don't block — the site saved successfully.
        console.warn('Some user assignments failed:', assignErrors);
        toast.warning('Site saved, but some user assignments could not be applied.');
      }

      onClose();
    } catch (e) {
      // Surface conflicts (e.g. duplicate site name) as a toast using the
      // backend message — no inline field/banner error.
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px] flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-2xl shadow-xl w-[620px] max-w-[94vw] max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h3 className="text-lg font-bold m-0">{editing ? 'Edit Site' : 'New Site'}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoadingSite ? (
            <div className="flex flex-col justify-center items-center h-40 gap-4 text-slate-800" style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
              <div style={{
                width: '40px',
                height: '40px',
                border: '3px solid rgba(45, 138, 78, 0.2)',
                borderTop: '3px solid #2d8a4e',
                borderRadius: '50%',
                animation: 'global-spin 1s linear infinite',
              }}></div>
              <span style={{ fontWeight: 600, letterSpacing: '0.05em', fontSize: '13px', textTransform: 'uppercase', color: '#475569' }}>Loading...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5 pb-4">
              <div>
              <label className={labelCls}>Site name <span className="text-destructive">*</span></label>
              <input className={inputCls} maxLength={255} value={name} onChange={(e) => { setName(e.target.value); setFieldErrors(prev => ({ ...prev, name: '' })); }} placeholder="Site Name" />
              {fieldErrors.name && <p className="text-destructive text-xs mt-1">{fieldErrors.name}</p>}
            </div>

            <div>
              <label className={labelCls}>Default zoom <span className="text-destructive">*</span></label>
              <input className={inputCls} type="number" value={zoom} onChange={(e) => { setZoom(e.target.value); setFieldErrors(prev => ({ ...prev, zoom: '' })); }} placeholder="Default Zoom (e.g. 14)" />
              {fieldErrors.zoom && <p className="text-destructive text-xs mt-1">{fieldErrors.zoom}</p>}
            </div>

            <div>
              <label className={labelCls}>Map center latitude <span className="text-destructive">*</span></label>
              <input className={inputCls} type="number" step="any" value={lat} onChange={(e) => { setLat(e.target.value); setFieldErrors(prev => ({ ...prev, lat: '' })); }} placeholder="Latitude (e.g. 27.3949)" />
              {fieldErrors.lat && <p className="text-destructive text-xs mt-1">{fieldErrors.lat}</p>}
            </div>

            <div>
              <label className={labelCls}>Map center longitude <span className="text-destructive">*</span></label>
              <input className={inputCls} type="number" step="any" value={lng} onChange={(e) => { setLng(e.target.value); setFieldErrors(prev => ({ ...prev, lng: '' })); }} placeholder="Longitude (e.g. 33.6782)" />
              {fieldErrors.lng && <p className="text-destructive text-xs mt-1">{fieldErrors.lng}</p>}
            </div>

            <div>
              <label className={labelCls}>Parcel list upload (XLSX)</label>
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
              />
            </div>

            <div>
              <label className={labelCls}>Assigned users</label>
              <MultiSelect
                options={userOptions}
                selectedIds={userIds}
                onChange={(ids) => setUserIds(ids)}
                placeholder="Assign users to site..."
                openDirection="up"
                onSearchChange={setUserSearch}
                onLoadMore={() => fetchNextPage()}
                hasMore={hasNextPage}
                isLoading={isFetchingNextPage}
              />
            </div>
          </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border bg-muted/10">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={isLoadingSite || create.isPending || update.isPending}>
            {create.isPending || update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SitesPage() {
  const ls = useListState({ sort: 'created_at', order: 'desc' });
  const { data, isLoading, isFetching, isError, error } = useSites(ls.params);
  const deleteSite = useDeleteSite();
  const confirm = useAdminConfirm();
  const toast = useToast();
  const [editing, setEditing] = useState<Site | null | undefined>(undefined);

  const columns = useMemo<ColumnDef<Site, unknown>[]>(() => [
    { id: 'name', header: 'Name', accessorKey: 'name' },
    { id: 'slug', header: 'Slug', accessorKey: 'slug' },
    { id: 'center', header: 'Center (lat, lng)', accessorFn: (s) => `${s.map_center_lat ?? ''}, ${s.map_center_lng ?? ''}` },
    { id: 'default_zoom', header: 'Zoom', accessorKey: 'default_zoom' },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge active={row.original.status === 'active'} /> },
    {
      id: 'actions', header: 'Actions',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button onClick={() => setEditing(row.original)} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-primary transition-colors cursor-pointer" aria-label="Edit" title="Edit">
            <Pencil size={15} />
          </button>
          <button
            onClick={async () => {
              if (await confirm({ title: 'Delete Site', message: 'Are you sure you want to delete this site? This action cannot be undone.', confirmLabel: 'Delete', danger: true })) {
                try {
                  await deleteSite.mutateAsync(row.original.id);
                  toast.success('Deleted successfully.');
                } catch (e) {
                  // 409 -> site is referenced by users/parcels/findings; keep it as a warning.
                  toast.warning((e as Error).message);
                }
              }
            }}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive transition-colors cursor-pointer" aria-label="Delete" title="Delete"
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
      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput value={ls.search} onChange={ls.changeSearch} placeholder="Search name or slug…" />
        <Button className="ml-auto" onClick={() => setEditing(null)}><Plus size={16} /> New Site</Button>
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
        emptyLabel="sites"
      />
      {editing !== undefined && <SiteModal site={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
