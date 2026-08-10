const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const siteRoutes = require('./routes/siteRoutes');
const parcelRoutes = require('./routes/parcelRoutes');
const findingRoutes = require('./routes/findingRoutes');
const auditRoutes = require('./routes/auditRoutes');
const referenceRoutes = require('./routes/referenceRoutes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const app = express();
// Trust only the first reverse-proxy hop in production (e.g. Render). Using `true`
// trusts every proxy and lets clients spoof X-Forwarded-For, which breaks rate limiting.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
} else if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security + parsing. CSP disabled so the existing CDN-based HTML dashboard works.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || true, credentials: true }));
app.use(express.json({ limit: '15mb' })); // large limit for JSON import at go-live

// Throttle auth endpoints against brute force.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50 });
app.use('/api/auth/login', authLimiter);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sites', siteRoutes);
app.use('/api/parcels', parcelRoutes);
app.use('/api/references', referenceRoutes);
app.use('/api', findingRoutes); // /api/findings/*, /api/zones/*
app.use('/api/audit', auditRoutes);

const publicDir = path.join(__dirname, '..', 'public');

// ---------------------------------------------------------------------------
// Standalone HTML apps (POC deploy brief — SOTAICO PesTrack CSS & SVR).
//
// These are self-contained single-file apps with their own in-page login
// (Pro001 / CS001). They must NEVER fall through to the React SPA catch-all
// below, which renders the admin app and bounces the visitor to /admin/login.
//
// Routes come from the filesystem, so there is no list to maintain: every
// public/<name>.html is served at /<name>.html. Drop a file in, redeploy, done.
//
// The URLs are the file names, unchanged:
//   /PesTrackv4.5.1.html            -> SVR
//   /PesTrackCSSchedulerv0.16.html  -> CS Scheduler
//
// express.static below would already answer those two exact strings; this
// middleware exists for the variants it would miss. The CS Scheduler builds its
// WhatsApp deep links as `<PesTrack URL>` + `/#plan=…` (see planLink/bundleLink
// in the CS Scheduler source), so a configured PesTrack URL of
// `https://<site>/PesTrackv4.5.1.html` produces a request path with a TRAILING
// SLASH — `/PesTrackv4.5.1.html/` — which express.static does not serve and the
// SPA catch-all would swallow. Every plan link sent to a Pro depends on this.
// ---------------------------------------------------------------------------

// Scanned once at boot, not per request (readdirSync on the hot path is a
// synchronous disk hit). Keys are lowercased so URLs are case-insensitive:
// Render's filesystem is case-sensitive and these links get retyped off phones.
const standalonePages = new Map();
try {
  for (const entry of fs.readdirSync(publicDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html') || entry.name === 'index.html') continue;
    standalonePages.set(entry.name.toLowerCase().replace(/\.html$/, ''), entry.name);
  }
} catch (err) {
  console.warn('[static-html] could not scan public/:', err.message);
}

console.log(`[static-html] serving: ${[...standalonePages.values()].map(f => '/' + f).join(', ')}`);

// Mounted BEFORE express.static and before the SPA catch-all.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api')) return next();

  // Accept /PesTrackv4.5.1.html, /PesTrackv4.5.1.html/, /pestrackv4.5.1 alike.
  let key;
  try {
    key = decodeURIComponent(req.path); // throws on a malformed % escape
  } catch {
    return next();
  }
  key = key.replace(/^\/+|\/+$/g, '').toLowerCase().replace(/\.html$/, '');
  const file = standalonePages.get(key);
  if (!file) return next();

  // The SPA shell was previously served on these URLs; without this a cached
  // index.html keeps redirecting to /admin/login even after a good deploy.
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(publicDir, file));
});

// Static frontend: serve static assets (JS, CSS, images) but disable directory
// index auto-serving so Express never silently serves public/admin/index.html
// for /admin/* routes — React Router in the main SPA handles all routing.
app.use(express.static(publicDir, { index: false }));

// SPA fallback: ALL non-API GET requests are handled by the main React SPA so
// client-side routes (including /admin/login, /admin/users, etc.) resolve
// correctly and the redirect-when-logged-in logic runs.
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
