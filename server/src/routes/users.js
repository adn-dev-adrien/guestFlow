/**
 * Users routes (admin-only). The role guard (middleware/enforceRoleAccess, mounted globally on
 * `/api`) already blocks accountants from any non-accounting/non-self endpoint, so an authenticated
 * non-admin reaching here is already a 403 before this router runs.
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/usersController');

router.get('/', controller.list);
router.post('/', controller.create);
router.post('/:id/reset-password', controller.resetPassword);

module.exports = router;
