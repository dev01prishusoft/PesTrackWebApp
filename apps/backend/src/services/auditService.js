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

// Bookkeeping columns that move on every write. Comparing them would make an
// update that changed nothing of substance look like a real edit.
const VOLATILE_FIELDS = new Set(['updated_at', 'created_at']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// JSON with object keys sorted, so two payloads assembled in a different key
// order still compare equal. Array order is preserved on purpose — for a photo
// list the order is part of the value.
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(',')}}`;
}

// Names of the fields that actually differ between the two sides.
function diffFields(oldValues, newValues) {
  const keys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);
  const changed = [];
  for (const key of keys) {
    if (VOLATILE_FIELDS.has(key)) continue;
    if (stableStringify(oldValues[key]) !== stableStringify(newValues[key])) changed.push(key);
  }
  return changed.sort();
}

/**
 * Writes an immutable audit row. Mandatory fields per brief: who / what / when / IP.
 * Field-level old/new values are optional (pass when available).
 *
 * Any UPDATE that carries both sides also gets `changed` / `changedFields`
 * stamped onto its new_values, so a save that wrote nothing is visible at a
 * glance instead of having to diff two JSON blobs by eye.
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
  const rawIp = req.ip || req.socket?.remoteAddress || (req.headers && req.headers['x-forwarded-for']) || '';
  const ip = rawIp.replace(/^::ffff:/, '') || null;
  const userAgent = (req.headers && req.headers['user-agent']) || null;

  // The two flags are listed first so they head the payload, then reassigned
  // after the spread so a caller's own `changed` key can never shadow them.
  let oldValuesOut = oldValues;
  let newValuesOut = newValues;
  if (action === 'UPDATE' && isPlainObject(oldValues) && isPlainObject(newValues)) {
    const changedFields = diffFields(oldValues, newValues);
    const filteredOld = {};
    const filteredNew = {};
    for (const key of changedFields) {
      if (key in oldValues) filteredOld[key] = oldValues[key];
      if (key in newValues) filteredNew[key] = newValues[key];
    }
    if ('ref_num' in oldValues) {
      filteredOld.ref_num = oldValues.ref_num;
    }
    if ('ref_num' in newValues) {
      filteredNew.ref_num = newValues.ref_num;
    }
    oldValuesOut = filteredOld;
    newValuesOut = {
      changed: changedFields.length > 0,
      changedFields,
      ...filteredNew
    };
  }

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
      oldValuesOut ? JSON.stringify(oldValuesOut) : null,
      newValuesOut ? JSON.stringify(newValuesOut) : null,
      ip,
      userAgent,
    ]
  );
}

module.exports = { logAction, resolveAuditValues };
