/**
 * Neat integration routes (specs/neat-cancellation-insurance-subscription.md §4.3). Thin: every
 * handler delegates to the plugin controller. Auth is the global `/api` requireAuth + the deny-by-default
 * role guard (admin-only, no allowlist entry). Handlers are arrow-wrapped so the controller's
 * `this`-based composition keeps working, and async rejections land in a 500 instead of hanging.
 */

const express = require('express');

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error('[neat] route error:', err);
  if (!res.headersSent) res.status(500).json({ error: 'Erreur interne Neat.' });
});

// `controller()` returns the plugin's controller, built on first use.
function buildRouter(controller) {
  const router = express.Router();
  router.get('/settings', wrap((req, res) => controller().getSettings(req, res)));
  router.put('/settings', wrap((req, res) => controller().updateSettings(req, res)));
  router.post('/test-connection', wrap((req, res) => controller().testConnection(req, res)));
  router.get('/discovery', wrap((req, res) => controller().getDiscovery(req, res)));
  router.put('/selection', wrap((req, res) => controller().updateSelection(req, res)));
  router.put('/mapping', wrap((req, res) => controller().updateMapping(req, res)));
  router.post('/reservations/:id/retry', wrap((req, res) => controller().retry(req, res)));
  router.post('/reservations/:id/void', wrap((req, res) => controller().void(req, res)));

  return router;
}

module.exports = { buildRouter };
