const xlsx = require('xlsx');
const { query } = require('../config/database');
const { logAction } = require('../services/auditService');

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

    // Read the file from buffer
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet);

    if (!data.length) {
      return res.status(400).json({ error: 'Uploaded sheet is empty' });
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
    const coordChanges = []; // a stored point was replaced by a different one
    const coordAdded = [];   // every stored point kept, sheet supplies extra ones
    const multiQuadrant = []; // one parcel name carrying several quadrants
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

      // Names are compared as strings: a numeric-looking cell ("12") arrives from
      // xlsx as a number and would never match the text stored in the column,
      // re-inserting that parcel on every upload.
      const sameName = (p) => String(p.parcel_name) === String(name);

      // Collect the sheet's rows per parcel name. Change detection runs once
      // after the loop, on whole sets — see the block below for why it cannot be
      // decided one row at a time.
      const nameKey = String(name);
      if (!sheetRowsByName.has(nameKey)) sheetRowsByName.set(nameKey, []);
      sheetRowsByName.get(nameKey).push({ lat, lng, quad: quadrant != null ? String(quadrant).trim() : '' });

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
          [op.id, lat, lng, quadrant, rawCoordStr]
        );
        parcelRow = rows[0];
      } else {
        const { rows } = await query(
          `INSERT INTO parcels (site_id, parcel_name, coordinate, lat, lng, quadrant, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
          [siteId, name, rawCoordStr, lat, lng, quadrant]
        );
        parcelRow = rows[0];
      }
      insertedParcels.push(parcelRow);
    }

    // ── Change detection ─────────────────────────────────────────────────
    // A parcel name holds one row per coordinate, so the sheet and the database
    // each describe a SET of points per name, and a change is only meaningful
    // between whole sets. Deciding it per row conflated two different events:
    // a sheet that MOVES a point, and a sheet that ADDS another point to the
    // same parcel. Uploading the 46-row sheet and then the 80-row one — which
    // keeps every original point and only adds more — reported 13 parcels as
    // "coordinates moved" while nothing had moved.
    //
    // So the two are reported as separate things rather than one being folded
    // into the other:
    //   moved  — a stored coordinate is GONE and a different one replaced it
    //   added  — every stored coordinate is still there, the sheet adds more
    // Both shift auto-detection for new findings, so both are worth showing;
    // only "moved" means a point the site already surveyed is no longer where
    // it was. Pure removals stay silent — replace semantics and the kept-in-use
    // list already cover them.
    for (const [name, sheetRows] of sheetRowsByName) {
      const stored = existingParcels.filter((p) => String(p.parcel_name) === name);
      if (!stored.length) continue; // brand-new parcel, nothing to compare against

      const storedPts = stored.filter((p) => p.lat != null && p.lng != null);
      const sheetPts = sheetRows.filter((r) => r.lat != null && r.lng != null);
      if (storedPts.length && sheetPts.length) {
        const inSheet = (p) => sheetPts.some((r) => sameCoord(p.lat, r.lat) && sameCoord(p.lng, r.lng));
        const inStored = (r) => storedPts.some((p) => sameCoord(p.lat, r.lat) && sameCoord(p.lng, r.lng));
        const lost = storedPts.filter((p) => !inSheet(p));
        const gained = sheetPts.filter((r) => !inStored(r));
        // One entry per affected POINT, not per parcel: a parcel that gained four
        // coordinates is listed four times. The list is a per-point record of what
        // the sheet did, matching the standalone client's output.
        if (lost.length && gained.length) {
          gained.forEach(() => coordChanges.push(`"${name}"`));
        } else if (gained.length) {
          gained.forEach(() => coordAdded.push(`"${name}"`));
        }
      }

      // Same rule for quadrants: a parcel that keeps its quadrant and merely
      // gains a row in another one has not been reassigned.
      const storedQuads = [...new Set(stored.map((p) => (p.quadrant != null ? String(p.quadrant).trim() : '')).filter(Boolean))];
      const sheetQuads = [...new Set(sheetRows.map((r) => r.quad).filter(Boolean))];
      if (storedQuads.length && sheetQuads.length) {
        const lostQuads = storedQuads.filter((q) => !sheetQuads.includes(q));
        if (lostQuads.length) {
          quadChanges.push(`"${name}": ${lostQuads.join('/')} → ${sheetQuads.join('/')}`);
        }
      }
    }

    // ── Sheet self-consistency: one parcel name, several quadrants ───────
    // Unlike the checks above this compares the sheet against itself, not
    // against history, so it fires on a first upload too. A finding on such a
    // parcel has no single quadrant to group under in the PDF, and the parcel's
    // rows disagree about where it belongs.
    for (const [name, sheetRows] of sheetRowsByName) {
      const quads = [...new Set(sheetRows.map((r) => r.quad).filter(Boolean))];
      if (quads.length > 1) multiQuadrant.push(`"${name}": ${quads.join(', ')}`);
    }

    // Sheet order is arbitrary, so group each parcel's entries together by name.
    // Sorted on the bare name: the surrounding quotes would otherwise outrank the
    // space in a name and file "Cyan the Range" ahead of "Cyan".
    const byName = (a, b) =>
      a.replace(/"/g, '').localeCompare(b.replace(/"/g, ''), undefined, { sensitivity: 'base' });
    quadChanges.sort(byName);
    coordChanges.sort(byName);
    coordAdded.sort(byName);
    multiQuadrant.sort(byName);

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

    // ── Audit payload ────────────────────────────────────────────────────
    // A bare "Uploaded N parcels" message made it impossible to see what the
    // upload actually did. Log the site's parcel list — name, quadrant and
    // coordinates — before and after, so the two panes of the audit viewer read
    // as a diff. Postgres returns numerics as strings, so lat/lng are coerced to
    // numbers; otherwise an unchanged coordinate would render as "27.4" on one
    // side and 27.4 on the other. Fully identical rows collapse to one entry.
    const toParcelSnapshot = (rows) => {
      const seen = new Map();
      for (const p of rows) {
        const name = p.parcel_name == null ? '' : String(p.parcel_name);
        const quadrant = p.quadrant == null ? null : String(p.quadrant);
        const lat = p.lat != null ? Number(p.lat) : null;
        const lng = p.lng != null ? Number(p.lng) : null;
        const key = `${name}|${quadrant}|${lat}|${lng}`;
        if (!seen.has(key)) seen.set(key, { parcel_name: name, quadrant, lat, lng });
      }
      return [...seen.values()].sort(
        (a, b) =>
          a.parcel_name.localeCompare(b.parcel_name) ||
          String(a.quadrant).localeCompare(String(b.quadrant)) ||
          (a.lat ?? 0) - (b.lat ?? 0) ||
          (a.lng ?? 0) - (b.lng ?? 0)
      );
    };

    // Re-read the parcel set so the "new" side reflects the deletions above,
    // not just the rows this upload touched.
    const { rows: finalParcels } = await query(
      'SELECT parcel_name, quadrant, lat, lng FROM parcels WHERE site_id = $1',
      [siteId]
    );

    await logAction({
      req,
      action: 'UPDATE',
      // The upload rewrites many parcel rows at once, so there is no single
      // parcel to point at. Named after the table it actually changes, with the
      // site as the scope — same `site:<id>` convention the bulk finding clear uses.
      tableName: 'parcels',
      recordId: `site:${siteId}`,
      siteId,
      oldValues: { parcels: toParcelSnapshot(existingParcels) },
      newValues: { parcels: toParcelSnapshot(finalParcels) },
    });

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

    res.json({
      message: parts.join(' '),
      parcels: insertedParcels,
      totalRows: insertedParcels.length,
      skipped,
      quadChanges,
      coordChanges,
      coordAdded,
      multiQuadrant,
      removed,
      keptInUse,
    });
  } catch (err) {
    console.error('Error uploading parcel XLSX:', err);
    res.status(422).json({
      error: 'Failed to process parcel XLSX file. Please ensure the Excel contains valid columns (parcel name, coordinate, quadrant) and try again.'
    });
  }
}

module.exports = { getParcels, uploadParcels };
