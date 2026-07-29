const { query, withTransaction } = require('../config/database');
const { logAction, resolveAuditValues } = require('../services/auditService');
const {
  uploadPhoto,
  uploadBase64Photo,
  deletePhotos,
  presignKeys,
  toStorageKey,
  getPhotoObject,
  isConfigured,
} = require('../services/storageService');
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

// Sent whenever the record being edited/updated no longer exists (another user
// deleted it first). The client uses `code: 'DELETED'` to close the stale editor,
// refresh the data, and tell the user their change couldn't be saved.
const DELETED_MESSAGE = 'This record was already deleted by another user.';

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
      createdByName: v.created_by_name || v.created_by_username || 'Unknown',
      createdById: v.created_by, // used by the client to gate edit/delete buttons
      engineerName: v.engineer_name || v.engineer_username || 'Unknown',
      engineerId: v.engineer_id,
      updatedAt: v.updated_at,   // last-modified time, shown to the client
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
      `SELECT v.*, 
       uc.full_name as created_by_name, uc.username as created_by_username,
       ue.full_name as engineer_name, ue.username as engineer_username
       FROM visits v
       LEFT JOIN users uc ON v.created_by = uc.id
       LEFT JOIN users ue ON v.engineer_id = ue.id
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

// Fetch a single finding (location + its visits + photos) in the same nested
// shape as listFindings. The editor calls this when opening the edit dialog so
// it works off the latest data; a 404 with code 'DELETED' means another user
// removed the record, and the client shows the "already deleted" message.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getFinding(req, res, next) {
  try {
    if (!UUID_RE.test(req.params.locationId)) {
      return res.status(404).json({ error: 'Not found' });
    }
    const siteId = req.query.siteId;
    const { rows: locRows } = await query(
      'SELECT * FROM locations WHERE id = $1 AND site_id = $2',
      [req.params.locationId, siteId]
    );
    if (!locRows.length) return res.status(404).json({ error: DELETED_MESSAGE, code: 'DELETED' });

    const { rows: visitRows } = await query(
      `SELECT v.*, 
       uc.full_name as created_by_name, uc.username as created_by_username,
       ue.full_name as engineer_name, ue.username as engineer_username
         FROM visits v
         LEFT JOIN users uc ON v.created_by = uc.id
       LEFT JOIN users ue ON v.engineer_id = ue.id
        WHERE v.location_id = $1
        ORDER BY v.visit_date DESC, v.created_at DESC`,
      [locRows[0].id]
    );
    // A finding with no visits left is effectively gone from the map, so treat
    // it the same as deleted for the editor.
    if (!visitRows.length) return res.status(404).json({ error: DELETED_MESSAGE, code: 'DELETED' });

    const visitIds = visitRows.map((v) => v.id);
    const { rows: photoRows } = await query(
      'SELECT visit_id, photo_url FROM photos WHERE visit_id = ANY($1::uuid[])',
      [visitIds]
    );

    const [finding] = await shapeFindings(locRows, visitRows, photoRows);
    res.json({ finding });
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
        `INSERT INTO visits (location_id, visit_date, category_id, label, notes, escalated_to_id, status_id, created_by, engineer_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          location.id,
          visit.visitDate,
          visit.categoryId,
          visit.label || null,
          visit.notes || null,
          visit.escalatedToId || null,
          visit.statusId,
          req.user.id,
          req.body.engineerId || req.user.id,
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
    if (!location) return res.status(404).json({ error: DELETED_MESSAGE, code: 'DELETED' });

    const visit = validateVisitInput(req.body);
    const photos = Array.isArray(req.body.photos) ? req.body.photos : [];

    let updatedLoc = null;
    const newVisit = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO visits (location_id, visit_date, category_id, label, notes, escalated_to_id, status_id, created_by, engineer_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          location.id,
          visit.visitDate,
          visit.categoryId,
          visit.label || null,
          visit.notes || null,
          visit.escalatedToId || null,
          visit.statusId,
          req.user.id,
          req.body.engineerId || req.user.id,
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
      ref_num: location.ref_num,
      parcel_id: location.parcel_id,
      lat: location.lat ? Number(location.lat) : null,
      lng: location.lng ? Number(location.lng) : null,
    });

    const newValues = await resolveAuditValues({
      ref_num: location.ref_num,
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
    await logAction({ req, action: 'UPDATE', tableName: 'visits', recordId: newVisit.id, siteId, oldValues, newValues });
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
    if (!location) return res.status(404).json({ error: DELETED_MESSAGE, code: 'DELETED' });

    const visit = validateVisitInput({ ...req.body, id: req.params.visitId });
    const photos = Array.isArray(req.body.photos) ? req.body.photos : [];

    // Site-based access: anyone who can write to this site (admin or an assigned
    // engineer — enforced by the route middleware) may edit any visit on it.
    const existing = await query(
      'SELECT id FROM visits WHERE id = $1 AND location_id = $2',
      [req.params.visitId, location.id]
    );
    if (!existing.rows[0]) return res.status(404).json({ error: DELETED_MESSAGE, code: 'DELETED' });

    // Concurrency strategy: Last Write Wins. Engineers work across different areas
    // of the site, so two people editing the same visit at once is rare in practice.
    // We therefore accept the incoming edit unconditionally — no version check, no
    // 409 conflict — and let the most recent save be the one that persists. The
    // row is still locked FOR UPDATE below so each write is applied atomically
    // (no interleaving with a concurrent write), and every write is captured in
    // the audit log so an overwritten value is never lost from the record.
    let before = null;
    let oldPhotos = [];
    let updatedLoc = null;
    const updated = await withTransaction(async (client) => {
      // Lock the row for the duration of the transaction so concurrent edits are
      // serialized and applied one after another. Grab the full row so the audit
      // log can record the old values.
      const cur = await client.query(
        'SELECT * FROM visits WHERE id = $1 AND location_id = $2 FOR UPDATE',
        [req.params.visitId, location.id]
      );
      if (!cur.rows[0]) return null;
      before = cur.rows[0];

      // Fetch the old photos before updating them
      const { rows: oldPhotoRows } = await client.query(
        'SELECT photo_url FROM photos WHERE visit_id = $1',
        [req.params.visitId]
      );
      oldPhotos = oldPhotoRows.map(r => r.photo_url);

      const { rows } = await client.query(
        `UPDATE visits SET visit_date=$1, category_id=$2, label=$3, notes=$4, escalated_to_id=$5, status_id=$6, engineer_id=$7, updated_at=NOW()
         WHERE id=$8 AND location_id=$9 RETURNING *`,
        [
          visit.visitDate,
          visit.categoryId,
          visit.label || null,
          visit.notes || null,
          visit.escalatedToId || null,
          visit.statusId,
          req.body.engineerId || req.user.id,
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

    if (!updated) return res.status(404).json({ error: DELETED_MESSAGE, code: 'DELETED' });
    // Resolve reference ids (category/status/escalation) to labels so the audit
    // log stores readable values instead of UUIDs.
    const oldValues = before && await resolveAuditValues({
      ref_num: location.ref_num,
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
      ref_num: location.ref_num,
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
    const { rowCount, rows } = await query('DELETE FROM visits WHERE id = $1 AND location_id = $2 RETURNING *',
      [req.params.visitId, location.id]);
    if (!rowCount) return res.status(404).json({ error: 'Visit not found' });
    deletePhotos(photoKeys);

    const oldValues = await resolveAuditValues({
      ...rows[0],
      ref_num: location.ref_num,
      photos: photoKeys,
    });
    await logAction({ req, action: 'DELETE', tableName: 'visits', recordId: req.params.visitId, siteId, oldValues });
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
    const { rowCount, rows } = await query('DELETE FROM locations WHERE id = $1 AND site_id = $2 RETURNING *', [
      req.params.locationId,
      siteId,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Finding not found' });
    deletePhotos(photoKeys);

    await logAction({ req, action: 'DELETE', tableName: 'locations', recordId: req.params.locationId, siteId, oldValues: rows[0] });
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
    const importCount = req.query.importCount;
    if (importCount) {
      const findingsSummary = Array.isArray(req.body.findings)
        ? req.body.findings.map(f => ({
            refNum: f.refNum,
            parcel: f.parcel,
            lat: f.lat,
            lng: f.lng,
            visits: Array.isArray(f.visits)
              ? f.visits.map(v => ({
                  date: v.date,
                  cat: v.cat,
                  status: v.status,
                  label: v.label,
                  notes: v.notes,
                  escalated: v.escalated,
                  hasPhotos: Array.isArray(v.photos) && v.photos.length > 0
                }))
              : []
          }))
        : null;

      await logAction({
        req,
        action: 'CREATE',
        tableName: 'locations',
        recordId: `site:${siteId}`,
        siteId,
        newValues: {
          message: `Imported ${importCount} findings from JSON backup`,
          importedData: findingsSummary
        },
      });
    } else {
      await logAction({
        req,
        action: 'DELETE',
        tableName: 'locations',
        recordId: `site:${siteId}`,
        siteId,
        newValues: { message: `Cleared ${rowCount} findings` },
      });
    }
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
      `INSERT INTO construction_zones (site_id, lat, lng, created_by) VALUES ($1,$2,$3,$4) RETURNING id, lat, lng`,
      [siteId, req.body.lat, req.body.lng, req.user.id]
    );
    const zone = rows[0];
    await logAction({
      req, action: 'CREATE', tableName: 'construction_zones', recordId: zone.id, siteId,
      newValues: { lat: Number(zone.lat), lng: Number(zone.lng) },
    });
    res.status(201).json({ message: 'Zone created', id: zone.id });
  } catch (err) {
    next(err);
  }
}

async function deleteZone(req, res, next) {
  try {
    const siteId = req.query.siteId;
    // Site-based access: any admin/assigned engineer may delete any zone here.
    // Grab the zone's coordinates before deleting so the audit log records them.
    const { rows } = await query(
      'DELETE FROM construction_zones WHERE id = $1 AND site_id = $2 RETURNING lat, lng',
      [req.params.id, siteId]
    );
    // Already gone (another user deleted it first) → same DELETED signal as findings.
    if (!rows.length) return res.status(404).json({ error: DELETED_MESSAGE, code: 'DELETED' });
    await logAction({
      req, action: 'DELETE', tableName: 'construction_zones', recordId: req.params.id, siteId,
      oldValues: { lat: Number(rows[0].lat), lng: Number(rows[0].lng) },
    });
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

/** Same-origin photo proxy for PDF export and map popups (avoids S3 CORS). */
async function getPhoto(req, res, next) {
  try {
    const siteId = req.query.siteId;
    const rawKey = req.query.key;
    if (!rawKey || typeof rawKey !== 'string') {
      return res.status(400).json({ error: 'key is required' });
    }
    const key = toStorageKey(rawKey);
    if (!key || key.startsWith('data:') || /^https?:/.test(key) || !key.startsWith('photos/')) {
      return res.status(400).json({ error: 'Invalid photo key' });
    }
    if (!isConfigured()) {
      return res.status(503).json({ error: 'Photo storage is not configured' });
    }

    const { rows } = await query(
      `SELECT l.site_id
         FROM photos p
         JOIN visits v ON v.id = p.visit_id
         JOIN locations l ON l.id = v.location_id
        WHERE p.photo_url = $1
        LIMIT 1`,
      [key]
    );
    if (!rows.length || String(rows[0].site_id) !== String(siteId)) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const { body, contentType } = await getPhotoObject(key);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(body);
  } catch (err) {
    // S3 object missing or unreadable — return a clear status instead of a generic 500.
    const code = err.name || err.Code;
    if (code === 'NoSuchKey' || code === 'NotFound') {
      return res.status(404).json({ error: 'Photo not found in storage' });
    }
    if (code === 'AccessDenied') {
      return res.status(503).json({ error: 'Photo storage access denied — check S3 IAM permissions (s3:GetObject)' });
    }
    next(err);
  }
}

async function importBulk(req, res, next) {
  try {
    const { siteId, findings = [], zones = [] } = req.body;
    if (!siteId) {
      return res.status(400).json({ error: 'siteId is required' });
    }

    // Step 1: Upload base64 photos to S3 outside the database transaction
    const uploadedKeysToCleanup = [];
    try {
      for (const finding of findings) {
        if (!finding.visits) continue;
        for (const visit of finding.visits) {
          if (!visit.photos) continue;
          const mappedPhotos = [];
          for (const photo of visit.photos) {
            if (typeof photo === 'string' && photo.startsWith('data:')) {
              const { key } = await uploadBase64Photo(photo);
              uploadedKeysToCleanup.push(key);
              mappedPhotos.push(key);
            } else {
              mappedPhotos.push(photo);
            }
          }
          visit.photos = mappedPhotos;
        }
      }
    } catch (uploadErr) {
      if (uploadedKeysToCleanup.length > 0) {
        await deletePhotos(uploadedKeysToCleanup);
      }
      throw uploadErr;
    }

    // Step 2: Execute clear and insert operations in a transaction
    const { oldPhotoKeys, oldFindingsSummary } = await withTransaction(async (client) => {
      // 2a. Fetch existing locations for the site
      const { rows: locRows } = await client.query(
        `SELECT id, lat, lng, parcel_id, ref_num FROM locations WHERE site_id = $1`,
        [siteId]
      );
      const locIds = locRows.map((l) => l.id);

      let oldSummary = [];
      if (locIds.length > 0) {
        // 2b. Fetch visits and their photo keys/labels
        const { rows: visitRows } = await client.query(
          `SELECT v.id, v.location_id, v.visit_date, v.category_id, v.label, v.notes, v.escalated_to_id, v.status_id,
                  c.label AS category, s.label AS status, e.label AS escalated, p.photo_url,
                  par.parcel_name
             FROM visits v
             JOIN categories c ON c.id = v.category_id
             JOIN statuses s ON s.id = v.status_id
        LEFT JOIN escalation_options e ON e.id = v.escalated_to_id
        LEFT JOIN photos p ON p.visit_id = v.id
        LEFT JOIN locations loc ON loc.id = v.location_id
        LEFT JOIN parcels par ON par.id = loc.parcel_id
            WHERE v.location_id = ANY($1::uuid[])`,
          [locIds]
        );

        const visitsByLoc = new Map();
        for (const r of visitRows) {
          if (!visitsByLoc.has(r.location_id)) {
            visitsByLoc.set(r.location_id, []);
          }
          const list = visitsByLoc.get(r.location_id);
          let visit = list.find((v) => v.id === r.id);
          if (!visit) {
            visit = {
              id: r.id,
              date: formatDateStr(r.visit_date),
              category: r.category,
              status: r.status,
              label: r.label || '',
              notes: r.notes || '',
              escalated: r.escalated || 'Not assigned',
              parcel_name: r.parcel_name,
              photos: [],
            };
            list.push(visit);
          }
          if (r.photo_url) {
            visit.photos.push(r.photo_url);
          }
        }

        oldSummary = locRows.map((l) => {
          const locVisits = visitsByLoc.get(l.id) || [];
          const firstVisit = locVisits[0];
          const parcelName = firstVisit ? firstVisit.parcel_name : null;
          return {
            refNum: l.ref_num,
            parcel: parcelName || 'Not assigned',
            lat: Number(l.lat),
            lng: Number(l.lng),
            visits: locVisits.map((v) => ({
              date: v.date,
              category: v.category,
              status: v.status,
              label: v.label,
              notes: v.notes,
              escalated: v.escalated,
              photos: v.photos,
            })),
          };
        });
      }

      const { rows: keys } = await client.query(
        `SELECT photo_url FROM photos p
           JOIN visits v ON v.id = p.visit_id
           JOIN locations l ON l.id = v.location_id
          WHERE l.site_id = $1`,
        [siteId]
      );
      const oldKeys = keys.map((r) => r.photo_url);

      await client.query('DELETE FROM locations WHERE site_id = $1', [siteId]);
      await client.query('DELETE FROM construction_zones WHERE site_id = $1', [siteId]);

      for (const f of findings) {
        const { rows: locResult } = await client.query(
          `INSERT INTO locations (site_id, lat, lng, parcel_id, ref_num, created_by)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [siteId, f.lat, f.lng, f.parcel_id || null, f.ref_num || null, req.user.id]
        );
        const locationId = locResult[0].id;

        if (Array.isArray(f.visits)) {
          for (const v of f.visits) {
            const { rows: visitResult } = await client.query(
              `INSERT INTO visits (location_id, visit_date, category_id, label, notes, escalated_to_id, status_id, created_by, engineer_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
              [
                locationId,
                v.visitDate,
                v.categoryId,
                v.label || null,
                v.notes || null,
                v.escalatedToId || null,
                v.statusId,
                req.user.id,
                req.body.engineerId || req.user.id,
              ]
            );
            const visitId = visitResult[0].id;

            if (Array.isArray(v.photos)) {
              for (const photoKey of v.photos) {
                await client.query(
                  `INSERT INTO photos (visit_id, photo_url, uploaded_by)
                   VALUES ($1,$2,$3)`,
                  [visitId, photoKey, req.user.id]
                );
              }
            }
          }
        }
      }

      for (const cz of zones) {
        await client.query(
          `INSERT INTO construction_zones (site_id, lat, lng, created_by)
           VALUES ($1,$2,$3,$4)`,
          [siteId, cz.lat, cz.lng, req.user.id]
        );
      }

      return { oldPhotoKeys: oldKeys, oldFindingsSummary: oldSummary };
    });

    if (oldPhotoKeys && oldPhotoKeys.length > 0) {
      deletePhotos(oldPhotoKeys);
    }

    // Fetch lookup maps to resolve UUIDs to human-readable labels
    const { rows: dbParcels } = await query('SELECT id, parcel_name FROM parcels WHERE site_id = $1', [siteId]);
    const { rows: dbCategories } = await query('SELECT id, label FROM categories');
    const { rows: dbStatuses } = await query('SELECT id, label FROM statuses');
    const { rows: dbEscalations } = await query('SELECT id, label FROM escalation_options');

    const parcelMap = new Map(dbParcels.map(p => [p.id, p.parcel_name]));
    const categoryMap = new Map(dbCategories.map(c => [c.id, c.label]));
    const statusMap = new Map(dbStatuses.map(s => [s.id, s.label]));
    const escalationMap = new Map(dbEscalations.map(e => [e.id, e.label]));

    const findingsSummary = findings.map(f => ({
      refNum: f.ref_num,
      parcel: parcelMap.get(f.parcel_id) || f.parcel_id || 'Not assigned',
      lat: f.lat,
      lng: f.lng,
      visits: Array.isArray(f.visits)
        ? f.visits.map(v => ({
            date: v.visitDate,
            category: categoryMap.get(v.categoryId) || v.categoryId,
            status: statusMap.get(v.statusId) || v.statusId,
            label: v.label || '',
            notes: v.notes || '',
            escalated: v.escalatedToId ? (escalationMap.get(v.escalatedToId) || v.escalatedToId) : 'Not assigned',
            photos: v.photos || []
          }))
        : []
    }));

    await logAction({
      req,
      action: 'CREATE',
      tableName: 'locations',
      recordId: `site:${siteId}`,
      siteId,
      oldValues: {
        message: `Existing findings on site before import`,
        importedData: oldFindingsSummary
      },
      newValues: {
        message: `Imported ${findings.length} findings from JSON backup`,
        importedData: findingsSummary
      },
    });

    res.json({ message: `Successfully imported ${findings.length} findings` });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listFindings,
  getFinding,
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
  getPhoto,
  importBulk,
};
