/**
 * Users routes — admin-only account management (specs/admin-account-management.md).
 *
 * `enforceRoleAccess` (mounted globally on `/api`) admits accountant only for `/users/me` (the self
 * route in its allowlist) and admin everywhere. So all the admin routes below get a free admin
 * guarantee from the middleware — no in-controller role check needed (only self-action + last-admin
 * guards, which the controller owns).
 */

const express = require('express');
const router = express.Router();
const controller = require('../controllers/usersController');

router.get('/', controller.list);
router.get('/me', controller.getMe);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.post('/:id/reset-password', controller.resetPassword);

router.delete('/:id', (req, res) => {
  // `?hard=1` routes to the hard-delete handler (eligibility-checked); the default is soft.
  if (String(req.query.hard) === '1') return controller.hardDelete(req, res);
  return controller.softDelete(req, res);
});

module.exports = router;
