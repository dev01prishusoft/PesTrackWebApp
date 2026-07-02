const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/findingController');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireSiteAccess } = require('../middleware/roleCheck');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

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

// --- findings (locations + visits) ---
router.get('/findings', siteAccess, ctrl.listFindings);
router.delete('/findings', requireAdmin, siteAccess, ctrl.clearFindings);
router.post('/findings', canWrite, siteAccess, ctrl.createFinding);
router.post('/findings/:locationId/visits', canWrite, siteAccess, ctrl.addVisit);
router.put('/findings/:locationId/visits/:visitId', canWrite, siteAccess, ctrl.editVisit);
router.delete('/findings/:locationId/visits/:visitId', canWrite, siteAccess, ctrl.deleteVisit);
router.delete('/findings/:locationId', canWrite, siteAccess, ctrl.deleteFinding);

// --- construction zones ---
router.get('/zones', siteAccess, ctrl.listZones);
router.post('/zones', canWrite, siteAccess, ctrl.createZone);
router.delete('/zones/:id', canWrite, siteAccess, ctrl.deleteZone);

module.exports = router;
