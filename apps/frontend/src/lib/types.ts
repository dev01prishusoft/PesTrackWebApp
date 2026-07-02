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
  id: string;
  name: string;
}

export interface User {
  id: string;
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
  id: string;
  name: string;
  slug: string;
  map_center_lat: number | null;
  map_center_lng: number | null;
  default_zoom: number | null;
  status: string;
  created_at: string;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string | null;
  role: 'admin' | 'engineer' | 'client_viewer';
  // IDs of the sites this user is assigned to (used to scope the site picker).
  siteIds: string[];
}

export interface ListParams {
  page: number;
  limit: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
}

export interface Visit {
  id: string;
  visitDate: string;
  categoryId: string;
  label: string;
  notes: string;
  escalatedToId: string;
  statusId: string;
  photoUrl?: string; // S3 URL or base64 fallback
  photos?: string[]; // Array of photo URLs / base64 strings
}

export interface Finding {
  id: string;
  lat: number;
  lng: number;
  parcel_id?: string;
  ref_num: string;
  visits: Visit[];
}

export interface ConstructionZone {
  id: string;
  lat: number;
  lng: number;
  createdAt: string;
}

export interface Parcel {
  id?: string;
  name: string;
  lat: number;
  lng: number;
  quad: string;
}

export interface Category {
  id: string;
  label: string;
  color: string;
  sort_order: number;
}

export interface Status {
  id: string;
  label: string;
  color: string;
  emoji: string;
  sort_order: number;
}

export interface EscalationOption {
  id: string;
  label: string;
  sort_order: number;
}

export interface References {
  categories: Category[];
  statuses: Status[];
  escalations: EscalationOption[];
}
