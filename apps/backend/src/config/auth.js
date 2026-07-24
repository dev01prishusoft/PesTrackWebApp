const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret';
// Absolute token lifetime (from login). Idle logout (60m) is enforced client-side;
// keep JWT longer than idle so active users are not kicked mid-session.
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signToken, verifyToken, JWT_SECRET, JWT_EXPIRY };
