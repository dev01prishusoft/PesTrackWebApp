const { requireRole, requireSiteAccess } = require('../src/middleware/roleCheck');

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

describe('requireRole', () => {
  test('401 when no user', () => {
    const res = mockRes(); let nextCalled = false;
    requireRole('admin')({}, res, () => (nextCalled = true));
    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  test('403 when role not allowed', () => {
    const res = mockRes(); let nextCalled = false;
    requireRole('admin')({ user: { role: 'engineer' } }, res, () => (nextCalled = true));
    expect(res.statusCode).toBe(403);
    expect(nextCalled).toBe(false);
  });

  test('calls next when role allowed', () => {
    const res = mockRes(); let nextCalled = false;
    requireRole('admin', 'engineer')({ user: { role: 'engineer' } }, res, () => (nextCalled = true));
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBeNull();
  });
});

describe('requireSiteAccess', () => {
  const get = (req) => req.params.siteId;

  test('admin bypasses site check', () => {
    const res = mockRes(); let nextCalled = false;
    requireSiteAccess(get)({ user: { role: 'admin', siteIds: [] }, params: { siteId: 99 } }, res, () => (nextCalled = true));
    expect(nextCalled).toBe(true);
  });

  test('403 when engineer not assigned to site', () => {
    const res = mockRes(); let nextCalled = false;
    requireSiteAccess(get)({ user: { role: 'engineer', siteIds: [1, 2] }, params: { siteId: 3 } }, res, () => (nextCalled = true));
    expect(res.statusCode).toBe(403);
    expect(nextCalled).toBe(false);
  });

  test('calls next when engineer assigned to site', () => {
    const res = mockRes(); let nextCalled = false;
    requireSiteAccess(get)({ user: { role: 'engineer', siteIds: [1, 2] }, params: { siteId: 2 } }, res, () => (nextCalled = true));
    expect(nextCalled).toBe(true);
  });
});
