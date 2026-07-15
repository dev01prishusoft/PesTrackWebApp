// Admin-specific types shared across admin pages embedded in the frontend app.

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

export interface SiteRef {
  id: number;
  name: string;
}

export interface User {
  id: number;
  username: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'engineer' | 'client_viewer';
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  sites: SiteRef[];
}

export interface Site {
  id: number;
  name: string;
  slug: string;
  map_center_lat: number | null;
  map_center_lng: number | null;
  default_zoom: number | null;
  status: string;
  created_at: string;
  users?: { id: number; name: string }[];
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  // Field-level snapshots (present for sites/users; used to show a readable
  // record label instead of a raw UUID). Shape varies by table.
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface Parcel {
  id?: string;
  name: string;
  lat: number;
  lng: number;
  quad: string;
  parcel_id?: string;
}

export interface ListParams {
  page: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
}
