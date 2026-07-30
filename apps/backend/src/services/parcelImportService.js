const xlsx = require('xlsx');
const { query } = require('../config/database');

// Parcel snapshot used by the audit log: name, quadrant and coordinates, in a
// stable order. Postgres returns numerics as strings, so lat/lng are coerced to
// numbers; otherwise an unchanged coordinate would render as "27.4" on one side
// and 27.4 on the other.
//
// Every stored row is listed, including ones identical to another. Collapsing
// identical rows hid the only thing that distinguished them — that there are two
// — so a sheet whose extra row added a parcel was logged as "changed: false"
// against a snapshot that looked untouched, while the response reported one more
// parcel than the audit could account for.
function toParcelSnapshot(rows) {
  const out = rows.map((p) => ({
    parcel_name: p.parcel_name == null ? '' : String(p.parcel_name),
    quadrant: p.quadrant == null ? null : String(p.quadrant),
    lat: p.lat != null ? Number(p.lat) : null,
    lng: p.lng != null ? Number(p.lng) : null,
  }));
  return out.sort(
    (a, b) =>
      a.parcel_name.localeCompare(b.parcel_name) ||
      String(a.quadrant).localeCompare(String(b.quadrant)) ||
      (a.lat ?? 0) - (b.lat ?? 0) ||
      (a.lng ?? 0) - (b.lng ?? 0)
  );
}

/**
 * Applies an uploaded parcel sheet to a site: parses the workbook, inserts or
 * updates each row, removes parcels the sheet no longer lists, and re-maps
 * unassigned findings to their nearest parcel.
 *
 * Shared by the standalone upload endpoint and by site creation, so a site and
 * its initial parcel list can be recorded as one action. Writes no audit row and
 * touches no request/response — the caller decides how to report the result.
 *
 * Returns `{ ok: false, status, body }` for a sheet that cannot be applied, or
 * `{ ok: true, response, oldParcels, newParcels }` where `response` is the
 * caller-facing summary and the two snapshots are the audit log's old/new sides.
 */
async function importParcels({ siteId, buffer }) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Header-row detection, matching the standalone client: a sheet may open with
  // a title or a blank row, so scan the first few rows for the one that names
  // the columns. sheet_to_json's default (row 1 is always the header) turned
  // every such sheet into zero parcels with no explanation.
  const grid = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  if (!grid.length) {
    return { ok: false, status: 400, body: { error: 'Uploaded sheet is empty' } };
  }

  const HEADER_SCAN_ROWS = 5;
  // The client requires a "coord" column; lat/lng are also accepted here
  // because this endpoint has always supported that layout.
  const isHeaderRow = (cells) =>
    cells.some((c) => c.includes('parcel')) &&
    cells.some((c) => c.includes('coord') || c.includes('lat'));

  let headerIdx = -1;
  for (let i = 0; i < Math.min(grid.length, HEADER_SCAN_ROWS); i++) {
    if (isHeaderRow(grid[i].map((c) => String(c).toLowerCase()))) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Could not find a header row — the sheet needs columns: parcel name, coordinate, quadrant' },
    };
  }

  const headers = grid[headerIdx].map((c) => String(c).toLowerCase().trim());
  if (!headers.some((h) => h.includes('quad'))) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Columns not recognised — need: "parcel name", "coordinate", "quadrant"' },
    };
  }

  // Rebuild the rows as objects keyed by the detected header, so the column
  // lookup below is unchanged.
  const data = grid.slice(headerIdx + 1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = cells[i] !== undefined ? cells[i] : ''; });
    return obj;
  });

  if (!data.length) {
    return { ok: false, status: 400, body: { error: 'Uploaded sheet is empty' } };
  }

  // Fetch existing parcels to track quad/coord updates for warnings in deterministic order.
  // Selects the whole row so a parcel matched as an exact duplicate below can be
  // returned in the response untouched, without re-reading it.
  const { rows: existingParcels } = await query(
    'SELECT * FROM parcels WHERE site_id = $1 ORDER BY created_at ASC, id ASC',
    [siteId]
  );
  const usedParcelIds = new Set();

  const insertedParcels = [];
  const skipped = []; // rows that violated a column length limit
  const quadChanges = [];
  const coordChanges = [];
  const sheetRowsByName = new Map(); // parcel name -> [{ lat, lng, quad }] from this sheet

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

  // Coordinates are stored as numerics and come back from Postgres as strings,
  // so compare numerically with a tolerance rather than by equality. 1e-6 deg
  // is ~0.1 m — below the precision the sheets actually carry (6 decimals),
  // so this only ever matches coordinates meant to be the same point.
  const sameCoord = (a, b) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Math.abs(Number(a) - Number(b)) < 1e-6;
  };

  for (const row of data) {
    // Find keys case-insensitively. An exact alias match wins; `loose` then
    // falls back to a substring match the way the client does
    // (headers.findIndex(h => h.includes('parcel'))), so a heading such as
    // "Parcel Name (EN)" is still recognised instead of silently yielding null.
    const findVal = (keys, loose) => {
      const exact = Object.keys(row).find(k => keys.includes(k.toLowerCase().trim()));
      if (exact) return row[exact];
      if (!loose) return null;
      const partial = Object.keys(row).find(k => k.toLowerCase().includes(loose));
      return partial ? row[partial] : null;
    };

    const name = findVal(['parcel_name', 'name', 'parcel', 'parcel name'], 'parcel');
    const latVal = findVal(['lat', 'latitude', 'lat.', 'y', 'lat(n)', 'latitude(n)', 'point_y']);
    const lngVal = findVal(['lng', 'longitude', 'lng.', 'lon', 'long', 'x', 'lon(e)', 'longitude(e)', 'point_x']);
    const gpsVal = findVal(['coordinate', 'gps', 'coordinates', 'location', 'lat,long', 'lat,lng', 'gps coordinates'], 'coord');
    const quadrant = findVal(['quadrant', 'quad', 'zone'], 'quad');

    if (!name || !quadrant) continue; // Skip rows without parcel name or quadrant (matches client standalone HTML)
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

    const rawCoordStr = gpsVal ? String(gpsVal).trim() : (latVal !== null && lngVal !== null ? `${latVal}, ${lngVal}` : null);

    // A row must carry a usable point on the globe, as in the client's
    // parseCoordCell — it returns null for an unparseable or out-of-range cell
    // and the row is dropped. Previously a row whose coordinate failed to parse
    // was still inserted with lat/lng NULL, giving a parcel that auto-detection
    // can never match and that shows no marker.
    const quad = String(quadrant).trim().toUpperCase();
    const hasPoint =
      lat != null && lng != null && !isNaN(lat) && !isNaN(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    if (!hasPoint) {
      skipped.push({ name: String(name), reason: 'missing or out-of-range coordinate' });
      continue;
    }

    // A row repeating an earlier one exactly is kept, not merged: the sheet is
    // the source of truth for how many rows a parcel has, and the standalone
    // client stores one entry per row too. The audit snapshot lists every row
    // for the same reason, so the count and the log agree.

    // Names are compared as strings: a numeric-looking cell ("12") arrives from
    // xlsx as a number and would never match the text stored in the column,
    // re-inserting that parcel on every upload.
    const sameName = (p) => String(p.parcel_name) === String(name);

    // Collect the sheet's rows per parcel name. Change detection runs once
    // after the loop, on whole sets — see the block below for why it cannot be
    // decided one row at a time.
    const nameKey = String(name);
    if (!sheetRowsByName.has(nameKey)) sheetRowsByName.set(nameKey, []);
    sheetRowsByName.get(nameKey).push({ lat, lng, quad });

    // Prefer the row with the same name AND the same coordinates — that is the
    // same physical parcel, so the import updates it rather than adding a copy.
    // Falling back to any unused row with this name covers a parcel whose
    // coordinates the sheet has moved.
    const op =
      existingParcels.find(
        (p) => sameName(p) && !usedParcelIds.has(p.id) &&
               sameCoord(p.lat, lat) && sameCoord(p.lng, lng)
      ) || existingParcels.find(p => sameName(p) && !usedParcelIds.has(p.id));

    let parcelRow;
    if (op) {
      usedParcelIds.add(op.id);
      const { rows } = await query(
        `UPDATE parcels
            SET lat = COALESCE($2, lat),
                lng = COALESCE($3, lng),
                quadrant = COALESCE($4, quadrant),
                coordinate = COALESCE($5, coordinate),
                updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [op.id, lat, lng, quad, rawCoordStr]
      );
      parcelRow = rows[0];
    } else {
      const { rows } = await query(
        `INSERT INTO parcels (site_id, parcel_name, coordinate, lat, lng, quadrant, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
        [siteId, name, rawCoordStr, lat, lng, quad]
      );
      parcelRow = rows[0];
    }
    insertedParcels.push(parcelRow);
  }

  // Every row failed validation. Refusing here rather than carrying on keeps a
  // malformed sheet from being reported as a successful upload, and mirrors
  // the client's "No valid parcel rows found in file". Nothing was written,
  // because each row was skipped before its INSERT/UPDATE.
  if (!insertedParcels.length) {
    return { ok: false, status: 400, body: { error: 'No valid parcel rows found in file', skipped } };
  }

  // ── Change detection ─────────────────────────────────────────────────
  // The standalone client's algorithm, unchanged, with the previous parcel
  // list coming from the database instead of localStorage:
  //
  //   newParcels.forEach(np => {
  //     const op = prevParcels.find(p => p.name === np.name);
  //     if (op.quad !== np.quad)      quadChanges.push(`"name": old → new`);
  //     else if (moved > 0.0001)      coordChanges.push(`"name"`);
  //   });
  //
  // Both sides must be in sheet-row order for this to mean anything, which is
  // why it runs here rather than in the browser: `existingParcels` is loaded
  // ORDER BY created_at, id — insertion order, i.e. the row order of the sheet
  // that produced it — and the loop below walks the new sheet in its own order.
  // The browser only ever sees the reloaded list sorted by name, where "the
  // first row of this parcel" is a different row than the sheet's first.
  //
  // One entry per sheet row, so a parcel matching several rows is listed
  // several times, exactly as the client lists it.
  for (const [name, sheetRows] of sheetRowsByName) {
    const op = existingParcels.find((p) => String(p.parcel_name) === name);
    if (!op) continue; // brand-new parcel, nothing to compare against
    const opQuad = op.quadrant != null ? String(op.quadrant).trim().toUpperCase() : '';

    for (const r of sheetRows) {
      if (opQuad !== r.quad) {
        quadChanges.push(`"${name}": ${opQuad || 'None'} → ${r.quad || 'None'}`);
      } else if (op.lat != null && op.lng != null && r.lat != null && r.lng != null) {
        const dLat = Math.abs(Number(op.lat) - r.lat);
        const dLng = Math.abs(Number(op.lng) - r.lng);
        if (dLat > 0.0001 || dLng > 0.0001) coordChanges.push(`"${name}"`);
      }
    }
  }

  // Sheet order is arbitrary, so group each parcel's entries together by name.
  // Sorted on the bare name: the surrounding quotes would otherwise outrank the
  // space in a name and file "Cyan the Range" ahead of "Cyan".
  const byName = (a, b) =>
    a.replace(/"/g, '').localeCompare(b.replace(/"/g, ''), undefined, { sensitivity: 'base' });
  quadChanges.sort(byName);
  coordChanges.sort(byName);

  // ── Replace semantics ────────────────────────────────────────────────
  // The uploaded sheet defines the COMPLETE parcel set for the site (per the
  // brief: "upload replaces the site's parcel set"). Any existing parcel we did
  // not touch during this upload is no longer in the sheet and is removed —
  // EXCEPT parcels still referenced by a finding, which we keep so their
  // findings stay intact (locations.parcel_id has no ON DELETE cascade).
  // Guarded by insertedParcels.length so an empty/all-invalid upload can never
  // wipe the existing set.
  const removed = [];
  const keptInUse = [];
  if (insertedParcels.length > 0) {
    const staleIds = existingParcels
      .filter((p) => !usedParcelIds.has(p.id))
      .map((p) => p.id);

    if (staleIds.length) {
      // Which stale parcels are still referenced by a finding on this site?
      const { rows: refRows } = await query(
        `SELECT DISTINCT parcel_id FROM locations
          WHERE site_id = $1 AND parcel_id = ANY($2::uuid[])`,
        [siteId, staleIds]
      );
      const referenced = new Set(refRows.map((r) => r.parcel_id));
      const deletableIds = staleIds.filter((id) => !referenced.has(id));

      if (deletableIds.length) {
        const { rows: delRows } = await query(
          `DELETE FROM parcels WHERE id = ANY($1::uuid[]) RETURNING parcel_name`,
          [deletableIds]
        );
        removed.push(...delRows.map((r) => r.parcel_name));
      }
      // Parcels we could NOT remove because findings still use them.
      for (const p of existingParcels) {
        if (referenced.has(p.id)) keptInUse.push(p.parcel_name);
      }
    }
  }

  // Auto-map any unassigned finding locations for this site to their nearest parcel
  await query(
    `UPDATE locations l
        SET parcel_id = sub.parcel_id
       FROM (
         SELECT DISTINCT ON (l.id) l.id AS loc_id, p.id AS parcel_id
           FROM locations l
           JOIN parcels p ON p.site_id = l.site_id
          WHERE l.site_id = $1 AND l.parcel_id IS NULL AND p.lat IS NOT NULL AND p.lng IS NOT NULL
          ORDER BY l.id, ((l.lat - p.lat)^2 + (l.lng - p.lng)^2) ASC
       ) sub
      WHERE l.id = sub.loc_id`,
    [siteId]
  );

  // Re-read the parcel set so the "new" side reflects the deletions above,
  // not just the rows this upload touched.
  const { rows: finalParcels } = await query(
    'SELECT parcel_name, quadrant, lat, lng FROM parcels WHERE site_id = $1',
    [siteId]
  );

  // Human-readable summary covering processed / skipped / removed / kept.
  const parts = [
    skipped.length
      ? `Processed ${insertedParcels.length} parcels. Skipped ${skipped.length} invalid row(s).`
      : `Successfully processed ${insertedParcels.length} parcels.`,
  ];
  if (removed.length) parts.push(`Removed ${removed.length} parcel(s) no longer in the sheet.`);
  if (keptInUse.length) {
    parts.push(`Kept ${keptInUse.length} parcel(s) not in the sheet because findings still reference them.`);
  }

  return {
    ok: true,
    oldParcels: toParcelSnapshot(existingParcels),
    newParcels: toParcelSnapshot(finalParcels),
    response: {
      message: parts.join(' '),
      parcels: insertedParcels,
      totalRows: insertedParcels.length,
      skipped,
      quadChanges,
      coordChanges,
      removed,
      keptInUse,
    },
  };
}

// Message shown when the workbook itself could not be processed. Kept here so
// both the upload endpoint and site creation report a failed sheet identically.
const PARCEL_PARSE_ERROR =
  'Failed to process parcel XLSX file. Please ensure the Excel contains valid columns (parcel name, coordinate, quadrant) and try again.';

module.exports = { importParcels, toParcelSnapshot, PARCEL_PARSE_ERROR };
