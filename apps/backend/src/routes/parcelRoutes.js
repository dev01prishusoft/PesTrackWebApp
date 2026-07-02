const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/parcelController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.get('/', authenticate, ctrl.getParcels);
router.post('/upload', authenticate, requireRole('admin', 'engineer'), upload.single('file'), ctrl.uploadParcels);

module.exports = router;
