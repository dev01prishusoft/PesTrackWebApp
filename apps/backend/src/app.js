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
// Stable aliases required by the brief:
//   /svr  ->  SVR (Site Visit Report, field engineers, phone)
//   /css  ->  CS Scheduler (customer service agent, desktop)
//
// The CS Scheduler builds WhatsApp deep links as `<PesTrack URL>` + `/#plan=…`
// (see planLink/bundleLink in PesTrackCSSchedulerv0.16.html), so the SVR alias
// must answer both `/svr` and `/svr/`. Set the "PesTrack URL" field on the CS
// Daily List tab to `https://<site>/svr` — that is the whole of brief Task 2.
// ---------------------------------------------------------------------------
const STANDALONE_ALIASES = {
  svr: 'PesTrackv4.5.1.html',
  css: 'PesTrackCSSchedulerv0.16.html',
};

// Scan public/ once at boot instead of on every request (readdirSync per request
// is a synchronous disk hit on the hot path). Keyed by lowercased basename so
// URLs are case-insensitive — Render runs a case-sensitive filesystem, and the
// links are retyped by hand off a phone.
const standalonePages = new Map();
try {
  for (const file of fs.readdirSync(publicDir)) {
    if (!file.endsWith('.html') || file === 'index.html') continue;
    standalonePages.set(file.toLowerCase().replace(/\.html$/, ''), file);
  }
} catch (err) {
  console.warn('[static-html] Could not scan public/ for HTML files:', err.message);
}
for (const [alias, file] of Object.entries(STANDALONE_ALIASES)) {
  if (fs.existsSync(path.join(publicDir, file))) standalonePages.set(alias, file);
  else console.warn(`[static-html] alias /${alias} -> ${file} missing from public/`);
}
console.log(`[static-html] serving: ${[...standalonePages.keys()].map(k => '/' + k).join(', ')}`);

// Mounted BEFORE express.static and before the SPA catch-all.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api')) return next();

  // Accept /svr, /svr/, /PesTrackv4.5.1.html, /pestrackv4.5.1 — all the same page.
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
