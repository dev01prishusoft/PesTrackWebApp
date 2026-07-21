const xlsx = require('xlsx');
const { query } = require('../config/database');
const { logAction } = require('../services/auditService');

async function getParcels(req, res, next) {
  try {
    const { siteId } = req.query;
    if (!siteId) {
      return res.status(400).json({ error: 'siteId query parameter is required' });
    }
    const { rows } = await query(
      'SELECT * FROM parcels WHERE site_id = $1 ORDER BY parcel_name ASC',
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

    // Read the file from buffer
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    if (!data.length) {
      return res.status(400).json({ error: 'Uploaded sheet is empty' });
    }

    // Fetch existing parcels to track quad/coord updates for warnings
    const { rows: existingRows } = await query(
      'SELECT parcel_name, lat, lng, quadrant FROM parcels WHERE site_id = $1',
      [siteId]
    );
    const prevMap = new Map(existingRows.map((r) => [r.parcel_name, r]));

    const insertedParcels = [];
    const skipped = []; // rows that violated a column length limit
    const quadChanges = [];
    const coordChanges = [];

    // Helper to parse DMS, decimal degrees with hemisphere, or space/comma separated coords
    const parseCoordCell = (str) => {
      if (str == null) return null;
      if (typeof str === 'number') return isNaN(str) ? null : str;
      const s = String(str).trim();
      if (!s) return null;

      // DMS: 27°42'30"N
      const dms = s.match(/(\d+)[°d]\s*(\d+)['^m]\s*(\d+\.?\d*)["s]?\s*([NSEW])/i);
      if (dms) {
        let v = +dms[1] + +dms[2] / 60 + +dms[3] / 3600;
        if (/[SW]/i.test(dms[4])) v = -v;
        return v;
      }

      // Decimal Degrees with direction: 27.429844°N or 27.429844 N
      const dd = s.match(/(\d+\.?\d*)\s*[°]?\s*([NSEW])/i);
      if (dd) {
        let v = parseFloat(dd[1]);
        if (/[SW]/i.test(dd[2])) v = -v;
        return v;
      }

      const clean = s.replace(/[°NSEW\s]/gi, ' ').trim();
      const parts = clean.split(/\s+/).map(Number).filter((n) => !isNaN(n));
      if (parts.length >= 1) {
        let v = parts[0];
        if (/S/i.test(s)) v = -Math.abs(v);
        if (/W/i.test(s)) v = -Math.abs(v);
        return v;
      }

      const parsed = parseFloat(s);
      return isNaN(parsed) ? null : parsed;
    };

    for (const row of data) {
      // Find keys case-insensitively
      const findVal = (keys) => {
        const foundKey = Object.keys(row).find(k => keys.includes(k.toLowerCase().trim()));
        return foundKey ? row[foundKey] : null;
      };

      const name = findVal(['parcel_name', 'name', 'parcel', 'parcel name']);
      const latVal = findVal(['lat', 'latitude', 'lat.', 'y', 'lat(n)', 'latitude(n)', 'point_y']);
      const lngVal = findVal(['lng', 'longitude', 'lng.', 'lon', 'long', 'x', 'lon(e)', 'longitude(e)', 'point_x']);
      const gpsVal = findVal(['coordinate', 'gps', 'coordinates', 'location', 'lat,long', 'lat,lng', 'gps coordinates']);
      const quadrant = findVal(['quadrant', 'quad', 'zone']);

      if (!name) continue; // Skip rows without name
      if (String(name).length > 100) { skipped.push({ name: String(name).slice(0, 40), reason: 'name too long (max 100)' }); continue; }
      if (quadrant != null && String(quadrant).length > 10) { skipped.push({ name: String(name), reason: 'quadrant too long (max 10)' }); continue; }

      let lat = null;
      let lng = null;

      if (latVal !== null && lngVal !== null) {
        lat = parseCoordCell(latVal);
        lng = parseCoordCell(lngVal);
      } else if (gpsVal) {
        let parts = String(gpsVal).split(',');
        if (parts.length < 2) {
          parts = String(gpsVal).trim().split(/\s+/);
        }
        if (parts.length >= 2) {
          lat = parseCoordCell(parts[0]);
          lng = parseCoordCell(parts[1]);
        }
      }

      // Check if parcel name already exists for this site
      const existingParcel = await query(
        `SELECT id, lat, lng, quadrant FROM parcels
         WHERE site_id = $1 AND parcel_name = $2
         LIMIT 1`,
        [siteId, name]
      );

      let parcelRow;
      if (existingParcel.rows[0]) {
        const op = existingParcel.rows[0];
        if (quadrant && op.quadrant !== quadrant) {
          quadChanges.push(`"${name}": ${op.quadrant || 'None'} → ${quadrant}`);
        } else if (lat != null && lng != null && (Math.abs(op.lat - lat) > 0.0001 || Math.abs(op.lng - lng) > 0.0001)) {
          coordChanges.push(`"${name}"`);
        }

        const { rows } = await query(
          `UPDATE parcels SET lat = COALESCE($2, lat), lng = COALESCE($3, lng), quadrant = COALESCE($4, quadrant), updated_at = NOW()
           WHERE id = $1 RETURNING *`,
          [op.id, lat, lng, quadrant]
        );
        parcelRow = rows[0];
      } else {
        const { rows } = await query(
          `INSERT INTO parcels (site_id, parcel_name, lat, lng, quadrant, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
          [siteId, name, lat, lng, quadrant]
        );
        parcelRow = rows[0];
      }
      insertedParcels.push(parcelRow);
    }

    await logAction({
      req,
      action: 'UPDATE',
      tableName: 'sites',
      recordId: siteId,
      siteId,
      newValues: { message: `Uploaded ${insertedParcels.length} parcels` }
    });

    res.json({
      message: skipped.length
        ? `Processed ${insertedParcels.length} parcels. Skipped ${skipped.length} invalid row(s).`
        : `Successfully processed ${insertedParcels.length} parcels.`,
      parcels: insertedParcels,
      skipped,
      quadChanges: [...new Set(quadChanges)],
      coordChanges: [...new Set(coordChanges)],
    });
  } catch (err) {
    console.error('Error uploading parcel XLSX:', err);
    res.status(422).json({
      error: 'Failed to process parcel XLSX file. Please ensure the Excel contains valid columns (parcel name, coordinate, quadrant) and try again.'
    });
  }
}

module.exports = { getParcels, uploadParcels };
