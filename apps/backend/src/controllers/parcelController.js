const { query } = require('../config/database');
const { logAction } = require('../services/auditService');
const { importParcels, PARCEL_PARSE_ERROR } = require('../services/parcelImportService');

async function getParcels(req, res, next) {
  try {
    const { siteId } = req.query;
    if (!siteId) {
      return res.status(400).json({ error: 'siteId query parameter is required' });
    }
    // A parcel name holds one row per coordinate, so parcel_name alone is not a
    // total order — Postgres was free to return the five "Nines" rows in any
    // order, and callers that take the first row of a name (the upload diff)
    // then compared against an arbitrary one. created_at/id pin it to insertion
    // order, i.e. the row order of the sheet the parcels came from.
    const { rows } = await query(
      'SELECT * FROM parcels WHERE site_id = $1 ORDER BY parcel_name ASC, created_at ASC, id ASC',
      [siteId]
    );
    res.json({ parcels: rows });
  } catch (err) {
    next(err);
  }
}

async function uploadParcels(req, res, next) {
  try {
    const { siteId } = req.body;
    if (!siteId) {
      return res.status(400).json({ error: 'siteId is required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'XLSX file is required' });
    }

    const result = await importParcels({ siteId, buffer: req.file.buffer });
    if (!result.ok) {
      return res.status(result.status).json(result.body);
    }

    await logAction({
      req,
      action: 'UPDATE',
      // The upload rewrites many parcel rows at once, so there is no single
      // parcel to point at. Named after the table it actually changes, with the
      // site as the scope — same `site:<id>` convention the bulk finding clear uses.
      tableName: 'parcels',
      recordId: `site:${siteId}`,
      siteId,
      oldValues: { parcels: result.oldParcels },
      newValues: { parcels: result.newParcels },
    });

    res.json(result.response);
  } catch (err) {
    console.error('Error uploading parcel XLSX:', err);
    res.status(422).json({ error: PARCEL_PARSE_ERROR });
  }
}

module.exports = { getParcels, uploadParcels };
