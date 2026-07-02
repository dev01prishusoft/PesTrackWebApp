const bcrypt = require('bcrypt');
const { query } = require('../config/database');
const { signToken } = require('../config/auth');
const { validate, required, isString } = require('../utils/validate');

async function login(req, res, next) {
  try {
    const { username, password } = validate(req.body, {
      username: [required, isString],
      password: [required, isString],
    });
    // Allow login by username OR email (case-insensitive).
    const { rows } = await query(
      `SELECT id, username, email, password_hash, full_name, role, is_active
       FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)`,
      [username]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    // Assigned site ids so the client can scope the site list to this user.
    const siteRes = await query('SELECT site_id FROM user_sites WHERE user_id = $1', [user.id]);
    const siteIds = siteRes.rows.map((r) => r.site_id);

    const token = signToken({ id: user.id, role: user.role });
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        siteIds,
      },
    });
  } catch (err) {
    next(err);
  }
}

// Stateless JWT — logout is client-side (drop the token). Endpoint exists for symmetry.
async function logout(req, res) {
  res.json({ message: 'Logged out' });
}

async function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { login, logout, me };
