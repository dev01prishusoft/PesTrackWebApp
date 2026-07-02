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

    const insertedParcels = [];
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

      let lat = null;
      let lng = null;

      // Helper to parse DMS or decimal degrees string
      const parseCoord = (str) => {
        if (!str) return null;
        if (typeof str === 'number') return str;
        const s = String(str).trim();
        
        // Try DMS: 27°42'30"N
        const dms = s.match(/(\d+)[°d]\s*(\d+)['^m]\s*(\d+\.?\d*)["s]?\s*([NSEW])/i);
        if (dms) {
          let v = +dms[1] + +dms[2] / 60 + +dms[3] / 3600;
          if (/[SW]/i.test(dms[4])) v = -v;
          return v;
        }
        
        // Try Decimal Degrees with direction: 27.429844°N or 27.429844 N
        const dd = s.match(/(\d+\.?\d*)\s*[°]?\s*([NSEW])/i);
        if (dd) {
          let v = parseFloat(dd[1]);
          if (/[SW]/i.test(dd[2])) v = -v;
          return v;
        }

        const parsed = parseFloat(s);
        return isNaN(parsed) ? null : parsed;
      };

      if (latVal !== null && lngVal !== null) {
        lat = parseCoord(latVal);
        lng = parseCoord(lngVal);
      } else if (gpsVal) {
        // Try to split "27.3949, 33.6782" or "27.429844°N 33.654529°E"
        let parts = String(gpsVal).split(',');
        if (parts.length < 2) {
           // Fallback to split by whitespace if no comma found
           parts = String(gpsVal).trim().split(/\s+/);
        }
        
        if (parts.length >= 2) {
          lat = parseCoord(parts[0]);
          lng = parseCoord(parts[1]);
        }
      }

      const { rows } = await query(
        `INSERT INTO parcels (site_id, parcel_name, lat, lng, quadrant, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (site_id, parcel_name) DO UPDATE SET
           lat = EXCLUDED.lat,
           lng = EXCLUDED.lng,
           quadrant = EXCLUDED.quadrant,
           updated_at = NOW()
         RETURNING *`,
        [siteId, name, lat, lng, quadrant]
      );
      insertedParcels.push(rows[0]);
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
      message: `Successfully processed ${insertedParcels.length} parcels.`,
      parcels: insertedParcels,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getParcels, uploadParcels };
