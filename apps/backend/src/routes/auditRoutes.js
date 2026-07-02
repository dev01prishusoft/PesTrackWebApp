const express = require('express');
const { listAudit } = require('../controllers/auditController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

const router = express.Router();

router.get('/', authenticate, requireRole('admin'), listAudit);

module.exports = router;
