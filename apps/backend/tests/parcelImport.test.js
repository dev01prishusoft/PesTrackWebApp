const xlsx = require('xlsx');
const db = require('../src/config/database');

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

const { importParcels } = require('../src/services/parcelImportService');

// Builds a real .xlsx buffer, so the sheet parsing runs for real.
function sheetBuffer(rows, { titleRow = false } = {}) {
  const aoa = [];
  if (titleRow) aoa.push(['PesTrack parcel list', '', '']);
  aoa.push(['Parcel Name', 'Coordinate', 'Quadrant']);
  aoa.push(...rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(aoa), 'Parcels');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('importParcels', () => {
  beforeEach(() => db.query.mockReset());

  // existing: rows already stored for the site; final: what a re-read returns.
  function mockDb({ existing = [], final = null } = {}) {
    let inserted = 0;
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT * FROM parcels')) return { rows: existing };
      if (sql.includes('INSERT INTO parcels')) {
        inserted += 1;
        return { rows: [{ id: `new-${inserted}`, parcel_name: params[1], coordinate: params[2], lat: params[3], lng: params[4], quadrant: params[5] }] };
      }
      if (sql.includes('UPDATE parcels')) {
        return { rows: [{ id: params[0], lat: params[1], lng: params[2], quadrant: params[3] }] };
      }
      if (sql.includes('SELECT DISTINCT parcel_id FROM locations')) return { rows: [] };
      if (sql.includes('DELETE FROM parcels')) return { rows: [] };
      if (sql.includes('SELECT parcel_name, quadrant, lat, lng FROM parcels')) {
        return { rows: final ?? [] };
      }
      return { rows: [] };
    });
  }

  test('imports every valid row and returns the snapshot pair for the audit log', async () => {
    mockDb({
      final: [
        { parcel_name: 'Phase II', quadrant: 'B', lat: '27.410000', lng: '33.690000' },
        { parcel_name: 'Nines', quadrant: 'A', lat: '27.400000', lng: '33.680000' },
      ],
    });

    const result = await importParcels({
      siteId: 'site-1',
      buffer: sheetBuffer([
        ['Nines', '27.400000, 33.680000', 'A'],
        ['Phase II', '27.410000, 33.690000', 'B'],
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.response.totalRows).toBe(2);
    expect(result.response.skipped).toEqual([]);
    expect(result.response.message).toBe('Successfully processed 2 parcels.');
    expect(result.oldParcels).toEqual([]);
    // Snapshot is name-sorted with numeric coordinates, not Postgres strings.
    expect(result.newParcels).toEqual([
      { parcel_name: 'Nines', quadrant: 'A', lat: 27.4, lng: 33.68 },
      { parcel_name: 'Phase II', quadrant: 'B', lat: 27.41, lng: 33.69 },
    ]);
  });

  test('finds the header row when the sheet opens with a title', async () => {
    mockDb({ final: [{ parcel_name: 'Nines', quadrant: 'A', lat: '27.4', lng: '33.68' }] });

    const result = await importParcels({
      siteId: 'site-1',
      buffer: sheetBuffer([['Nines', '27.400000, 33.680000', 'A']], { titleRow: true }),
    });

    expect(result.ok).toBe(true);
    expect(result.response.totalRows).toBe(1);
  });

  test('reports a quadrant change against the stored parcel', async () => {
    mockDb({
      existing: [{ id: 'p1', parcel_name: 'Nines', quadrant: 'A', lat: '27.400000', lng: '33.680000' }],
      final: [{ parcel_name: 'Nines', quadrant: 'C', lat: '27.4', lng: '33.68' }],
    });

    const result = await importParcels({
      siteId: 'site-1',
      buffer: sheetBuffer([['Nines', '27.400000, 33.680000', 'C']]),
    });

    expect(result.ok).toBe(true);
    expect(result.response.quadChanges).toEqual(['"Nines": A → C']);
    expect(result.response.coordChanges).toEqual([]);
  });

  test('skips a row with an unusable coordinate', async () => {
    mockDb({ final: [{ parcel_name: 'Nines', quadrant: 'A', lat: '27.4', lng: '33.68' }] });

    const result = await importParcels({
      siteId: 'site-1',
      buffer: sheetBuffer([
        ['Nines', '27.400000, 33.680000', 'A'],
        ['Broken', 'not-a-coordinate', 'B'],
      ]),
    });

    expect(result.ok).toBe(true);
    expect(result.response.totalRows).toBe(1);
    expect(result.response.skipped).toEqual([
      { name: 'Broken', reason: 'missing or out-of-range coordinate' },
    ]);
  });

  test('rejects a sheet with no recognisable header', async () => {
    mockDb();
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet([['a', 'b'], ['1', '2']]), 'S');

    const result = await importParcels({
      siteId: 'site-1',
      buffer: xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' }),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/header row/);
  });

  test('rejects a sheet whose every row is invalid, writing nothing', async () => {
    mockDb();

    const result = await importParcels({
      siteId: 'site-1',
      buffer: sheetBuffer([['Broken', 'nope', 'B']]),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('No valid parcel rows found in file');
    expect(db.query.mock.calls.some((c) => c[0].includes('INSERT INTO parcels'))).toBe(false);
    expect(db.query.mock.calls.some((c) => c[0].includes('DELETE FROM parcels'))).toBe(false);
  });
});
