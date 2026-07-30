const db = require('../src/config/database');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('bcrypt', () => ({ hash: jest.fn(async () => 'hashed-pw') }));

const { createUser } = require('../src/controllers/userController');

describe('createUser audit log', () => {
  beforeEach(() => {
    db.query.mockReset();
    db.withTransaction.mockReset();
  });

  // Reads the new_values payload written by the audit insert.
  const loggedNewValues = () =>
    JSON.parse(db.query.mock.calls.find((c) => c[0].includes('INSERT INTO audit_logs'))[1][6]);

  function mockDb() {
    db.withTransaction.mockImplementation(async (fn) => fn({
      query: jest.fn(async (sql) => {
        if (sql.includes('INSERT INTO users')) {
          return { rows: [{ id: 'user-uuid-new', username: 'jdoe', email: 'j@x.com', full_name: 'John Doe', role: 'engineer', is_active: true }] };
        }
        return { rows: [] };
      }),
    }));
    db.query.mockImplementation(async (sql) => {
      // No username / email / full name conflicts.
      if (sql.includes('SELECT 1 FROM users')) return { rowCount: 0, rows: [] };
      if (sql.includes('SELECT name FROM sites')) {
        return { rows: [{ name: 'El Gouna 1' }, { name: 'El Gouna 2' }] };
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

  test('records every submitted field and resolves site ids to names', async () => {
    mockDb();
    const r = res();
    const next = jest.fn();

    await createUser(reqFor({
      username: 'jdoe',
      email: 'j@x.com',
      password: 'Passw0rd!',
      fullName: 'John Doe',
      role: 'engineer',
      isActive: true,
      siteIds: ['site-uuid-1', 'site-uuid-2'],
    }), r, next);

    expect(next).not.toHaveBeenCalled();
    expect(r.statusCode).toBe(201);

    expect(loggedNewValues()).toEqual({
      username: 'jdoe',
      email: 'j@x.com',
      fullName: 'John Doe',
      role: 'engineer',
      isActive: true,
      sites: ['El Gouna 1', 'El Gouna 2'],
    });
  });

  test('logs an admin with no site assignments as an empty site list', async () => {
    mockDb();
    const r = res();
    const next = jest.fn();

    await createUser(reqFor({
      username: 'boss',
      email: 'boss@x.com',
      password: 'Passw0rd!',
      fullName: 'Big Boss',
      role: 'admin',
      siteIds: ['site-uuid-1'],
    }), r, next);

    expect(next).not.toHaveBeenCalled();
    const logged = loggedNewValues();
    expect(logged.role).toBe('admin');
    expect(logged.fullName).toBe('Big Boss');
    expect(logged.sites).toEqual([]);
  });
});
