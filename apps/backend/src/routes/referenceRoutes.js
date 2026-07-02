const express = require('express');
const ctrl = require('../controllers/referenceController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, ctrl.getReferences);

module.exports = router;
