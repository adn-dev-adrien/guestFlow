/**
 * Paramètres › Accès du support (specs/hosting-h2-account-security.md rules 12–17). Admin-only
 * through enforceRoleAccess; the support session itself may only read and report the pages it opens
 * (middleware/supportAudit.js).
 */

const router = require('express').Router();
const { supportAccess } = require('../utils/accountSecurityServices');
const { sendError } = require('../utils/httpError');

const run = (fn) => (req, res, next) => {
  try {
    return res.json(fn(req));
  } catch (err) {
    return sendError(res, err, next);
  }
};

router.get('/banner', run((req) => supportAccess.banner(req.user)));
router.get('/', run(() => supportAccess.view()));
router.get('/:id/log', run((req) => supportAccess.logs(req.params.id)));
router.post('/:id/decide', run((req) => supportAccess.decide(req.user, req.params.id, req.body || {})));
router.post('/:id/revoke', run((req) => supportAccess.revoke(req.user, req.params.id)));
// Rule 15 — the pages the support session opens, reported by the client.
router.post('/page', (req, res) => {
  if (req.user && req.user.isSupport && req.session.supportAccessId) {
    supportAccess.record(req.session.supportAccessId, { method: 'PAGE', path: String((req.body || {}).path || '/').slice(0, 300), summary: '' });
  }
  return res.status(204).end();
});

module.exports = router;
