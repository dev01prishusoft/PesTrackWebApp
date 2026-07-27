const { query } = require('../config/database');
const { parsePagination, parseSort, buildResponse } = require('../utils/listQuery');

const AUDIT_SORT_COLS = ['a.created_at', 'a.action', 'a.table_name', 'u.username', 's.name'];

// Admin audit-log viewer: filters (userId, action, from, to, search) + pagination + sort.
async function listAudit(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { orderBy } = parseSort(req.query, AUDIT_SORT_COLS, 'a.created_at');

    const conditions = [];
    const params = [];

    if (req.query.userId) { params.push(req.query.userId); conditions.push(`a.user_id = $${params.length}`); }
    if (req.query.siteId) { params.push(req.query.siteId); conditions.push(`a.site_id = $${params.length}`); }
    if (req.query.action) { params.push(String(req.query.action).toUpperCase()); conditions.push(`a.action = $${params.length}`); }
    if (req.query.from)   { params.push(req.query.from); conditions.push(`a.created_at >= $${params.length}`); }
    if (req.query.to)     { params.push(req.query.to);   conditions.push(`a.created_at <= $${params.length}`); }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conditions.push(`(a.table_name ILIKE $${params.length} OR a.record_id ILIKE $${params.length} OR u.username ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*)::int AS total
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN sites s ON s.id = a.site_id
        ${where}`,
      params
    );
    const total = countRes.rows[0].total;

    params.push(limit, offset);
    const { rows } = await query(
      // a.site_id is the raw column; s.name is joined so the viewer can show the
      // site a row belongs to without a second lookup. It stays null for rows
      // logged without a site (login, user admin) and for a since-deleted site.
      `SELECT a.*, u.username, s.name AS site_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN sites s ON s.id = a.site_id
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(buildResponse({ rows, total, page, limit }));
  } catch (err) {
    next(err);
  }
}

module.exports = { listAudit };
