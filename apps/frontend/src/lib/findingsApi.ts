import { api, qs, getToken, ApiError } from './api';
import type { Finding, ConstructionZone, References } from './types';

// Payload for a visit when creating/updating (photos are S3 URLs, already uploaded).
export interface VisitPayload {
  id?: string;
  visitDate: string;
  categoryId: string;
  label: string;
  notes: string;
  escalatedToId: string;
  statusId: string;
  photos: string[];
}

export interface CreateFindingPayload {
  siteId: string; // updated to string from number as siteId is UUID
  id?: string;
  lat: number;
  lng: number;
  parcel_id?: string;
  ref_num: string;
  visit: VisitPayload;
}

// --- references ------------------------------------------------------------

export function getReferences(): Promise<References> {
  return api<References>('/api/references');
}

// --- findings --------------------------------------------------------------

export function listFindings(siteId: string): Promise<Finding[]> {
  return api<{ findings: Finding[] }>(`/api/findings${qs({ siteId })}`).then((r) => r.findings);
}

export function createFinding(payload: CreateFindingPayload): Promise<{ id: string, visitId: string, finding: Finding }> {
  return api<{ id: string, visitId: string, finding: Finding }>('/api/findings', { method: 'POST', body: JSON.stringify(payload) });
}

export function addVisit(siteId: string, id: string, visit: VisitPayload): Promise<{ visitId: string, visit: any }> {
  return api<{ visitId: string, visit: any }>(`/api/findings/${encodeURIComponent(id)}/visits`, {
    method: 'POST',
    body: JSON.stringify({ siteId, ...visit }),
  });
}

export function editVisit(
  siteId: string,
  id: string,
  visitId: string,
  visit: VisitPayload
): Promise<void> {
  return api(`/api/findings/${encodeURIComponent(id)}/visits/${encodeURIComponent(visitId)}`, {
    method: 'PUT',
    body: JSON.stringify({ siteId, ...visit }),
  }).then(() => undefined);
}

export function deleteVisit(siteId: string, id: string, visitId: string): Promise<void> {
  return api(
    `/api/findings/${encodeURIComponent(id)}/visits/${encodeURIComponent(visitId)}${qs({ siteId })}`,
    { method: 'DELETE' }
  ).then(() => undefined);
}

export function deleteFinding(siteId: string, id: string): Promise<void> {
  return api(`/api/findings/${encodeURIComponent(id)}${qs({ siteId })}`, { method: 'DELETE' }).then(
    () => undefined
  );
}

export function clearFindings(siteId: string): Promise<void> {
  return api(`/api/findings${qs({ siteId })}`, { method: 'DELETE' }).then(() => undefined);
}

// --- construction zones ----------------------------------------------------

export function listZones(siteId: string): Promise<ConstructionZone[]> {
  return api<{ zones: ConstructionZone[] }>(`/api/zones${qs({ siteId })}`).then((r) => r.zones);
}

export function createZone(siteId: string, zone: { lat: number; lng: number }): Promise<{ id: string }> {
  return api<{ id: string }>('/api/zones', { method: 'POST', body: JSON.stringify({ siteId, ...zone }) }).then(
    (res) => ({ id: res.id })
  );
}

export function deleteZone(siteId: string, id: string): Promise<void> {
  return api(`/api/zones/${encodeURIComponent(id)}${qs({ siteId })}`, { method: 'DELETE' }).then(
    () => undefined
  );
}

// --- photo upload (multipart → S3) -----------------------------------------

/**
 * Uploads photo blobs to S3 via the backend. Returns permanent `keys` (to persist /
 * send back on save) and short-lived presigned `urls` (for immediate display).
 * The bucket is private, so display always uses presigned URLs.
 */
export async function uploadPhotos(
  siteId: string,
  files: Blob[]
): Promise<{ keys: string[]; urls: string[] }> {
  if (!files.length) return { keys: [], urls: [] };
  const form = new FormData();
  files.forEach((f, i) => form.append('files', f, `photo-${Date.now()}-${i}.jpg`));

  const token = getToken();
  const res = await fetch(`/api/findings/photos${qs({ siteId })}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((data as { error?: string }).error || 'Photo upload failed', res.status);
  }
  const { keys, urls } = data as { keys: string[]; urls: string[] };
  return { keys, urls };
}
