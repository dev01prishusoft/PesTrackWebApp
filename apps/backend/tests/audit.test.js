const { resolveAuditValues, logAction } = require('../src/services/auditService');
const db = require('../src/config/database');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

describe('resolveAuditValues', () => {
  beforeEach(() => {
    db.query.mockReset();
  });

  test('resolves categories, statuses, and escalation options correctly', async () => {
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('categories')) {
        return { rows: [{ label: 'Construction Debris' }] };
      }
      if (sql.includes('statuses')) {
        return { rows: [{ label: '1st Offense' }] };
      }
      if (sql.includes('escalation_options')) {
        return { rows: [{ label: 'Client FM' }] };
      }
      if (sql.includes('sites')) {
        return { rows: [{ name: 'Site A' }, { name: 'Site B' }] };
      }
      if (sql.includes('parcels')) {
        return { rows: [{ parcel_name: 'Parcel 44' }] };
      }
      if (sql.includes('users')) {
        return { rows: [{ full_name: 'John Doe', username: 'johndoe' }] };
      }
      return { rows: [] };
    });

    const input = {
      id: 'visit-uuid',
      location_id: 'location-uuid',
      created_by: 'user-uuid',
      visit_date: '2026-07-07T00:00:00.000Z',
      category_id: 'cat-uuid',
      label: 'Sample Label',
      notes: 'Sample Notes',
      escalated_to_id: 'esc-uuid',
      status_id: 'status-uuid',
      siteIds: ['site-1', 'site-2'],
      parcel_id: 'parcel-uuid',
      engineer_id: 'eng-uuid',
    };

    const result = await resolveAuditValues(input);

    expect(result).toEqual({
      visit_date: '2026-07-07T00:00:00.000Z',
      category: 'Construction Debris',
      label: 'Sample Label',
      notes: 'Sample Notes',
      escalation: 'Client FM',
      status: '1st Offense',
      sites: ['Site A', 'Site B'],
      parcel: 'Parcel 44',
      engineer: 'John Doe',
    });

    expect(db.query).toHaveBeenCalledTimes(6);
  });

  test('returns input value directly if null or not an object', async () => {
    expect(await resolveAuditValues(null)).toBeNull();
    expect(await resolveAuditValues(undefined)).toBeUndefined();
    expect(await resolveAuditValues('not-an-object')).toBe('not-an-object');
  });

  test('handles missing or empty fields correctly', async () => {
    const input = {
      visit_date: '2026-07-07T00:00:00.000Z',
      category_id: null,
      siteIds: [],
      parcel_id: null,
    };

    const result = await resolveAuditValues(input);

    expect(result).toEqual({
      visit_date: '2026-07-07T00:00:00.000Z',
      sites: [],
    });
  });
});

describe('logAction change detection', () => {
  const req = { user: { id: 'user-uuid' }, ip: '127.0.0.1', headers: { 'user-agent': 'Jest' } };

  beforeEach(() => {
    db.query.mockReset();
    db.query.mockResolvedValue({ rowCount: 1 });
  });

  // Reads the new_values payload written by the last logAction call.
  const loggedNewValues = () => JSON.parse(db.query.mock.calls[0][1][6]);

  test('detects a changed date when the values are Date objects', async () => {
    await logAction({
      req,
      action: 'UPDATE',
      tableName: 'visits',
      recordId: 'visit-uuid',
      oldValues: { label: 'A', visit_date: new Date('2026-07-20') },
      newValues: { label: 'A', visit_date: new Date('2026-07-29') },
    });

    expect(loggedNewValues().changedFields).toEqual(['visit_date']);
  });

  test('treats an unchanged Date as unchanged', async () => {
    await logAction({
      req,
      action: 'UPDATE',
      tableName: 'visits',
      recordId: 'visit-uuid',
      oldValues: { label: 'A', visit_date: new Date('2026-07-20') },
      newValues: { label: 'B', visit_date: new Date('2026-07-20') },
    });

    expect(loggedNewValues().changedFields).toEqual(['label']);
  });

  test('detects a changed date when the values are plain strings', async () => {
    await logAction({
      req,
      action: 'UPDATE',
      tableName: 'visits',
      recordId: 'visit-uuid',
      oldValues: { visit_date: '2026-07-20', notes: 'n' },
      newValues: { visit_date: '2026-07-29', notes: 'n2' },
    });

    expect(loggedNewValues().changedFields).toEqual(['notes', 'visit_date']);
  });
});
