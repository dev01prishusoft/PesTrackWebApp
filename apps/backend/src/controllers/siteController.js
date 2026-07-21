const { query } = require('../config/database');
const { logAction } = require('../services/auditService');
const { parsePagination, parseSort, buildResponse } = require('../utils/listQuery');

const SITE_SORT_COLS = ['name', 'slug', 'status', 'default_zoom', 'created_at'];

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
             (SELECT COUNT(DISTINCT parcel_name)::int FROM parcels WHERE site_id = s.id) AS parcel_count,
             COALESCE((
               SELECT json_agg(json_build_object(
                        'parcel_name', p.parcel_name,
                        'quadrant', p.quadrant,
                        'points', p.points
                      ))
               FROM (
                 SELECT parcel_name, quadrant, COUNT(*)::int AS points
                 FROM parcels
                 WHERE site_id = s.id
                 GROUP BY parcel_name, quadrant
                 ORDER BY quadrant ASC, parcel_name ASC
                 LIMIT 200
               ) p
             ), '[]') AS parcels
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
    const { name, mapCenterLat, mapCenterLng, defaultZoom } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Site name is required' });
    if (String(name).length > 255) {
      return res.status(400).json({ error: 'Site name is too long', fields: { name: 'Must be at most 255 characters' } });
    }
    if (await siteNameTaken(name)) {
      return res.status(400).json({ error: 'This site name is already in use.' });
    }
    const slug = slugify(name);
    const { rows } = await query(
      `INSERT INTO sites (name, slug, map_center_lat, map_center_lng, default_zoom)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, slug, mapCenterLat || null, mapCenterLng || null, defaultZoom || 15]
    );
    await logAction({ req, action: 'CREATE', tableName: 'sites', recordId: rows[0].id,
      siteId: rows[0].id, newValues: rows[0] });
    res.status(201).json({ site: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateSite(req, res, next) {
  try {
    const { name, mapCenterLat, mapCenterLng, defaultZoom, status } = req.body || {};
    if (name != null && String(name).length > 255) {
      return res.status(400).json({ error: 'Site name is too long', fields: { name: 'Must be at most 255 characters' } });
    }
    if (status != null && String(status).length > 50) {
      return res.status(400).json({ error: 'Invalid status', fields: { status: 'Must be at most 50 characters' } });
    }
    if (name && await siteNameTaken(name, req.params.id)) {
      return res.status(400).json({ error: 'This site name is already in use.' });
    }
    // Snapshot the row before updating so the audit log can record old values.
    const before = await query('SELECT * FROM sites WHERE id = $1', [req.params.id]);
    if (!before.rows[0]) return res.status(404).json({ error: 'Site not found' });
    const { rows } = await query(
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
    if (!rows[0]) return res.status(404).json({ error: 'Site not found' });
    await logAction({ req, action: 'UPDATE', tableName: 'sites', recordId: rows[0].id,
      siteId: rows[0].id, oldValues: before.rows[0], newValues: rows[0] });
    res.json({ site: rows[0] });
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
