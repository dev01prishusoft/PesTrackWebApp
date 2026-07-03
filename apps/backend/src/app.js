const path = require('path');
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
app.set('trust proxy', true);

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

// Static frontend: admin panel + dashboard served from the same service.
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback: any non-API GET serves the React app so client-side routes
// (e.g. deep links / page reloads) resolve to index.html.
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use('/api', notFound);
app.use(errorHandler);

module.exports = app;
