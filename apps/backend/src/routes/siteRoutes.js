const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/siteController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

const router = express.Router();
// Creating a site may carry its initial parcel sheet. multer only handles
// multipart bodies and passes JSON requests straight through, so the endpoint
// still accepts a plain JSON site with no file.
const upload = multer({ storage: multer.memoryStorage() });

// Any authenticated user can list their sites (drives the site selector).
router.get('/', authenticate, ctrl.listSites);
// Mutations + user assignment are admin-only.
router.get('/:id', authenticate, ctrl.getSite);
router.post('/', authenticate, requireRole('admin'), upload.single('file'), ctrl.createSite);
router.put('/:id', authenticate, requireRole('admin'), upload.single('file'), ctrl.updateSite);
router.delete('/:id', authenticate, requireRole('admin'), ctrl.deleteSite);
router.post('/:id/users', authenticate, requireRole('admin'), ctrl.assignUser);
router.delete('/:id/users/:userId', authenticate, requireRole('admin'), ctrl.removeUser);

module.exports = router;
