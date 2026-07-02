const { query } = require('../config/database');
const { logAction } = require('../services/auditService');
const { parsePagination, parseSort, buildResponse } = require('../utils/listQuery');

const SITE_SORT_COLS = ['name', 'slug', 'status', 'default_zoom', 'created_at'];

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Admins see all sites; other roles see only their assigned sites.
// Supports pagination/sort/search; non-paginated callers still get `data`.
async function listSites(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { orderBy } = parseSort(req.query, SITE_SORT_COLS, 'id');

    const conditions = [];
    const params = [];
    // Non-admins are scoped to their assigned sites.
    if (req.user.role !== 'admin') {
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

async function createSite(req, res, next) {
  try {
    const { name, mapCenterLat, mapCenterLng, defaultZoom } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Site name is required' });
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
      siteId: rows[0].id, newValues: rows[0] });
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
      siteId: rows[0].id });
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
  listSites, createSite, updateSite, deleteSite, assignUser, removeUser,
};
