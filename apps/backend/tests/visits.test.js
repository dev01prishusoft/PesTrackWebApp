const db = require('../src/config/database');
const storageService = require('../src/services/storageService');

jest.mock('../src/services/storageService', () => {
  const original = jest.requireActual('../src/services/storageService');
  return {
    ...original,
    uploadBase64Photo: jest.fn(),
    deletePhotos: jest.fn(),
  };
});

const { addVisit, importBulk, deleteVisit } = require('../src/controllers/findingController');

jest.mock('../src/config/database', () => {
  const original = jest.requireActual('../src/config/database');
  return {
    ...original,
    query: jest.fn(),
    withTransaction: jest.fn((fn) => fn({
      query: jest.fn(async (sql, params) => {
        if (sql.includes('INSERT INTO visits')) {
          return {
            rows: [{
              id: 'visit-uuid-123',
              location_id: 'location-uuid-123',
              visit_date: '2026-07-07T00:00:00.000Z',
              category_id: 'cat-uuid-123',
              label: 'Sample Label',
              notes: 'Sample Notes',
              escalated_to_id: 'esc-uuid-123',
              status_id: 'status-uuid-123',
              created_by: 'user-uuid-123',
              engineer_id: 'eng-uuid-123',
            }],
          };
        }
        if (sql.includes('SELECT * FROM locations')) {
          return {
            rows: [{
              id: 'location-uuid-123',
              site_id: 'site-uuid-123',
              parcel_id: 'parcel-uuid-123',
              lat: '27.502105',
              lng: '33.568656',
              ref_num: 'F-mock-123',
            }],
          };
        }
        return { rows: [] };
      }),
    })),
  };
});

describe('addVisit audit logs integration', () => {
  beforeEach(() => {
    db.query.mockReset();
    storageService.uploadBase64Photo.mockReset();
    storageService.deletePhotos.mockReset();
  });

  test('addVisit resolves and stores visit values in audit log', async () => {
    // Mock the location retrieval query
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT * FROM locations')) {
        return { rows: [{ id: 'location-uuid-123', site_id: 'site-uuid-123', parcel_id: 'parcel-uuid-123', lat: '27.502105', lng: '33.568656', ref_num: 'F-mock-123' }] };
      }
      if (sql.includes('SELECT label FROM categories')) {
        return { rows: [{ label: 'Construction Debris' }] };
      }
      if (sql.includes('SELECT label FROM statuses')) {
        return { rows: [{ label: '1st Offense' }] };
      }
      if (sql.includes('SELECT label FROM escalation_options')) {
        return { rows: [{ label: 'Client FM' }] };
      }
      if (sql.includes('SELECT parcel_name FROM parcels')) {
        return { rows: [{ parcel_name: 'Parcel 44' }] };
      }
      if (sql.includes('FROM users')) {
        return { rows: [{ full_name: 'Jane Engineer', username: 'jane' }] };
      }
      if (sql.includes('INSERT INTO audit_logs')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    const req = {
      body: {
        siteId: 'site-uuid-123',
        visitDate: '2026-07-07',
        categoryId: 'cat-uuid-123',
        label: 'Sample Label',
        notes: 'Sample Notes',
        escalatedToId: 'esc-uuid-123',
        statusId: 'status-uuid-123',
        photos: [],
      },
      params: {
        locationId: 'location-uuid-123',
      },
      user: {
        id: 'user-uuid-123',
      },
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'Jest Test',
      },
    };

    const res = {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };

    const next = jest.fn();

    await addVisit(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe('Visit added');

    // Verify that logAction was called by checking the query call for INSERT INTO audit_logs
    const auditInsertCall = db.query.mock.calls.find(call => call[0].includes('INSERT INTO audit_logs'));
    expect(auditInsertCall).toBeDefined();

    const auditParams = auditInsertCall[1];
    // Parameters mapping in logAction query:
    // [userId, siteId, action, tableName, recordId, oldValues, newValues, ip, userAgent]
    // Adding a visit creates a row that didn't exist before, so it is a CREATE
    expect(auditParams[2]).toBe('CREATE');
    expect(auditParams[3]).toBe('visits');
    expect(auditParams[4]).toBe('visit-uuid-123'); // recordId

    // Nothing on the parent location moved, so the old side carries only the
    // ref_num that identifies the finding
    expect(JSON.parse(auditParams[5])).toEqual({ ref_num: 'F-mock-123' });

    // newValues carries the full created visit — a CREATE has no diff metadata
    const newValuesObj = JSON.parse(auditParams[6]);
    expect(newValuesObj).toEqual({
      visit_date: '2026-07-07T00:00:00.000Z',
      category: 'Construction Debris',
      escalation: 'Client FM',
      status: '1st Offense',
      label: 'Sample Label',
      notes: 'Sample Notes',
      engineer: 'Jane Engineer',
      photos: [],
      ref_num: 'F-mock-123',
      parcel: 'Parcel 44',
      lat: 27.502105,
      lng: 33.568656,
    });
    expect(newValuesObj.changed).toBeUndefined();
    expect(newValuesObj.changedFields).toBeUndefined();
  });

  test('addVisit records the old parcel when the add also moves the finding', async () => {
    // In-transaction reads see the location after updateLocationFields ran, so
    // the parcel differs from the row findLocation fetched beforehand.
    db.withTransaction.mockImplementationOnce(async (fn) => fn({
      query: jest.fn(async (sql) => {
        if (sql.includes('INSERT INTO visits')) {
          return { rows: [{ id: 'visit-uuid-123', visit_date: '2026-07-07T00:00:00.000Z', category_id: 'cat-uuid-123', label: 'Sample Label', notes: 'Sample Notes', escalated_to_id: 'esc-uuid-123', status_id: 'status-uuid-123' }] };
        }
        if (sql.includes('SELECT * FROM locations')) {
          return { rows: [{ id: 'location-uuid-123', parcel_id: 'parcel-uuid-999', lat: '27.502105', lng: '33.568656', ref_num: 'F-mock-123' }] };
        }
        return { rows: [] };
      }),
    }));

    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT * FROM locations')) {
        return { rows: [{ id: 'location-uuid-123', site_id: 'site-uuid-123', parcel_id: 'parcel-uuid-123', lat: '27.502105', lng: '33.568656', ref_num: 'F-mock-123' }] };
      }
      if (sql.includes('SELECT label FROM categories')) return { rows: [{ label: 'Construction Debris' }] };
      if (sql.includes('SELECT label FROM statuses')) return { rows: [{ label: '1st Offense' }] };
      if (sql.includes('SELECT label FROM escalation_options')) return { rows: [{ label: 'Client FM' }] };
      if (sql.includes('SELECT parcel_name FROM parcels')) {
        return { rows: [{ parcel_name: params[0] === 'parcel-uuid-999' ? 'Parcel 99' : 'Parcel 44' }] };
      }
      if (sql.includes('INSERT INTO audit_logs')) return { rowCount: 1 };
      return { rows: [] };
    });

    const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    const next = jest.fn();

    await addVisit({
      body: {
        siteId: 'site-uuid-123',
        visitDate: '2026-07-07',
        categoryId: 'cat-uuid-123',
        label: 'Sample Label',
        notes: 'Sample Notes',
        escalatedToId: 'esc-uuid-123',
        statusId: 'status-uuid-123',
        parcel_id: 'parcel-uuid-999',
        photos: [],
      },
      params: { locationId: 'location-uuid-123' },
      user: { id: 'user-uuid-123' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Jest Test' },
    }, res, next);

    expect(next).not.toHaveBeenCalled();
    const auditParams = db.query.mock.calls.find(call => call[0].includes('INSERT INTO audit_logs'))[1];
    expect(JSON.parse(auditParams[5])).toEqual({
      ref_num: 'F-mock-123',
      parcel: 'Parcel 44',
      lat: 27.502105,
      lng: 33.568656,
    });
    expect(JSON.parse(auditParams[6]).parcel).toBe('Parcel 99');
  });

  test('addVisit skips audit log when X-Bulk-Import header is set to true', async () => {
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT * FROM locations')) {
        return { rows: [{ id: 'location-uuid-123', site_id: 'site-uuid-123', parcel_id: 'parcel-uuid-123', lat: '27.502105', lng: '33.568656', ref_num: 'F-mock-123' }] };
      }
      if (sql.includes('SELECT label FROM categories')) {
        return { rows: [{ label: 'Construction Debris' }] };
      }
      if (sql.includes('SELECT label FROM statuses')) {
        return { rows: [{ label: '1st Offense' }] };
      }
      if (sql.includes('SELECT label FROM escalation_options')) {
        return { rows: [{ label: 'Client FM' }] };
      }
      if (sql.includes('SELECT parcel_name FROM parcels')) {
        return { rows: [{ parcel_name: 'Parcel 44' }] };
      }
      if (sql.includes('INSERT INTO audit_logs')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    const req = {
      body: {
        siteId: 'site-uuid-123',
        visitDate: '2026-07-07',
        categoryId: 'cat-uuid-123',
        label: 'Sample Label',
        notes: 'Sample Notes',
        escalatedToId: 'esc-uuid-123',
        statusId: 'status-uuid-123',
        photos: [],
      },
      params: {
        locationId: 'location-uuid-123',
      },
      user: {
        id: 'user-uuid-123',
      },
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'Jest Test',
        'x-bulk-import': 'true',
      },
    };

    const res = {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };

    const next = jest.fn();

    await addVisit(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe('Visit added');

    // Verify that logAction was NOT called by checking the query call for INSERT INTO audit_logs
    const auditInsertCall = db.query.mock.calls.find(call => call[0].includes('INSERT INTO audit_logs'));
    expect(auditInsertCall).toBeUndefined();
  });

  test('importBulk successfully inserts locations, visits, zones, and uploads base64 photos to S3', async () => {
    storageService.uploadBase64Photo.mockResolvedValue({ key: 'photos/mock-new.jpg', url: 'https://mock/photos/mock-new.jpg' });
    storageService.deletePhotos.mockResolvedValue(true);

    const transactionQueryMock = jest.fn(async (sql, params) => {
      if (sql.includes('SELECT id, lat, lng, parcel_id, ref_num FROM locations')) {
        return { rows: [{ id: 'location-uuid-123', lat: '27.123', lng: '33.123', parcel_id: 'parcel-uuid-123', ref_num: '001' }] };
      }
      if (sql.includes('FROM visits v')) {
        return { rows: [{
          id: 'visit-uuid-123',
          location_id: 'location-uuid-123',
          visit_date: new Date('2026-07-29'),
          category: 'Construction Debris',
          status: '1st Offense',
          escalated: 'Client FM',
          photo_url: 'photos/old-photo.jpg',
          parcel_name: 'Parcel 44'
        }] };
      }
      if (sql.includes('SELECT photo_url')) {
        return { rows: [{ photo_url: 'photos/old-photo.jpg' }] };
      }
      if (sql.includes('INSERT INTO locations')) {
        return { rows: [{ id: 'new-location-uuid' }] };
      }
      if (sql.includes('INSERT INTO visits')) {
        return { rows: [{ id: 'new-visit-uuid' }] };
      }
      return { rows: [] };
    });

    db.withTransaction.mockImplementationOnce(async (fn) => {
      return fn({ query: transactionQueryMock });
    });

    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT id, parcel_name FROM parcels')) {
        return { rows: [{ id: 'parcel-uuid-123', parcel_name: 'Parcel 44' }] };
      }
      if (sql.includes('SELECT id, label FROM categories')) {
        return { rows: [{ id: 'cat-uuid-123', label: 'Construction Debris' }] };
      }
      if (sql.includes('SELECT id, label FROM statuses')) {
        return { rows: [{ id: 'status-uuid-123', label: '1st Offense' }] };
      }
      if (sql.includes('SELECT id, label FROM escalation_options')) {
        return { rows: [{ id: 'esc-uuid-123', label: 'Client FM' }] };
      }
      if (sql.includes('INSERT INTO audit_logs')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    const req = {
      body: {
        siteId: 'site-uuid-123',
        findings: [
          {
            lat: 27.123,
            lng: 33.123,
            parcel_id: 'parcel-uuid-123',
            ref_num: '001',
            visits: [
              {
                visitDate: '2026-07-29',
                categoryId: 'cat-uuid-123',
                label: 'Mock Bulk Visit',
                notes: 'Mock Bulk Notes',
                escalatedToId: 'esc-uuid-123',
                statusId: 'status-uuid-123',
                photos: ['data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...'],
              }
            ]
          }
        ],
        zones: [
          { lat: 27.456, lng: 33.456 }
        ]
      },
      user: {
        id: 'user-uuid-123',
      },
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'Jest Test',
      },
    };

    const res = {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };

    const next = jest.fn();

    await importBulk(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(null);
    expect(res.body.message).toBe('Successfully imported 1 findings');

    expect(storageService.uploadBase64Photo).toHaveBeenCalledWith('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...');
    expect(storageService.deletePhotos).toHaveBeenCalledWith(['photos/old-photo.jpg']);

    const locationInsert = transactionQueryMock.mock.calls.find(call => call[0].includes('INSERT INTO locations'));
    expect(locationInsert).toBeDefined();
    expect(locationInsert[1]).toEqual(['site-uuid-123', 27.123, 33.123, 'parcel-uuid-123', '001', 'user-uuid-123']);

    const visitInsert = transactionQueryMock.mock.calls.find(call => call[0].includes('INSERT INTO visits'));
    expect(visitInsert).toBeDefined();
    expect(visitInsert[1][4]).toBe('Mock Bulk Notes');

    const photoInsert = transactionQueryMock.mock.calls.find(call => call[0].includes('INSERT INTO photos'));
    expect(photoInsert).toBeDefined();
    expect(photoInsert[1][1]).toBe('photos/mock-new.jpg');

    const zoneInsert = transactionQueryMock.mock.calls.find(call => call[0].includes('INSERT INTO construction_zones'));
    expect(zoneInsert).toBeDefined();
    expect(zoneInsert[1]).toEqual(['site-uuid-123', 27.456, 33.456, 'user-uuid-123']);

    const auditInsertCall = db.query.mock.calls.find(call => call[0].includes('INSERT INTO audit_logs'));
    expect(auditInsertCall).toBeDefined();

    // Verify oldValues summary (existing findings on site)
    const oldValues = JSON.parse(auditInsertCall[1][5]);
    expect(oldValues.message).toBe('Existing findings on site before import');
    expect(oldValues.importedData).toBeDefined();
    expect(oldValues.importedData[0].refNum).toBe('001');
    expect(oldValues.importedData[0].parcel).toBe('Parcel 44');
    expect(oldValues.importedData[0].visits[0].category).toBe('Construction Debris');
    expect(oldValues.importedData[0].visits[0].status).toBe('1st Offense');
    expect(oldValues.importedData[0].visits[0].escalated).toBe('Client FM');
    expect(oldValues.importedData[0].visits[0].photos).toEqual(['photos/old-photo.jpg']);

    // Verify newValues summary (newly imported findings)
    const auditValues = JSON.parse(auditInsertCall[1][6]);
    expect(auditValues.message).toBe('Imported 1 findings from JSON backup');
    expect(auditValues.importedData).toBeDefined();
    expect(auditValues.importedData[0].refNum).toBe('001');
    expect(auditValues.importedData[0].parcel).toBe('Parcel 44');
    expect(auditValues.importedData[0].visits[0].category).toBe('Construction Debris');
    expect(auditValues.importedData[0].visits[0].status).toBe('1st Offense');
    expect(auditValues.importedData[0].visits[0].escalated).toBe('Client FM');
    expect(auditValues.importedData[0].visits[0].photos).toEqual(['photos/mock-new.jpg']);
  });

  test('deleteVisit resolves references, includes ref_num and photos, and logs DELETE action', async () => {
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT * FROM locations')) {
        return { rows: [{ id: 'location-uuid-123', site_id: 'site-uuid-123', parcel_id: 'parcel-uuid-123', lat: '27.502105', lng: '33.568656', ref_num: 'F-mock-123' }] };
      }
      if (sql.includes('SELECT photo_url FROM photos WHERE visit_id = ANY')) {
        return { rows: [{ photo_url: 'photos/deleted-visit-photo.jpg' }] };
      }
      if (sql.includes('DELETE FROM visits')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'visit-uuid-123',
            location_id: 'location-uuid-123',
            visit_date: '2026-07-07T00:00:00.000Z',
            category_id: 'cat-uuid-123',
            label: 'Deleted Label',
            notes: 'Deleted Notes',
            escalated_to_id: 'esc-uuid-123',
            status_id: 'status-uuid-123',
            created_by: 'user-uuid-123',
          }]
        };
      }
      if (sql.includes('SELECT id, label FROM categories') || sql.includes('SELECT label FROM categories')) {
        return { rows: [{ label: 'Construction Debris' }] };
      }
      if (sql.includes('SELECT id, label FROM statuses') || sql.includes('SELECT label FROM statuses')) {
        return { rows: [{ label: '1st Offense' }] };
      }
      if (sql.includes('SELECT id, label FROM escalation_options') || sql.includes('SELECT label FROM escalation_options')) {
        return { rows: [{ label: 'Client FM' }] };
      }
      if (sql.includes('INSERT INTO audit_logs')) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    const req = {
      query: {
        siteId: 'site-uuid-123',
      },
      params: {
        locationId: 'location-uuid-123',
        visitId: 'visit-uuid-123',
      },
      user: {
        id: 'user-uuid-123',
      },
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'Jest Test',
      },
    };

    const res = {
      statusCode: null,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
    };

    const next = jest.fn();

    await deleteVisit(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(null);
    expect(res.body.message).toBe('Visit deleted');

    const auditInsertCall = db.query.mock.calls.find(call => call[0].includes('INSERT INTO audit_logs'));
    expect(auditInsertCall).toBeDefined();
    
    expect(auditInsertCall[1][2]).toBe('DELETE');
    expect(auditInsertCall[1][3]).toBe('visits');
    expect(auditInsertCall[1][4]).toBe('visit-uuid-123');

    const oldValues = JSON.parse(auditInsertCall[1][5]);
    expect(oldValues.ref_num).toBe('F-mock-123');
    expect(oldValues.category).toBe('Construction Debris');
    expect(oldValues.status).toBe('1st Offense');
    expect(oldValues.escalation).toBe('Client FM');
    expect(oldValues.photos).toEqual(['photos/deleted-visit-photo.jpg']);
    expect(oldValues.label).toBe('Deleted Label');
    expect(oldValues.notes).toBe('Deleted Notes');
  });
});
