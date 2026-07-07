const { resolveAuditValues } = require('../src/services/auditService');
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
      return { rows: [] };
    });

    const input = {
      visit_date: '2026-07-07T00:00:00.000Z',
      category_id: 'cat-uuid',
      label: 'Sample Label',
      notes: 'Sample Notes',
      escalated_to_id: 'esc-uuid',
      status_id: 'status-uuid',
      siteIds: ['site-1', 'site-2'],
      parcel_id: 'parcel-uuid',
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
    });

    expect(db.query).toHaveBeenCalledTimes(5);
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
