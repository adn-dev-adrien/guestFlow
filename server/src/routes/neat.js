/**
 * Neat integration routes (specs/neat-cancellation-insurance-subscription.md §4.3). Thin: every
 * handler delegates to neatController. Auth is the global `/api` requireAuth + the deny-by-default
 * role guard (admin-only, no allowlist entry). Handlers are arrow-wrapped so the controller's
 * `this`-based composition keeps working, and async rejections land in a 500 instead of hanging.
 */

const express = require('express');

const router = express.Router();
const ctrl = require('../controllers/neatController');

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error('[neat] route error:', err);
  if (!res.headersSent) res.status(500).json({ error: 'Erreur interne Neat.' });
});

router.get('/settings', wrap((req, res) => ctrl.getSettings(req, res)));
router.put('/settings', wrap((req, res) => ctrl.updateSettings(req, res)));
router.post('/test-connection', wrap((req, res) => ctrl.testConnection(req, res)));
router.get('/discovery', wrap((req, res) => ctrl.getDiscovery(req, res)));
router.put('/selection', wrap((req, res) => ctrl.updateSelection(req, res)));
router.put('/mapping', wrap((req, res) => ctrl.updateMapping(req, res)));
router.post('/reservations/:id/retry', wrap((req, res) => ctrl.retry(req, res)));
router.post('/reservations/:id/void', wrap((req, res) => ctrl.void(req, res)));

module.exports = router;
