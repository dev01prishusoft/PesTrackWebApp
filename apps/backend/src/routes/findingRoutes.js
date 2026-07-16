const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/findingController');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireSiteAccess } = require('../middleware/roleCheck');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// Only match real location UUIDs — avoids /findings/photo being treated as :locationId.
const LOC_ID =
  ':locationId([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

// siteId arrives in the query string (GET/DELETE) or the body (POST/PUT).
const siteFromReq = (req) => req.query.siteId || req.body.siteId;
const siteAccess = requireSiteAccess(siteFromReq);
const canWrite = requireRole('admin', 'engineer'); // client_viewer is read-only
const requireAdmin = requireRole('admin');

// Require a siteId on every request so scoping is unambiguous.
function requireSiteId(req, res, next) {
  if (!siteFromReq(req)) return res.status(400).json({ error: 'siteId is required' });
  next();
}

router.use('/findings', authenticate, requireSiteId);
router.use('/zones', authenticate, requireSiteId);

// --- photo upload (multipart) ---
router.post('/findings/photos', canWrite, siteAccess, upload.array('files'), ctrl.uploadPhotos);
router.get('/findings/photo', siteAccess, ctrl.getPhoto);

// --- findings (locations + visits) ---
router.get('/findings', siteAccess, ctrl.listFindings);
router.get(`/findings/${LOC_ID}`, siteAccess, ctrl.getFinding);
router.delete('/findings', requireAdmin, siteAccess, ctrl.clearFindings);
router.post('/findings', canWrite, siteAccess, ctrl.createFinding);
router.post(`/findings/${LOC_ID}/visits`, canWrite, siteAccess, ctrl.addVisit);
router.put(`/findings/${LOC_ID}/visits/:visitId`, canWrite, siteAccess, ctrl.editVisit);
router.delete(`/findings/${LOC_ID}/visits/:visitId`, canWrite, siteAccess, ctrl.deleteVisit);
router.delete(`/findings/${LOC_ID}`, canWrite, siteAccess, ctrl.deleteFinding);

// --- construction zones ---
// Only admins may add or remove construction zones. Engineers (and client_viewers)
// are read-only here so they cannot alter zones the admin placed.
router.get('/zones', siteAccess, ctrl.listZones);
router.post('/zones', requireAdmin, siteAccess, ctrl.createZone);
router.delete('/zones/:id', requireAdmin, siteAccess, ctrl.deleteZone);

module.exports = router;
