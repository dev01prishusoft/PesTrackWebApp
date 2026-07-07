const { query, withTransaction } = require('../config/database');
const { logAction, resolveAuditValues } = require('../services/auditService');
const { uploadPhoto, deletePhotos, presignKeys, toStorageKey } = require('../services/storageService');
const {
  validate,
  required,
  optional,
  isString,
  maxLen,
  oneOf,
} = require('../utils/validate');

const formatDateStr = (d) => {
  if (!d) return null;
  if (!(d instanceof Date)) return String(d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const VISIT_STATUSES = ['open', 'repeat', 'resolved'];

// --- shape helpers ---------------------------------------------------------

// DB rows -> the nested Finding[] shape the frontend map expects.
// Stored photo values are S3 keys; presign them into short-lived viewable URLs.
async function shapeFindings(locRows, visitRows, photoRows) {
  const photosByVisit = new Map();
  for (const p of photoRows) {
    if (!photosByVisit.has(p.visit_id)) photosByVisit.set(p.visit_id, []);
    photosByVisit.get(p.visit_id).push(p.photo_url);
  }

  const visitsByLoc = new Map();
  for (const v of visitRows) {
    const visit = {
      id: v.id,
      visitDate: formatDateStr(v.visit_date),
      categoryId: v.category_id,
      label: v.label || '',
      notes: v.notes || '',
      escalatedToId: v.escalated_to_id,
      statusId: v.status_id,
      createdBy: v.created_by_name || v.created_by_username || 'Unknown',
      createdById: v.created_by, // used by the client to gate edit/delete buttons
      updatedAt: v.updated_at,   // optimistic-lock token sent back on edit
      photos: await presignKeys(photosByVisit.get(v.id) || []),
    };
    if (!visitsByLoc.has(v.location_id)) visitsByLoc.set(v.location_id, []);
    visitsByLoc.get(v.location_id).push(visit);
  }

  return locRows.map((l) => ({
    id: l.id,
    lat: Number(l.lat),
    lng: Number(l.lng),
    parcel_id: l.parcel_id || '',
    ref_num: l.ref_num || '',
    visits: visitsByLoc.get(l.id) || [],
  }));
}

// Persist location-level edits (parcel + GPS) made from a visit dialog. Only
// columns the client actually sent are updated, so unrelated fields are left
// as-is. lat/lng are ignored unless they parse to finite numbers.
async function updateLocationFields(client, locationId, body) {
  const sets = [];
  const params = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (has('parcel_id')) {
    params.push(body.parcel_id || null);
    sets.push(`parcel_id = $${params.length}`);
  }
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (has('lat') && has('lng') && Number.isFinite(lat) && Number.isFinite(lng)) {
    params.push(lat); sets.push(`lat = $${params.length}`);
    params.push(lng); sets.push(`lng = $${params.length}`);
  }
  if (!sets.length) return;

  params.push(locationId);
  await client.query(
    `UPDATE locations SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
    params
  );
}

// Replace all photo rows for a visit. Client may send presigned URLs or raw keys;
// normalize each to the bare S3 key before storing so future presigns stay valid.
// Any photo that was on the visit but is no longer in the new set is deleted from
// S3 too, so removing a photo during an edit doesn't leave an orphaned object.
async function setVisitPhotos(client, visitDbId, photos, userId) {
  const { rows: oldRows } = await client.query(
    'SELECT photo_url FROM photos WHERE visit_id = $1',
    [visitDbId]
  );
  const newKeys = new Set(photos.map((p) => toStorageKey(p)));
  const removed = oldRows.map((r) => r.photo_url).filter((k) => !newKeys.has(k));

  await client.query('DELETE FROM photos WHERE visit_id = $1', [visitDbId]);
  for (const p of photos) {
    await client.query(
      `INSERT INTO photos (visit_id, photo_url, uploaded_by) VALUES ($1, $2, $3)`,
      [visitDbId, toStorageKey(p), userId]
    );
  }
  // Fire-and-forget: S3 cleanup runs after the row changes; failures are logged,
  // not thrown, so they never roll back the visit save.
  if (removed.length) deletePhotos(removed);
}

// Collect the stored S3 keys for photos belonging to the given visits or
// locations, so they can be removed from S3 after the DB rows are deleted.
async function photoKeysForVisits(visitIds) {
  if (!visitIds.length) return [];
  const { rows } = await query(
    'SELECT photo_url FROM photos WHERE visit_id = ANY($1::uuid[])',
    [visitIds]
  );
  return rows.map((r) => r.photo_url);
}
async function photoKeysForLocations(locationIds) {
  if (!locationIds.length) return [];
  const { rows } = await query(
    `SELECT p.photo_url FROM photos p
       JOIN visits v ON v.id = p.visit_id
      WHERE v.location_id = ANY($1::uuid[])`,
    [locationIds]
  );
  return rows.map((r) => r.photo_url);
}

// --- findings (locations + visits) -----------------------------------------

async function listFindings(req, res, next) {
  try {
    const siteId = req.query.siteId;
    const { rows: locRows } = await query(
      'SELECT * FROM locations WHERE site_id = $1 ORDER BY created_at DESC',
      [siteId]
    );
    if (!locRows.length) return res.json({ findings: [] });

    const locIds = locRows.map((l) => l.id);
    const visitParams = [locIds];
    // Site-scoped visibility: everyone with access to the site sees all findings
    // on it, regardless of who created them (site access is enforced by the route
    // middleware). Edit/delete rights are also site-based (see editVisit).
    const visitWhere = 'v.location_id = ANY($1::uuid[])';

    const { rows: visitRows } = await query(
      `SELECT v.*, u.full_name as created_by_name, u.username as created_by_username
       FROM visits v
       LEFT JOIN users u ON v.created_by = u.id
       WHERE ${visitWhere} ORDER BY v.visit_date DESC, v.created_at DESC`,
      visitParams
    );

    const visitIds = visitRows.map((v) => v.id);
    const { rows: photoRows } = visitIds.length
      ? await query('SELECT visit_id, photo_url FROM photos WHERE visit_id = ANY($1::uuid[])', [visitIds])
      : { rows: [] };

    // Drop locations that have no visible visits (e.g. all authored by other users),
    // so their markers disappear for the current user.
    const shaped = (await shapeFindings(locRows, visitRows, photoRows)).filter(
      (f) => f.visits.length > 0
    );
    res.json({ findings: shaped });
  } catch (err) {
    next(err);
  }
}

function validateVisitInput(body) {
  return validate(body, {
    visitDate: [required, isString, maxLen(20)],
    categoryId: [required, isString, maxLen(50)],
    label: [optional, isString, maxLen(255)],
    notes: [optional, isString],
    escalatedToId: [optional, isString, maxLen(50)],
    statusId: [required, isString, maxLen(50)],
  });
}

async function createFinding(req, res, next) {
  try {
    const siteId = req.body.siteId;
    const loc = validate(req.body, {
      lat: [required],
      lng: [required],
      parcel_id: [optional, isString, maxLen(50)],
      ref_num: [optional, isString, maxLen(10)],
    });
    const visit = validateVisitInput(req.body.visit || {});
    const photos = Array.isArray(req.body.visit?.photos) ? req.body.visit.photos : [];

    const created = await withTransaction(async (client) => {
      const { rows: locResult } = await client.query(
        `INSERT INTO locations (site_id, lat, lng, parcel_id, ref_num, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [siteId, req.body.lat, req.body.lng, loc.parcel_id || null, loc.ref_num || null, req.user.id]
      );
      const location = locResult[0];
      const { rows: visitResult } = await client.query(
        `INSERT INTO visits (location_id, visit_date, category_id, label, notes, escalated_to_id, status_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          location.id,
          visit.visitDate,
          visit.categoryId,
          visit.label || null,
          visit.notes || null,
          visit.escalatedToId || null,
          visit.statusId,
          req.user.id,
        ]
      );
      await setVisitPhotos(client, visitResult[0].id, photos, req.user.id);
      
      const newV = visitResult[0];
      location.visits = [{
        id: newV.id,
        visitDate: formatDateStr(newV.visit_date),
        categoryId: newV.category_id,
        label: newV.label,
        notes: newV.notes,
        escalatedToId: newV.escalated_to_id,
        statusId: newV.status_id,
        photos: photos,
      }];
      
      return location;
    });

    const firstVisit = created.visits[0];
    const newValues = await resolveAuditValues({
      lat: created.lat ? Number(created.lat) : null,
      lng: created.lng ? Number(created.lng) : null,
      parcel_id: created.parcel_id,
      ref_num: created.ref_num,
      visit_date: firstVisit.visitDate,
      category_id: firstVisit.categoryId,
      label: firstVisit.label,
      notes: firstVisit.notes,
      escalated_to_id: firstVisit.escalatedToId,
      status_id: firstVisit.statusId,
      photos: photos.map(p => toStorageKey(p)),
    });
    await logAction({ req, action: 'CREATE', tableName: 'locations', recordId: created.id, siteId, newValues });
    res.status(201).json({ message: 'Finding created', id: created.id, visitId: created.visits[0].id, finding: created });
  } catch (err) {
    next(err);
  }
}

// Resolve a location by its client id, scoped to the site.
async function findLocation(id, siteId) {
  const { rows } = await query('SELECT * FROM locations WHERE id = $1 AND site_id = $2', [id, siteId]);
  return rows[0] || null;
}

async function addVisit(req, res, next) {
  try {
    const siteId = req.body.siteId;
    const location = await findLocation(req.params.locationId, siteId);
    if (!location) return res.status(404).json({ error: 'Finding not found' });

    const visit = validateVisitInput(req.body);
    const photos = Array.isArray(req.body.photos) ? req.body.photos : [];

    let updatedLoc = null;
    const newVisit = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO visits (location_id, visit_date, category_id, label, notes, escalated_to_id, status_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          location.id,
          visit.visitDate,
          visit.categoryId,
          visit.label || null,
          visit.notes || null,
          visit.escalatedToId || null,
          visit.statusId,
          req.user.id,
        ]
      );
      await setVisitPhotos(client, rows[0].id, photos, req.user.id);
      // Persist parcel / GPS changes made while adding a visit, if sent.
      await updateLocationFields(client, location.id, req.body);
      const locRes = await client.query('SELECT * FROM locations WHERE id = $1', [location.id]);
      updatedLoc = locRes.rows[0];
      return rows[0];
    });

    const oldValues = await resolveAuditValues({
      parcel_id: location.parcel_id,
      lat: location.lat ? Number(location.lat) : null,
      lng: location.lng ? Number(location.lng) : null,
      photos: [],
    });

    const newValues = await resolveAuditValues({
      visit_date: newVisit.visit_date,
      category_id: newVisit.category_id,
      label: newVisit.label,
      notes: newVisit.notes,
      escalated_to_id: newVisit.escalated_to_id,
      status_id: newVisit.status_id,
      parcel_id: updatedLoc.parcel_id,
      lat: updatedLoc.lat ? Number(updatedLoc.lat) : null,
      lng: updatedLoc.lng ? Number(updatedLoc.lng) : null,
      photos: photos.map(p => toStorageKey(p)),
    });
    await logAction({ req, action: 'CREATE', tableName: 'visits', recordId: newVisit.id, siteId, oldValues, newValues });
    res.status(201).json({ message: 'Visit added', visitId: newVisit.id, visit: {
      id: newVisit.id,
      visitDate: formatDateStr(newVisit.visit_date),
      categoryId: newVisit.category_id,
      label: newVisit.label,
      notes: newVisit.notes,
      escalatedToId: newVisit.escalated_to_id,
      statusId: newVisit.status_id,
      photos: photos,
    }});
  } catch (err) {
    next(err);
  }
}

async function editVisit(req, res, next) {
  try {
    const siteId = req.body.siteId;
    const location = await findLocation(req.params.locationId, siteId);
    if (!location) return res.status(404).json({ error: 'Finding not found' });

    const visit = validateVisitInput({ ...req.body, id: req.params.visitId });
    const photos = Array.isArray(req.body.photos) ? req.body.photos : [];

    // Site-based access: anyone who can write to this site (admin or an assigned
    // engineer — enforced by the route middleware) may edit any visit on it.
    const existing = await query(
      'SELECT id FROM visits WHERE id = $1 AND location_id = $2',
      [req.params.visitId, location.id]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: 'Visit not found' });

    // Optimistic locking: the client sends the updated_at it loaded. If the row
    // has since changed (another engineer saved first), reject with 409 so we
    // don't silently overwrite their edit. Omitted -> check skipped (older client).
    const expectedUpdatedAt = req.body.expectedUpdatedAt;

    let conflict = false;
    let before = null;
    let oldPhotos = [];
    let updatedLoc = null;
    const updated = await withTransaction(async (client) => {
      // Lock the row for the duration of the transaction so a concurrent edit
      // can't slip in between our version check and our UPDATE. Grab the full
      // row so the audit log can record the old values.
      const cur = await client.query(
        'SELECT * FROM visits WHERE id = $1 AND location_id = $2 FOR UPDATE',
        [req.params.visitId, location.id]
      );
      if (!cur.rows[0]) return null;
      if (expectedUpdatedAt &&
          new Date(cur.rows[0].updated_at).getTime() !== new Date(expectedUpdatedAt).getTime()) {
        conflict = true;
        return null;
      }
      before = cur.rows[0];

      // Fetch the old photos before updating them
      const { rows: oldPhotoRows } = await client.query(
        'SELECT photo_url FROM photos WHERE visit_id = $1',
        [req.params.visitId]
      );
      oldPhotos = oldPhotoRows.map(r => r.photo_url);

      const { rows } = await client.query(
        `UPDATE visits SET visit_date=$1, category_id=$2, label=$3, notes=$4, escalated_to_id=$5, status_id=$6, updated_at=NOW()
         WHERE id=$7 AND location_id=$8 RETURNING *`,
        [
          visit.visitDate,
          visit.categoryId,
          visit.label || null,
          visit.notes || null,
          visit.escalatedToId || null,
          visit.statusId,
          req.params.visitId,
          location.id,
        ]
      );
      if (!rows[0]) return null;
      await setVisitPhotos(client, rows[0].id, photos, req.user.id);
      // Persist parcel / GPS changes made in the edit dialog. Each field is only
      // updated when the client sends it, so omitting one leaves it unchanged.
      await updateLocationFields(client, location.id, req.body);
      const locRes = await client.query('SELECT * FROM locations WHERE id = $1', [location.id]);
      updatedLoc = locRes.rows[0];
      return rows[0];
    });

    if (conflict) {
      return res.status(409).json({
        error: 'This finding was changed by another user while you were editing. Please reload and try again.',
      });
    }

    if (!updated) return res.status(404).json({ error: 'Visit not found' });
    // Resolve reference ids (category/status/escalation) to labels so the audit
    // log stores readable values instead of UUIDs.
    const oldValues = before && await resolveAuditValues({
      visit_date: before.visit_date,
      category_id: before.category_id,
      label: before.label,
      notes: before.notes,
      escalated_to_id: before.escalated_to_id,
      status_id: before.status_id,
      parcel_id: location.parcel_id,
      lat: location.lat ? Number(location.lat) : null,
      lng: location.lng ? Number(location.lng) : null,
      photos: oldPhotos,
    });
    const newValues = await resolveAuditValues({
      visit_date: updated.visit_date,
      category_id: updated.category_id,
      label: updated.label,
      notes: updated.notes,
      escalated_to_id: updated.escalated_to_id,
      status_id: updated.status_id,
      parcel_id: updatedLoc.parcel_id,
      lat: updatedLoc.lat ? Number(updatedLoc.lat) : null,
      lng: updatedLoc.lng ? Number(updatedLoc.lng) : null,
      photos: photos.map(p => toStorageKey(p)),
    });
    await logAction({
      req, action: 'UPDATE', tableName: 'visits', recordId: req.params.visitId, siteId,
      oldValues, newValues,
    });
    res.json({ message: 'Visit updated' });
  } catch (err) {
    next(err);
  }
}

async function deleteVisit(req, res, next) {
  try {
    const siteId = req.query.siteId;
    const location = await findLocation(req.params.locationId, siteId);
    if (!location) return res.status(404).json({ error: 'Finding not found' });

    // Site-based access: any admin/assigned engineer may delete any visit here.
    // Grab the visit's photo keys before the row (and its photos) are deleted.
    const photoKeys = await photoKeysForVisits([req.params.visitId]);
    const { rowCount } = await query('DELETE FROM visits WHERE id = $1 AND location_id = $2',
      [req.params.visitId, location.id]);
    if (!rowCount) return res.status(404).json({ error: 'Visit not found' });
    deletePhotos(photoKeys);

    await logAction({ req, action: 'DELETE', tableName: 'visits', recordId: req.params.visitId, siteId });
    res.json({ message: 'Visit deleted' });
  } catch (err) {
    next(err);
  }
}

async function deleteFinding(req, res, next) {
  try {
    const siteId = req.query.siteId;
    // Collect all photo keys under this finding before the cascade deletes them.
    const photoKeys = await photoKeysForLocations([req.params.locationId]);
    const { rowCount } = await query('DELETE FROM locations WHERE id = $1 AND site_id = $2', [
      req.params.locationId,
      siteId,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Finding not found' });
    deletePhotos(photoKeys);

    await logAction({ req, action: 'DELETE', tableName: 'locations', recordId: req.params.locationId, siteId });
    res.json({ message: 'Finding deleted' });
  } catch (err) {
    next(err);
  }
}

async function clearFindings(req, res, next) {
  try {
    const siteId = req.query.siteId;
    let rowCount;
    let photoKeys = [];
    if (req.user.role === 'admin') {
      // Admin clears every finding on the site — grab all its photo keys first.
      const { rows: kr } = await query(
        `SELECT p.photo_url FROM photos p
           JOIN visits v ON v.id = p.visit_id
           JOIN locations l ON l.id = v.location_id
          WHERE l.site_id = $1`,
        [siteId]
      );
      photoKeys = kr.map((r) => r.photo_url);
      ({ rowCount } = await query('DELETE FROM locations WHERE site_id = $1', [siteId]));
    } else {
      // Non-admin clears only their own visits — grab those visits' photo keys first.
      const { rows: kr } = await query(
        `SELECT p.photo_url FROM photos p
           JOIN visits v ON v.id = p.visit_id
          WHERE v.created_by = $1
            AND v.location_id IN (SELECT id FROM locations WHERE site_id = $2)`,
        [req.user.id, siteId]
      );
      photoKeys = kr.map((r) => r.photo_url);
      const del = await query(
        `DELETE FROM visits WHERE created_by = $1
           AND location_id IN (SELECT id FROM locations WHERE site_id = $2)`,
        [req.user.id, siteId]
      );
      rowCount = del.rowCount;
      await query(
        `DELETE FROM locations WHERE site_id = $1
           AND id NOT IN (SELECT DISTINCT location_id FROM visits WHERE location_id IS NOT NULL)`,
        [siteId]
      );
    }
    deletePhotos(photoKeys);
    await logAction({
      req,
      action: 'DELETE',
      tableName: 'locations',
      recordId: `site:${siteId}`,
      siteId,
      newValues: { message: `Cleared ${rowCount} findings` },
    });
    res.json({ message: `Cleared ${rowCount} findings` });
  } catch (err) {
    next(err);
  }
}

// --- construction zones ----------------------------------------------------

async function listZones(req, res, next) {
  try {
    const siteId = req.query.siteId;
    // Site-scoped: everyone with site access sees all zones on the site.
    const { rows } = await query(
      `SELECT cz.id, cz.lat, cz.lng, cz.created_at, cz.created_by
         FROM construction_zones cz
        WHERE cz.site_id = $1 ORDER BY cz.created_at DESC`,
      [siteId]
    );
    res.json({
      zones: rows.map((z) => ({
        id: z.id,
        lat: Number(z.lat),
        lng: Number(z.lng),
        createdAt: z.created_at,
        createdById: z.created_by, // used by the client to gate delete
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function createZone(req, res, next) {
  try {
    const siteId = req.body.siteId;
    const { rows } = await query(
      `INSERT INTO construction_zones (site_id, lat, lng, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
      [siteId, req.body.lat, req.body.lng, req.user.id]
    );
    const id = rows[0].id;
    await logAction({ req, action: 'CREATE', tableName: 'construction_zones', recordId: id, siteId });
    res.status(201).json({ message: 'Zone created', id });
  } catch (err) {
    next(err);
  }
}

async function deleteZone(req, res, next) {
  try {
    const siteId = req.query.siteId;
    // Site-based access: any admin/assigned engineer may delete any zone here.
    const { rowCount } = await query(
      'DELETE FROM construction_zones WHERE id = $1 AND site_id = $2',
      [req.params.id, siteId]
    );
    if (!rowCount) return res.status(404).json({ error: 'Zone not found' });
    await logAction({ req, action: 'DELETE', tableName: 'construction_zones', recordId: req.params.id, siteId });
    res.json({ message: 'Zone deleted' });
  } catch (err) {
    next(err);
  }
}

// --- photo upload (S3) ------------------------------------------------------

async function uploadPhotos(req, res, next) {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No photo files provided' });
    // keys are stored in the DB; urls are presigned for immediate display.
    const keys = [];
    const urls = [];
    for (const file of files) {
      const { key, url } = await uploadPhoto(file);
      keys.push(key);
      urls.push(url);
    }
    res.json({ keys, urls });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listFindings,
  createFinding,
  addVisit,
  editVisit,
  deleteVisit,
  deleteFinding,
  clearFindings,
  listZones,
  createZone,
  deleteZone,
  uploadPhotos,
};
