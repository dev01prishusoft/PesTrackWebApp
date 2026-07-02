const { query } = require('../config/database');

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

module.exports = { logAction };
