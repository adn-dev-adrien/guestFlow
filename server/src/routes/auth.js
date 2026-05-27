const router = require('express').Router();
const { login, logout, me, changePassword } = require('../controllers/authController');

// Public: login + me (probe). Session-bound: logout + change-password (checked inside the controller).
// This router is mounted OUTSIDE requireAuth so a restricted session can still change its password.
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', me);
router.post('/change-password', changePassword);

module.exports = router;
