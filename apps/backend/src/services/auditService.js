const { query } = require('../config/database');

// Maps a set of UUID reference fields to human-readable labels so the audit log
// stores names, not opaque ids. Given a values object like
// { category_id, status_id, escalated_to_id, siteIds }, returns a copy where
// those id fields are replaced by { category, status, escalation, sites } labels.
async function resolveAuditValues(values) {
  if (!values || typeof values !== 'object') return values;
  const out = { ...values };

  const lookups = [
    ['category_id', 'category', 'categories'],
    ['status_id', 'status', 'statuses'],
    ['escalated_to_id', 'escalation', 'escalation_options'],
  ];
  for (const [idField, outField, table] of lookups) {
    if (out[idField]) {
      const { rows } = await query(`SELECT label FROM ${table} WHERE id = $1`, [out[idField]]);
      out[outField] = rows[0] ? rows[0].label : out[idField];
      delete out[idField];
    } else if (idField in out) {
      delete out[idField]; // null/empty id → drop it (no meaningful label)
    }
  }

  // Site id arrays → site names.
  if (Array.isArray(out.siteIds)) {
    if (out.siteIds.length) {
      const { rows } = await query('SELECT name FROM sites WHERE id = ANY($1::uuid[])', [out.siteIds]);
      out.sites = rows.map((r) => r.name);
    } else {
      out.sites = [];
    }
    delete out.siteIds;
  }

  // Resolve parcel_id to parcel name.
  if (out.parcel_id) {
    const { rows } = await query('SELECT parcel_name FROM parcels WHERE id = $1', [out.parcel_id]);
    out.parcel = rows[0] ? rows[0].parcel_name : out.parcel_id;
    delete out.parcel_id;
  } else if ('parcel_id' in out) {
    delete out.parcel_id;
  }

  return out;
}

/**
 * Writes an immutable audit row. Mandatory fields per brief: who / what / when / IP.
 * Field-level old/new values are optional (pass when available).
 */
async function logAction({
  req,
  action,          // 'CREATE' | 'UPDATE' | 'DELETE'
  tableName,
  recordId,
  siteId = null,
  oldValues = null,
  newValues = null,
}) {
  const userId = req.user ? req.user.id : null;
  const rawIp = req.ip || req.socket?.remoteAddress || '';
  const ip = rawIp.replace(/^::ffff:/, '') || null;
  const userAgent = req.headers['user-agent'] || null;

  await query(
    `INSERT INTO audit_logs
       (user_id, site_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      userId,
      siteId,
      action,
      tableName,
      recordId != null ? String(recordId) : null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ip,
      userAgent,
    ]
  );
}

module.exports = { logAction, resolveAuditValues };
