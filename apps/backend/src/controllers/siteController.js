const { query, withTransaction } = require('../config/database');
const { logAction, resolveAuditValues } = require('../services/auditService');
const { importParcels, PARCEL_PARSE_ERROR } = require('../services/parcelImportService');
const { parsePagination, parseSort, buildResponse } = require('../utils/listQuery');

const SITE_SORT_COLS = ['name', 'slug', 'status', 'default_zoom', 'created_at'];

// Marker for a userIds value that isn't a list, so a bad type is rejected rather
// than silently treated as "no users".
const INVALID = Symbol('invalid');

// Multipart form fields are always strings; JSON bodies already hold numbers.
function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Accepts a real array (JSON body) or a JSON-encoded array (multipart field).
function parseIdList(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : INVALID;
    } catch {
      return INVALID;
    }
  }
  return INVALID;
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)          // slug column is varchar(100)
    .replace(/-+$/g, '');   // avoid a trailing '-' left by the slice
}

// Admins see all sites; engineers and client_viewers see only their assigned
// sites. Supports pagination/sort/search; non-paginated callers still get `data`.
async function listSites(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { orderBy } = parseSort(req.query, SITE_SORT_COLS, 'id');

    const conditions = [];
    const params = [];
    // Only admins see every site; engineers and client_viewers are scoped
    // to their assigned sites.
    const seesAllSites = req.user.role === 'admin';
    if (!seesAllSites) {
      params.push(req.user.id);
      conditions.push(`s.id IN (SELECT site_id FROM user_sites WHERE user_id = $${params.length})`);
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conditions.push(`(s.name ILIKE $${params.length} OR s.slug ILIKE $${params.length})`);
    }
    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`s.status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*)::int AS total FROM sites s ${where}`, params);
    const total = countRes.rows[0].total;

    params.push(limit, offset);
    const { rows } = await query(
      `SELECT s.* FROM sites s ${where} ORDER BY ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(buildResponse({ rows, total, page, limit }));
  } catch (err) {
    next(err);
  }
}
async function getSite(req, res, next) {
  try {
    const { id } = req.params;
    const { rows } = await query(`
      SELECT s.*, 
             COALESCE(json_agg(DISTINCT jsonb_build_object('id', u.id, 'name', COALESCE(u.full_name, u.username)))
                      FILTER (WHERE u.id IS NOT NULL), '[]') AS users,
             (SELECT COUNT(*)::int FROM parcels WHERE site_id = s.id) AS parcel_count
      FROM sites s
      LEFT JOIN user_sites us ON us.site_id = s.id
      LEFT JOIN users u ON u.id = us.user_id
      WHERE s.id = $1
      GROUP BY s.id
    `, [id]);
    
    if (!rows[0]) return res.status(404).json({ error: 'Site not found' });
    res.json({ site: rows[0] });
  } catch (err) {
    next(err);
  }
}

// True when another site already uses this name (case-insensitive).
// `excludeId` skips the site being edited.
async function siteNameTaken(name, excludeId = null) {
  const params = [name];
  let sql = 'SELECT 1 FROM sites WHERE LOWER(name) = LOWER($1)';
  if (excludeId) { params.push(excludeId); sql += ' AND id <> $2'; }
  const { rowCount } = await query(sql + ' LIMIT 1', params);
  return rowCount > 0;
}

async function createSite(req, res, next) {
  try {
    // The dialog posts as multipart when it carries a parcel sheet, so numbers
    // and the id array arrive as strings; plain JSON requests are unaffected.
    const { name } = req.body || {};
    const mapCenterLat = toNumberOrNull(req.body?.mapCenterLat);
    const mapCenterLng = toNumberOrNull(req.body?.mapCenterLng);
    const defaultZoom = toNumberOrNull(req.body?.defaultZoom);
    const userIds = parseIdList(req.body?.userIds);

    if (!name) return res.status(400).json({ error: 'Site name is required' });
    if (String(name).length > 255) {
      return res.status(400).json({ error: 'Site name is too long', fields: { name: 'Must be at most 255 characters' } });
    }
    if (userIds === INVALID) {
      return res.status(400).json({ error: 'userIds must be an array', fields: { userIds: 'Must be an array' } });
    }
    if (await siteNameTaken(name)) {
      return res.status(400).json({ error: 'This site name is already in use.' });
    }
    const slug = slugify(name);
    // The initial user assignments belong to the same act of creating the site,
    // so they are written in one transaction and reported in one audit row —
    // rather than the site plus one row per user, none of which named either.
    const assignedIds = userIds || [];
    const site = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO sites (name, slug, map_center_lat, map_center_lng, default_zoom)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [name, slug, mapCenterLat || null, mapCenterLng || null, defaultZoom || 15]
      );
      for (const userId of assignedIds) {
        await client.query(
          `INSERT INTO user_sites (user_id, site_id) VALUES ($1,$2)
           ON CONFLICT (user_id, site_id) DO NOTHING`,
          [userId, rows[0].id]
        );
      }
      return rows[0];
    });

    // A parcel sheet sent with the dialog is applied here rather than through a
    // second request, so the site, its users and its starting parcel list are one
    // audit entry. The site is already committed at this point: a sheet that
    // cannot be read is reported back without discarding the site, matching what
    // the separate upload used to leave behind.
    let parcelResult = null;
    let parcelError = null;
    if (req.file) {
      try {
        const imported = await importParcels({ siteId: site.id, buffer: req.file.buffer });
        if (imported.ok) parcelResult = imported;
        else parcelError = imported.body.error;
      } catch (err) {
        console.error('Error importing parcel XLSX during site creation:', err);
        parcelError = PARCEL_PARSE_ERROR;
      }
    }

    // Postgres returns DECIMAL as a string; coerce the coordinates so the log
    // reads 27.4 rather than "27.400000".
    const newValues = await resolveAuditValues({
      ...site,
      map_center_lat: site.map_center_lat != null ? Number(site.map_center_lat) : null,
      map_center_lng: site.map_center_lng != null ? Number(site.map_center_lng) : null,
      userIds: assignedIds,
      ...(parcelResult ? { parcels: parcelResult.newParcels } : {}),
      ...(parcelError ? { parcelError } : {}),
    });
    await logAction({ req, action: 'CREATE', tableName: 'sites', recordId: site.id,
      siteId: site.id, newValues });
    res.status(201).json({
      site,
      ...(parcelResult ? { parcels: parcelResult.response } : {}),
      ...(parcelError ? { parcelError } : {}),
    });
  } catch (err) {
    next(err);
  }
}

async function updateSite(req, res, next) {
  try {
    const { name, status } = req.body || {};
    // As in createSite: a multipart save (one carrying a parcel sheet) delivers
    // every field as a string. `undefined` means "not sent", which the COALESCE
    // below leaves untouched — so a save that only replaces the sheet must not
    // turn missing coordinates into nulls.
    const mapCenterLat = req.body?.mapCenterLat != null ? toNumberOrNull(req.body.mapCenterLat) : undefined;
    const mapCenterLng = req.body?.mapCenterLng != null ? toNumberOrNull(req.body.mapCenterLng) : undefined;
    const defaultZoom = req.body?.defaultZoom != null ? toNumberOrNull(req.body.defaultZoom) : undefined;
    const userIds = req.body?.userIds != null ? parseIdList(req.body.userIds) : null;

    if (name != null && String(name).length > 255) {
      return res.status(400).json({ error: 'Site name is too long', fields: { name: 'Must be at most 255 characters' } });
    }
    if (status != null && String(status).length > 50) {
      return res.status(400).json({ error: 'Invalid status', fields: { status: 'Must be at most 50 characters' } });
    }
    if (userIds === INVALID) {
      return res.status(400).json({ error: 'userIds must be an array', fields: { userIds: 'Must be an array' } });
    }
    if (name && await siteNameTaken(name, req.params.id)) {
      return res.status(400).json({ error: 'This site name is already in use.' });
    }
    // Snapshot the row before updating so the audit log can record old values.
    const before = await query('SELECT * FROM sites WHERE id = $1', [req.params.id]);
    if (!before.rows[0]) return res.status(404).json({ error: 'Site not found' });

    // The site fields, its user assignments and its parcel sheet are saved by one
    // dialog, so they are recorded as one UPDATE. Editing only the parcel list
    // used to write two rows: a site row with nothing changed in it, and a
    // separate parcel row.
    let beforeUserIds = null;
    const updated = await withTransaction(async (client) => {
      if (userIds) {
        const cur = await client.query('SELECT user_id FROM user_sites WHERE site_id = $1', [req.params.id]);
        beforeUserIds = cur.rows.map((r) => r.user_id);
        await client.query('DELETE FROM user_sites WHERE site_id = $1', [req.params.id]);
        for (const userId of userIds) {
          await client.query(
            `INSERT INTO user_sites (user_id, site_id) VALUES ($1,$2)
             ON CONFLICT (user_id, site_id) DO NOTHING`,
            [userId, req.params.id]
          );
        }
      }
      const { rows } = await client.query(
        `UPDATE sites SET
           name = COALESCE($2, name),
           map_center_lat = COALESCE($3, map_center_lat),
           map_center_lng = COALESCE($4, map_center_lng),
           default_zoom = COALESCE($5, default_zoom),
           status = COALESCE($6, status),
           updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.id, name, mapCenterLat, mapCenterLng, defaultZoom, status]
      );
      return rows[0];
    });
    if (!updated) return res.status(404).json({ error: 'Site not found' });

    let parcelResult = null;
    let parcelError = null;
    if (req.file) {
      try {
        const imported = await importParcels({ siteId: req.params.id, buffer: req.file.buffer });
        if (imported.ok) parcelResult = imported;
        else parcelError = imported.body.error;
      } catch (err) {
        console.error('Error importing parcel XLSX during site update:', err);
        parcelError = PARCEL_PARSE_ERROR;
      }
    }

    // Both sides carry the same keys so the diff compares like-for-like and the
    // log names exactly what this save changed.
    const auditSide = async (row, ids, parcels) => resolveAuditValues({
      ...row,
      map_center_lat: row.map_center_lat != null ? Number(row.map_center_lat) : null,
      map_center_lng: row.map_center_lng != null ? Number(row.map_center_lng) : null,
      ...(ids ? { userIds: ids } : {}),
      ...(parcels ? { parcels } : {}),
    });
    const oldValues = await auditSide(before.rows[0], beforeUserIds, parcelResult?.oldParcels);
    const newValues = await auditSide(updated, userIds, parcelResult?.newParcels);
    if (parcelError) newValues.parcelError = parcelError;

    await logAction({ req, action: 'UPDATE', tableName: 'sites', recordId: updated.id,
      siteId: updated.id, oldValues, newValues });
    res.json({
      site: updated,
      ...(parcelResult ? { parcels: parcelResult.response } : {}),
      ...(parcelError ? { parcelError } : {}),
    });
  } catch (err) {
    next(err);
  }
}

// Hard delete site.
async function deleteSite(req, res, next) {
  try {
    const { rows } = await query(
      `DELETE FROM sites WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Site not found' });
    await logAction({ req, action: 'DELETE', tableName: 'sites', recordId: rows[0].id,
      oldValues: rows[0] });
    res.json({ site: rows[0] });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(409).json({ error: 'Cannot delete site because it is referenced by users, parcels, or findings.' });
    }
    next(err);
  }
}

// Assign / remove a user to/from a site (admin panel site management).
async function assignUser(req, res, next) {
  try {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    await query(
      `INSERT INTO user_sites (user_id, site_id) VALUES ($1,$2)
       ON CONFLICT (user_id, site_id) DO NOTHING`,
      [userId, req.params.id]
    );
    await logAction({ req, action: 'CREATE', tableName: 'user_sites',
      recordId: `${userId}:${req.params.id}`, siteId: req.params.id,
      newValues: { userId, siteId: req.params.id } });
    res.status(201).json({ message: 'User assigned to site' });
  } catch (err) {
    next(err);
  }
}

async function removeUser(req, res, next) {
  try {
    await query('DELETE FROM user_sites WHERE user_id = $1 AND site_id = $2',
      [req.params.userId, req.params.id]);
    await logAction({ req, action: 'DELETE', tableName: 'user_sites',
      recordId: `${req.params.userId}:${req.params.id}`, siteId: req.params.id });
    res.json({ message: 'User removed from site' });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listSites, getSite, createSite, updateSite, deleteSite,
  assignUser,
  removeUser,
};
