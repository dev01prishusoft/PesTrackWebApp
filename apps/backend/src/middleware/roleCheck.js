/**
 * Role gate. Usage: router.get('/', requireRole('admin'), handler)
 * Assumes req.user is already set by authenticate middleware.
 */
function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

/**
 * Ensures the user is assigned to the given site. Only admins bypass this —
 * they have full access to every site. Engineers and client_viewers are both
 * scoped to their assigned sites (write vs. read is gated separately by
 * requireRole). siteId is resolved from req via the provided getter.
 */
function requireSiteAccess(getSiteId) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role === 'admin') return next();
    const siteId = getSiteId(req);
    if (!siteId || !req.user.siteIds.includes(siteId)) {
      return res.status(403).json({ error: 'No access to this site' });
    }
    next();
  };
}

module.exports = { requireRole, requireSiteAccess };
