const { addVisit } = require('../src/controllers/findingController');
const db = require('../src/config/database');

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
  });

  test('addVisit resolves and stores visit values in audit log', async () => {
    // Mock the location retrieval query
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('SELECT * FROM locations')) {
        return { rows: [{ id: 'location-uuid-123', site_id: 'site-uuid-123', parcel_id: 'parcel-uuid-123', lat: '27.502105', lng: '33.568656' }] };
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
    expect(auditParams[2]).toBe('CREATE');
    expect(auditParams[3]).toBe('visits');
    expect(auditParams[4]).toBe('visit-uuid-123'); // recordId
    
    // oldValues should contain location info and empty photos
    const oldValuesObj = JSON.parse(auditParams[5]);
    expect(oldValuesObj).toEqual({
      parcel: 'Parcel 44',
      lat: 27.502105,
      lng: 33.568656,
      photos: [],
    });
    
    // newValues should contain the resolved JSON, coordinates, parcel, and photos
    const newValuesObj = JSON.parse(auditParams[6]);
    expect(newValuesObj).toEqual({
      visit_date: '2026-07-07T00:00:00.000Z',
      category: 'Construction Debris',
      escalation: 'Client FM',
      status: '1st Offense',
      label: 'Sample Label',
      notes: 'Sample Notes',
      parcel: 'Parcel 44',
      lat: 27.502105,
      lng: 33.568656,
      photos: [],
    });
  });
});
