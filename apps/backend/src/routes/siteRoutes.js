const express = require('express');
const ctrl = require('../controllers/siteController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

const router = express.Router();

// Any authenticated user can list their sites (drives the site selector).
router.get('/', authenticate, ctrl.listSites);

// Mutations + user assignment are admin-only.
router.post('/', authenticate, requireRole('admin'), ctrl.createSite);
router.put('/:id', authenticate, requireRole('admin'), ctrl.updateSite);
router.delete('/:id', authenticate, requireRole('admin'), ctrl.deleteSite);
router.post('/:id/users', authenticate, requireRole('admin'), ctrl.assignUser);
router.delete('/:id/users/:userId', authenticate, requireRole('admin'), ctrl.removeUser);

module.exports = router;
