const bcrypt = require('bcrypt');
const { query, withTransaction } = require('../config/database');
const { logAction, resolveAuditValues } = require('../services/auditService');
const { parsePagination, parseSort, buildResponse } = require('../utils/listQuery');
const {
  validate, required, optional, isString, isBoolean, isArray,
  minLen, maxLen, oneOf, noSpaces, isEmail,
} = require('../utils/validate');

const VALID_ROLES = ['admin', 'engineer', 'client_viewer'];
const USER_SORT_COLS = ['u.full_name', 'u.username', 'u.email', 'u.role', 'u.is_active', 'u.created_at', 'u.last_login'];
const MIN_ACTIVE_ADMINS = 2;
const ADMIN_DEACTIVATION_ERROR =
  'At least 2 active admins are required. Promote another user to admin before deactivating this account.';

// Block deactivating/deleting an active admin when it would leave fewer than
// MIN_ACTIVE_ADMINS active admins in the system.
async function assertCanRemoveActiveAdmin(userId) {
  const { rows } = await query(
    'SELECT role, is_active FROM users WHERE id = $1',
    [userId]
  );
  if (!rows[0] || rows[0].role !== 'admin' || !rows[0].is_active) return;

  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = true`
  );
  if (countRows[0].count - 1 < MIN_ACTIVE_ADMINS) {
    const err = new Error(ADMIN_DEACTIVATION_ERROR);
    err.status = 400;
    throw err;
  }
}

// Check username / email / full_name aren't already taken by ANOTHER user.
// Case-insensitive. Returns a { field: message } map for any collisions, so the
// caller can throw a 400 with per-field errors the modal renders inline.
// `excludeId` skips the user being edited.
async function findUserConflicts({ username, email, fullName }, excludeId = null) {
  const fields = {};
  const checks = [
    ['username', username, 'username'],
    ['email', email, 'email'],
    ['full_name', fullName, 'fullName'],
  ];
  for (const [col, value, field] of checks) {
    if (value == null || value === '') continue;
    const params = [value];
    let sql = `SELECT 1 FROM users WHERE LOWER(${col}) = LOWER($1)`;
    if (excludeId) { params.push(excludeId); sql += ` AND id <> $2`; }
    const { rowCount } = await query(sql + ' LIMIT 1', params);
    if (rowCount) {
      const label = field === 'fullName' ? 'full name' : field;
      fields[field] = `This ${label} is already in use`;
    }
  }
  return fields;
}

// Turn a conflicts map into a single readable sentence naming the taken fields,
// e.g. "This username is already in use." or
// "This username and email are already in use."
function conflictMessage(conflicts) {
  const labels = Object.keys(conflicts).map((f) => (f === 'fullName' ? 'full name' : f));
  const list =
    labels.length <= 1
      ? labels[0]
      : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  const verb = labels.length > 1 ? 'are' : 'is';
  return `This ${list} ${verb} already in use.`;
}

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
      username: [required, isString, noSpaces, minLen(3), maxLen(100)],
      email: [required, isEmail, maxLen(255)],
      password: [required, isString, minLen(6), maxLen(255)],
      fullName: [optional, isString, maxLen(255)],
      role: [optional, isString, oneOf(VALID_ROLES)],
      isActive: [optional, isBoolean],
      siteIds: [optional, isArray],
    });
    const { username, email, password, fullName, role, isActive, siteIds } = req.body;

    // Enforce unique username / email / full name with friendly per-field errors.
    const conflicts = await findUserConflicts({ username, email, fullName });
    if (Object.keys(conflicts).length) {
      return res.status(400).json({ error: conflictMessage(conflicts), fields: conflicts });
    }

    const effectiveRole = role || 'engineer';

    if (effectiveRole !== 'admin' && (!siteIds || siteIds.length === 0)) {
      return res.status(400).json({
        error: 'At least one site must be assigned',
        fields: { siteIds: 'At least one site must be assigned' },
      });
    }

    const hash = await bcrypt.hash(password, 12);

    const user = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, username, email, full_name, role, is_active`,
        [username, email, hash, fullName || null, effectiveRole, isActive !== false]
      );
      const created = rows[0];
      if (effectiveRole !== 'admin') {
        for (const siteId of siteIds || []) {
          await client.query(
            `INSERT INTO user_sites (user_id, site_id) VALUES ($1,$2)
             ON CONFLICT (user_id, site_id) DO NOTHING`,
            [created.id, siteId]
          );
        }
      }
      return created;
    });

    await logAction({ req, action: 'CREATE', tableName: 'users', recordId: user.id,
      newValues: { username, email, role: effectiveRole, isActive: isActive !== false, siteIds: effectiveRole === 'admin' ? [] : (siteIds || []) } });
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    validate(req.body, {
      email: [optional, isEmail, maxLen(255)],
      fullName: [optional, isString, maxLen(255)],
      role: [optional, isString, oneOf(VALID_ROLES)],
      isActive: [optional, isBoolean],
      siteIds: [optional, isArray],
    });
    const { email, fullName, role, isActive, siteIds } = req.body || {};

    // Unique email / full name among OTHER users (exclude the one being edited).
    const conflicts = await findUserConflicts({ email, fullName }, req.params.id);
    if (Object.keys(conflicts).length) {
      return res.status(400).json({ error: conflictMessage(conflicts), fields: conflicts });
    }

    if (isActive === false) {
      await assertCanRemoveActiveAdmin(req.params.id);
    }

    let before = null;
    const updated = await withTransaction(async (client) => {
      // Snapshot the row (and its site assignments) before updating, for the audit log.
      const cur = await client.query(
        'SELECT email, full_name, role, is_active FROM users WHERE id = $1',
        [req.params.id]
      );
      if (!cur.rows[0]) return null;
      const curSites = await client.query('SELECT site_id FROM user_sites WHERE user_id = $1', [req.params.id]);
      // Use the same field names as newValues so the diff compares like-for-like.
      before = {
        email: cur.rows[0].email,
        fullName: cur.rows[0].full_name,
        role: cur.rows[0].role,
        isActive: cur.rows[0].is_active,
        siteIds: curSites.rows.map((r) => r.site_id),
      };

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

      const effectiveRole = role ?? cur.rows[0].role;

      // Admins have access to all sites — clear any site assignments.
      if (effectiveRole === 'admin') {
        await client.query('DELETE FROM user_sites WHERE user_id = $1', [req.params.id]);
      } else if (Array.isArray(siteIds)) {
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
    // Resolve site id arrays to site names for a readable audit trail.
    const oldValues = before && await resolveAuditValues(before);
    const newValues = await resolveAuditValues({ email, fullName, role, isActive, siteIds });
    await logAction({ req, action: 'UPDATE', tableName: 'users', recordId: updated.id,
      oldValues, newValues });
    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
}

// Hard-delete a user — but ONLY when they have no work referencing them.
// A freshly-created / just-assigned user (only user_sites rows, which cascade)
// is removed permanently. If the user authored any visit, finding, construction
// zone, photo, or audit entry, deletion is blocked with a reference message so
// that history stays intact.
async function deactivateUser(req, res, next) {
  try {
    const userId = req.params.id;

    const exists = await query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'User not found' });

    await assertCanRemoveActiveAdmin(userId);

    // Count references in each table that would be orphaned by a delete.
    const { rows } = await query(
      `SELECT
         (SELECT COUNT(*) FROM visits             WHERE created_by  = $1)::int AS visits,
         (SELECT COUNT(*) FROM locations          WHERE created_by  = $1)::int AS findings,
         (SELECT COUNT(*) FROM construction_zones WHERE created_by  = $1)::int AS zones,
         (SELECT COUNT(*) FROM photos             WHERE uploaded_by = $1)::int AS photos,
         (SELECT COUNT(*) FROM audit_logs         WHERE user_id     = $1)::int AS audit`,
      [userId]
    );
    const refs = rows[0];

    // Build a human list of what's blocking deletion (skip audit — it's internal).
    const blockers = [];
    if (refs.findings) blockers.push(`${refs.findings} finding${refs.findings > 1 ? 's' : ''}`);
    if (refs.visits) blockers.push(`${refs.visits} visit${refs.visits > 1 ? 's' : ''}`);
    if (refs.zones) blockers.push(`${refs.zones} construction zone${refs.zones > 1 ? 's' : ''}`);
    if (refs.photos) blockers.push(`${refs.photos} photo${refs.photos > 1 ? 's' : ''}`);

    if (blockers.length || refs.audit) {
      const detail = blockers.length
        ? `This user has recorded ${blockers.join(', ')} and cannot be deleted. Their work must be preserved.`
        : 'This user has recorded activity in the audit log and cannot be deleted.';
      return res.status(409).json({ error: detail });
    }

    // No work references — safe to hard delete (user_sites cascades).
    await logAction({ req, action: 'DELETE', tableName: 'users', recordId: userId });
    await query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    // Safety net for any FK we didn't explicitly check.
    if (err.code === '23503') {
      return res.status(409).json({ error: 'This user is referenced by existing records and cannot be deleted.' });
    }
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
