const bcrypt = require('bcrypt');
const { query, withTransaction } = require('../config/database');
const { logAction } = require('../services/auditService');
const { parsePagination, parseSort, buildResponse } = require('../utils/listQuery');
const {
  validate, required, optional, isString, isBoolean, isArray,
  minLen, maxLen, oneOf, isEmail,
} = require('../utils/validate');

const VALID_ROLES = ['admin', 'engineer', 'client_viewer'];
const USER_SORT_COLS = ['u.full_name', 'u.username', 'u.email', 'u.role', 'u.is_active', 'u.created_at', 'u.last_login'];

// Shared SELECT that includes assigned site ids + names.
const USER_SELECT = `
  SELECT u.id, u.username, u.email, u.full_name, u.role, u.is_active,
         u.last_login, u.created_at,
         COALESCE(json_agg(json_build_object('id', s.id, 'name', s.name))
                  FILTER (WHERE s.id IS NOT NULL), '[]') AS sites
  FROM users u
  LEFT JOIN user_sites us ON us.user_id = u.id
  LEFT JOIN sites s ON s.id = us.site_id
`;

async function listUsers(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { orderBy } = parseSort(req.query, USER_SORT_COLS, 'u.id');

    // Optional filters: search (name/username/email), role, isActive.
    const conditions = [];
    const params = [];
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      conditions.push(`(u.full_name ILIKE $${params.length} OR u.username ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }
    if (req.query.role && VALID_ROLES.includes(req.query.role)) {
      params.push(req.query.role);
      conditions.push(`u.role = $${params.length}`);
    }
    if (req.query.isActive === 'true' || req.query.isActive === 'false') {
      params.push(req.query.isActive === 'true');
      conditions.push(`u.is_active = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*)::int AS total FROM users u ${where}`, params);
    const total = countRes.rows[0].total;

    params.push(limit, offset);
    const { rows } = await query(
      `${USER_SELECT} ${where} GROUP BY u.id ORDER BY ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(buildResponse({ rows, total, page, limit }));
  } catch (err) {
    next(err);
  }
}

async function getUser(req, res, next) {
  try {
    const { rows } = await query(
      `${USER_SELECT} WHERE u.id = $1 GROUP BY u.id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function createUser(req, res, next) {
  try {
    validate(req.body, {
      username: [required, isString, minLen(3), maxLen(100)],
      email: [required, isEmail],
      password: [required, isString, minLen(6)],
      fullName: [optional, isString, maxLen(255)],
      role: [optional, isString, oneOf(VALID_ROLES)],
      isActive: [optional, isBoolean],
      siteIds: [optional, isArray],
    });
    const { username, email, password, fullName, role, isActive, siteIds } = req.body;
    const hash = await bcrypt.hash(password, 12);

    const user = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, username, email, full_name, role, is_active`,
        [username, email, hash, fullName || null, role || 'engineer', isActive !== false]
      );
      const created = rows[0];
      for (const siteId of siteIds || []) {
        await client.query(
          `INSERT INTO user_sites (user_id, site_id) VALUES ($1,$2)
           ON CONFLICT (user_id, site_id) DO NOTHING`,
          [created.id, siteId]
        );
      }
      return created;
    });

    await logAction({ req, action: 'CREATE', tableName: 'users', recordId: user.id,
      newValues: { username, email, role: role || 'engineer', isActive: isActive !== false, siteIds: siteIds || [] } });
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    validate(req.body, {
      email: [optional, isEmail],
      fullName: [optional, isString, maxLen(255)],
      role: [optional, isString, oneOf(VALID_ROLES)],
      isActive: [optional, isBoolean],
      siteIds: [optional, isArray],
    });
    const { email, fullName, role, isActive, siteIds } = req.body || {};

    const updated = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE users SET
           email      = COALESCE($2, email),
           full_name  = COALESCE($3, full_name),
           role       = COALESCE($4, role),
           is_active  = COALESCE($5, is_active),
           updated_at = NOW()
         WHERE id = $1
         RETURNING id, username, email, full_name, role, is_active`,
        [req.params.id, email, fullName, role, isActive]
      );
      if (!rows[0]) return null;

      // If siteIds provided, replace the assignment set.
      if (Array.isArray(siteIds)) {
        await client.query('DELETE FROM user_sites WHERE user_id = $1', [req.params.id]);
        for (const siteId of siteIds) {
          await client.query(
            `INSERT INTO user_sites (user_id, site_id) VALUES ($1,$2)
             ON CONFLICT (user_id, site_id) DO NOTHING`,
            [req.params.id, siteId]
          );
        }
      }
      return rows[0];
    });

    if (!updated) return res.status(404).json({ error: 'User not found' });
    await logAction({ req, action: 'UPDATE', tableName: 'users', recordId: updated.id,
      newValues: { email, fullName, role, isActive, siteIds } });
    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
}

// Soft-delete = deactivate (brief: deactivate / reactivate, never hard delete via UI).
async function deactivateUser(req, res, next) {
  try {
    const { rows } = await query(
      `UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE id = $1
       RETURNING id, username, is_active`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    await logAction({ req, action: 'UPDATE', tableName: 'users', recordId: rows[0].id,
      newValues: { is_active: false } });
    res.json({ user: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    validate(req.body, {
      password: [required, isString, minLen(6)],
    });
    const { password } = req.body;
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1
       RETURNING id, username`,
      [req.params.id, hash]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    await logAction({ req, action: 'UPDATE', tableName: 'users', recordId: rows[0].id,
      newValues: { password: 'reset' } });
    res.json({ message: 'Password reset', user: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listUsers, getUser, createUser, updateUser, deactivateUser, resetPassword,
};
