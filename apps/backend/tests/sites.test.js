const db = require('../src/config/database');
const parcelImport = require('../src/services/parcelImportService');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('../src/services/parcelImportService', () => ({
  ...jest.requireActual('../src/services/parcelImportService'),
  importParcels: jest.fn(),
}));

const { createSite, updateSite } = require('../src/controllers/siteController');

describe('createSite audit log', () => {
  beforeEach(() => {
    db.query.mockReset();
    db.withTransaction.mockReset();
    parcelImport.importParcels.mockReset();
  });

  const loggedNewValues = () =>
    JSON.parse(db.query.mock.calls.find((c) => c[0].includes('INSERT INTO audit_logs'))[1][6]);

  // Captures the statements run inside the create transaction.
  let txQuery;

  function mockDb() {
    txQuery = jest.fn(async (sql) => {
      if (sql.includes('INSERT INTO sites')) {
        return { rows: [{
          id: 'site-uuid-new',
          name: 'El Gouna 3',
          slug: 'el-gouna-3',
          map_center_lat: '27.400000',
          map_center_lng: '33.680000',
          default_zoom: 15,
          status: 'active',
        }] };
      }
      return { rows: [] };
    });
    db.withTransaction.mockImplementation(async (fn) => fn({ query: txQuery }));
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT 1 FROM sites')) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM users WHERE id = ANY')) {
        return { rows: [{ full_name: 'John Doe', username: 'jdoe' }, { full_name: null, username: 'msmith' }] };
      }
      if (sql.includes('INSERT INTO audit_logs')) return { rowCount: 1 };
      return { rows: [] };
    });
  }

  const res = () => ({
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  });

  const reqFor = (body) => ({
    body,
    user: { id: 'admin-uuid' },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'Jest' },
  });

  test('assigns the initial users and reports them in one CREATE row', async () => {
    mockDb();
    const r = res();
    const next = jest.fn();

    await createSite(reqFor({
      name: 'El Gouna 3',
      mapCenterLat: 27.4,
      mapCenterLng: 33.68,
      defaultZoom: 15,
      userIds: ['user-uuid-1', 'user-uuid-2'],
    }), r, next);

    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(201);

    // Both assignments went in with the site, inside the same transaction.
    const assignments = txQuery.mock.calls.filter((c) => c[0].includes('INSERT INTO user_sites'));
    expect(assignments.map((c) => c[1])).toEqual([
      ['user-uuid-1', 'site-uuid-new'],
      ['user-uuid-2', 'site-uuid-new'],
    ]);

    // One audit row, carrying the site fields plus the assigned user names.
    const auditRows = db.query.mock.calls.filter((c) => c[0].includes('INSERT INTO audit_logs'));
    expect(auditRows).toHaveLength(1);
    expect(loggedNewValues()).toEqual({
      name: 'El Gouna 3',
      slug: 'el-gouna-3',
      map_center_lat: 27.4,
      map_center_lng: 33.68,
      default_zoom: 15,
      status: 'active',
      users: ['John Doe', 'msmith'],
    });
  });

  test('creating a site with no users logs an empty user list', async () => {
    mockDb();
    const r = res();
    const next = jest.fn();

    await createSite(reqFor({ name: 'El Gouna 3', mapCenterLat: 27.4, mapCenterLng: 33.68 }), r, next);

    expect(next).not.toHaveBeenCalled();
    expect(txQuery.mock.calls.filter((c) => c[0].includes('INSERT INTO user_sites'))).toHaveLength(0);
    expect(loggedNewValues().users).toEqual([]);
  });

  test('rejects a non-array userIds instead of silently ignoring it', async () => {
    mockDb();
    const r = res();
    const next = jest.fn();

    await createSite(reqFor({ name: 'El Gouna 3', userIds: 'user-uuid-1' }), r, next);

    expect(r.statusCode).toBe(400);
    expect(db.withTransaction).not.toHaveBeenCalled();
  });

  test('accepts a multipart body, where every field arrives as a string', async () => {
    mockDb();
    const r = res();
    const next = jest.fn();

    await createSite(reqFor({
      name: 'El Gouna 3',
      mapCenterLat: '27.4',
      mapCenterLng: '33.68',
      defaultZoom: '15',
      userIds: JSON.stringify(['user-uuid-1', 'user-uuid-2']),
    }), r, next);

    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(201);
    const insert = txQuery.mock.calls.find((c) => c[0].includes('INSERT INTO sites'));
    expect(insert[1]).toEqual(['El Gouna 3', 'el-gouna-3', 27.4, 33.68, 15]);
    expect(loggedNewValues().users).toEqual(['John Doe', 'msmith']);
  });

  test('folds an attached parcel sheet into the same CREATE row', async () => {
    mockDb();
    parcelImport.importParcels.mockResolvedValue({
      ok: true,
      oldParcels: [],
      newParcels: [{ parcel_name: 'Phase II', quadrant: 'A', lat: 27.4, lng: 33.68 }],
      response: { message: 'Successfully processed 1 parcels.', quadChanges: [], coordChanges: [] },
    });

    const r = res();
    const next = jest.fn();
    const req = reqFor({ name: 'El Gouna 3', userIds: ['user-uuid-1'] });
    req.file = { buffer: Buffer.from('xlsx-bytes') };

    await createSite(req, r, next);

    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(201);
    expect(parcelImport.importParcels).toHaveBeenCalledWith({
      siteId: 'site-uuid-new',
      buffer: req.file.buffer,
    });

    // Still exactly one audit row, now carrying site + users + parcels.
    expect(db.query.mock.calls.filter((c) => c[0].includes('INSERT INTO audit_logs'))).toHaveLength(1);
    const logged = loggedNewValues();
    expect(logged.name).toBe('El Gouna 3');
    expect(logged.users).toEqual(['John Doe', 'msmith']);
    expect(logged.parcels).toEqual([{ parcel_name: 'Phase II', quadrant: 'A', lat: 27.4, lng: 33.68 }]);

    // The parcel summary reaches the client so the change-warning dialog works.
    expect(r.body.parcels.message).toBe('Successfully processed 1 parcels.');
  });

  test('keeps the site and reports the error when the sheet cannot be read', async () => {
    mockDb();
    parcelImport.importParcels.mockResolvedValue({
      ok: false,
      status: 400,
      body: { error: 'No valid parcel rows found in file' },
    });

    const r = res();
    const next = jest.fn();
    const req = reqFor({ name: 'El Gouna 3' });
    req.file = { buffer: Buffer.from('bad') };

    await createSite(req, r, next);

    expect(next).not.toHaveBeenCalled();
    // The site was already committed, so it is reported as created, not discarded.
    expect(r.statusCode).toBe(201);
    expect(r.body.site.id).toBe('site-uuid-new');
    expect(r.body.parcelError).toBe('No valid parcel rows found in file');
    const logged = loggedNewValues();
    expect(logged.parcelError).toBe('No valid parcel rows found in file');
    expect(logged.parcels).toBeUndefined();
  });

  test('does not touch the parcel import when no sheet is attached', async () => {
    mockDb();
    const r = res();
    const next = jest.fn();

    await createSite(reqFor({ name: 'El Gouna 3' }), r, next);

    expect(parcelImport.importParcels).not.toHaveBeenCalled();
    expect(loggedNewValues().parcels).toBeUndefined();
  });
});

describe('updateSite audit log', () => {
  beforeEach(() => {
    db.query.mockReset();
    db.withTransaction.mockReset();
    parcelImport.importParcels.mockReset();
  });

  const STORED_SITE = {
    id: 'site-uuid-1',
    name: 'El Gouna 1',
    slug: 'el-gouna-1',
    map_center_lat: '27.400000',
    map_center_lng: '33.680000',
    default_zoom: 15,
    status: 'active',
  };

  const auditCalls = () => db.query.mock.calls.filter((c) => c[0].includes('INSERT INTO audit_logs'));
  const loggedSides = () => {
    const params = auditCalls()[0][1];
    return { old: JSON.parse(params[5]), new: JSON.parse(params[6]) };
  };

  let txQuery;

  // `stored` is the row before the save; `after` what the UPDATE returns.
  function mockDb({ after = STORED_SITE, assigned = [] } = {}) {
    txQuery = jest.fn(async (sql) => {
      if (sql.includes('SELECT user_id FROM user_sites')) {
        return { rows: assigned.map((id) => ({ user_id: id })) };
      }
      if (sql.includes('UPDATE sites')) return { rows: [after] };
      return { rows: [] };
    });
    db.withTransaction.mockImplementation(async (fn) => fn({ query: txQuery }));
    const NAMES = { 'user-uuid-1': 'John Doe', 'user-uuid-old': 'Old Hand' };
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT 1 FROM sites')) return { rowCount: 0, rows: [] };
      if (sql.includes('SELECT * FROM sites')) return { rows: [STORED_SITE] };
      // Resolve per id, so the two sides of the diff differ when the people do.
      if (sql.includes('FROM users WHERE id = ANY')) {
        return { rows: params[0].map((id) => ({ full_name: NAMES[id] || null, username: id })) };
      }
      if (sql.includes('INSERT INTO audit_logs')) return { rowCount: 1 };
      return { rows: [] };
    });
  }

  const res = () => ({
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  });

  const reqFor = (body, file) => ({
    body,
    params: { id: 'site-uuid-1' },
    user: { id: 'admin-uuid' },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'Jest' },
    ...(file ? { file } : {}),
  });

  test('replacing only the parcel sheet writes one row naming the parcel change', async () => {
    mockDb();
    parcelImport.importParcels.mockResolvedValue({
      ok: true,
      oldParcels: [{ parcel_name: 'Nines', quadrant: 'A', lat: 27.4, lng: 33.68 }],
      newParcels: [{ parcel_name: 'Nines', quadrant: 'C', lat: 27.4, lng: 33.68 }],
      response: { message: 'Successfully processed 1 parcels.', quadChanges: ['"Nines": A → C'], coordChanges: [] },
    });

    const r = res();
    const next = jest.fn();
    // Same site fields as stored — only the sheet is new.
    await updateSite(reqFor({ name: 'El Gouna 1' }, { buffer: Buffer.from('xlsx') }), r, next);

    expect(next).not.toHaveBeenCalled();
    // One entry, not a blank site row plus a parcel row.
    expect(auditCalls()).toHaveLength(1);
    const { old, new: nw } = loggedSides();
    expect(nw.changed).toBe(true);
    expect(nw.changedFields).toEqual(['parcels']);
    expect(old.parcels).toEqual([{ parcel_name: 'Nines', quadrant: 'A', lat: 27.4, lng: 33.68 }]);
    expect(nw.parcels).toEqual([{ parcel_name: 'Nines', quadrant: 'C', lat: 27.4, lng: 33.68 }]);
    expect(r.body.parcels.quadChanges).toEqual(['"Nines": A → C']);
  });

  test('reports a changed user list in the same row', async () => {
    mockDb({ assigned: ['user-uuid-old'] });
    const r = res();
    const next = jest.fn();

    await updateSite(reqFor({ name: 'El Gouna 1', userIds: ['user-uuid-1'] }), r, next);

    expect(next).not.toHaveBeenCalled();
    expect(auditCalls()).toHaveLength(1);
    const { new: nw } = loggedSides();
    expect(nw.changedFields).toEqual(['users']);
    expect(nw.users).toEqual(['John Doe']);
    // Assignments were replaced inside the transaction.
    expect(txQuery.mock.calls.some((c) => c[0].includes('DELETE FROM user_sites'))).toBe(true);
    expect(txQuery.mock.calls.filter((c) => c[0].includes('INSERT INTO user_sites'))).toHaveLength(1);
  });

  test('leaves assignments alone when userIds is not sent', async () => {
    mockDb({ assigned: ['user-uuid-old'] });
    const r = res();

    await updateSite(reqFor({ name: 'El Gouna 2' }), r, jest.fn());

    expect(txQuery.mock.calls.some((c) => c[0].includes('DELETE FROM user_sites'))).toBe(false);
    const { new: nw } = loggedSides();
    expect(nw.users).toBeUndefined();
  });

  test('does not blank coordinates when a save omits them', async () => {
    mockDb();
    const r = res();

    await updateSite(reqFor({ name: 'El Gouna 1' }), r, jest.fn());

    const update = txQuery.mock.calls.find((c) => c[0].includes('UPDATE sites'));
    // undefined leaves the COALESCE to keep the stored value; null would wipe it.
    expect(update[1][2]).toBeUndefined();
    expect(update[1][3]).toBeUndefined();
    expect(update[1][4]).toBeUndefined();
  });

  test('keeps the site update and reports a rejected sheet', async () => {
    mockDb();
    parcelImport.importParcels.mockResolvedValue({
      ok: false, status: 400, body: { error: 'No valid parcel rows found in file' },
    });
    const r = res();

    await updateSite(reqFor({ name: 'El Gouna 1' }, { buffer: Buffer.from('bad') }), r, jest.fn());

    expect(r.body.parcelError).toBe('No valid parcel rows found in file');
    expect(loggedSides().new.parcelError).toBe('No valid parcel rows found in file');
  });
});
