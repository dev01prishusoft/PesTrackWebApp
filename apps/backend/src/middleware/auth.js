const { verifyToken } = require('../config/auth');
const { query } = require('../config/database');

/**
 * Verifies the Bearer JWT, loads the user + assigned site ids, and attaches
 * req.user = { id, username, role, siteIds: [] }. Rejects invalid/expired tokens.
 */
async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const decoded = verifyToken(token);
    const { rows } = await query(
      `SELECT u.id, u.username, u.email, u.full_name, u.role, u.is_active,
              COALESCE(array_agg(us.site_id) FILTER (WHERE us.site_id IS NOT NULL), '{}') AS site_ids
       FROM users u
       LEFT JOIN user_sites us ON us.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [decoded.id]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      siteIds: user.site_ids,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authenticate };
