/**
 * Paramètres › Accès du support (specs/hosting-h2-account-security.md rules 12–17). Admin-only
 * through enforceRoleAccess; the support session itself may only read and report the pages it opens
 * (middleware/supportAudit.js, and the controller refuses its decisions on its own).
 *
 * `buildRouter(getController)` for tests; the default router reads the production controller at the
 * first request, so requiring this file opens no database.
 */

const express = require('express');
const { sendError } = require('../utils/httpError');
const { isSupportSession } = require('../middleware/supportAudit');

const run = (fn) => (req, res, next) => {
  try {
    return res.json(fn(req));
  } catch (err) {
    return sendError(res, err, next);
  }
};

// The acting user, flagged as the support when the session is one — by its marker, not its email.
const actor = (req) => ({ ...req.user, isSupport: Boolean(req.user && req.user.isSupport) || isSupportSession(req) });

function buildRouter(getController) {
  const c = () => getController();
  const router = express.Router();
  router.get('/banner', run((req) => c().banner(actor(req))));
  router.get('/', run(() => c().view()));
  router.get('/:id/log', run((req) => c().logs(req.params.id)));
  router.post('/:id/decide', run((req) => c().decide(actor(req), req.params.id, req.body || {})));
  router.post('/:id/revoke', run((req) => c().revoke(actor(req), req.params.id)));
  // Rule 15 — the pages the support session opens, reported by the client.
  router.post('/page', (req, res) => {
    if (isSupportSession(req) && req.session.supportAccessId) {
      c().record(req.session.supportAccessId, { method: 'PAGE', path: String((req.body || {}).path || '/').slice(0, 300), summary: '' });
    }
    return res.status(204).end();
  });
  return router;
}

module.exports = buildRouter(() => require('../utils/accountSecurityServices').supportAccess);
module.exports.buildRouter = buildRouter;
