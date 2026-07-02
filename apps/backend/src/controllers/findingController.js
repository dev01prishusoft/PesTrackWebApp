const { query, withTransaction } = require('../config/database');
const { logAction } = require('../services/auditService');
const { uploadPhoto, presignKeys, toStorageKey } = require('../services/storageService');
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

// Replace all photo rows for a visit. Client may send presigned URLs or raw keys;
// normalize each to the bare S3 key before storing so future presigns stay valid.
async function setVisitPhotos(client, visitDbId, photos, userId) {
  await client.query('DELETE FROM photos WHERE visit_id = $1', [visitDbId]);
  for (const p of photos) {
    await client.query(
      `INSERT INTO photos (visit_id, photo_url, uploaded_by) VALUES ($1, $2, $3)`,
      [visitDbId, toStorageKey(p), userId]
    );
  }
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
    const visitWhere = 'location_id = ANY($1::uuid[])';
    
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

    await logAction({ req, action: 'CREATE', tableName: 'locations', recordId: created.id, siteId });
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
      return rows[0];
    });

    await logAction({ req, action: 'CREATE', tableName: 'visits', recordId: newVisit.id, siteId });
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

    // Non-admins may only edit their own visits.
    const ownClause = req.user.role !== 'admin' ? ' AND created_by = $9' : '';
    const updated = await withTransaction(async (client) => {
      const params = [
        visit.visitDate,
        visit.categoryId,
        visit.label || null,
        visit.notes || null,
        visit.escalatedToId || null,
        visit.statusId,
        req.params.visitId,
        location.id,
      ];
      if (ownClause) params.push(req.user.id);
      const { rows } = await client.query(
        `UPDATE visits SET visit_date=$1, category_id=$2, label=$3, notes=$4, escalated_to_id=$5, status_id=$6, updated_at=NOW()
         WHERE id=$7 AND location_id=$8${ownClause} RETURNING *`,
        params
      );
      if (!rows[0]) return null;
      await setVisitPhotos(client, rows[0].id, photos, req.user.id);
      return rows[0];
    });

    if (!updated) return res.status(404).json({ error: 'Visit not found' });
    await logAction({ req, action: 'UPDATE', tableName: 'visits', recordId: req.params.visitId, siteId });
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

    // Non-admins may only delete their own visits.
    const params = [req.params.visitId, location.id];
    let where = 'id = $1 AND location_id = $2';
    if (req.user.role !== 'admin') {
      params.push(req.user.id);
      where += ` AND created_by = $${params.length}`;
    }
    const { rowCount } = await query(`DELETE FROM visits WHERE ${where}`, params);
    if (!rowCount) return res.status(404).json({ error: 'Visit not found' });

    await logAction({ req, action: 'DELETE', tableName: 'visits', recordId: req.params.visitId, siteId });
    res.json({ message: 'Visit deleted' });
  } catch (err) {
    next(err);
  }
}

async function deleteFinding(req, res, next) {
  try {
    const siteId = req.query.siteId;
    const { rowCount } = await query('DELETE FROM locations WHERE id = $1 AND site_id = $2', [
      req.params.locationId,
      siteId,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Finding not found' });

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
    if (req.user.role === 'admin') {
      // Admin clears every finding on the site.
      ({ rowCount } = await query('DELETE FROM locations WHERE site_id = $1', [siteId]));
    } else {
      // Non-admin clears only their own visits, then removes any location left empty.
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
    // All users with site access see all zones for that site.
    const params = [siteId];
    const where = 'site_id = $1';
    const { rows } = await query(
      `SELECT id, lat, lng, created_at FROM construction_zones WHERE ${where} ORDER BY created_at DESC`,
      params
    );
    res.json({
      zones: rows.map((z) => ({
        id: z.id,
        lat: Number(z.lat),
        lng: Number(z.lng),
        createdAt: z.created_at,
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
    // Non-admins may only delete their own zones.
    const params = [req.params.id, siteId];
    let where = 'id = $1 AND site_id = $2';
    if (req.user.role !== 'admin') {
      params.push(req.user.id);
      where += ` AND created_by = $${params.length}`;
    }
    const { rowCount } = await query(`DELETE FROM construction_zones WHERE ${where}`, params);
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
