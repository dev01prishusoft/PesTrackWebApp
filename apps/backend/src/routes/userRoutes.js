const express = require('express');
const ctrl = require('../controllers/userController');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

const router = express.Router();

// All user-management endpoints are admin-only.
router.use(authenticate, requireRole('admin'));

router.get('/', ctrl.listUsers);
router.post('/', ctrl.createUser);
router.get('/:id', ctrl.getUser);
router.put('/:id', ctrl.updateUser);
router.delete('/:id', ctrl.deactivateUser);
router.post('/:id/reset-password', ctrl.resetPassword);

module.exports = router;
