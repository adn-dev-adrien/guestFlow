const express = require('express');
const fs = require('fs');
const { parisDay } = require('../utils/days');

// Rule 20: the export link emailed to a deprovisioned customer, valid 30 days. Public by design:
// the unguessable token is the credential, as in the email.
function exportRoutes(ctx) {
  const router = express.Router();
  router.get('/:token', (req, res) => {
    const exp = ctx.models.provisioning.getExport(req.params.token);
    if (!exp) return res.status(404).type('text/plain; charset=utf-8').send('Lien inconnu.');
    if (exp.expiresAt < parisDay(ctx.now()) || !fs.existsSync(exp.path)) {
      return res.status(410).type('text/plain; charset=utf-8').send('Ce lien a expiré.');
    }
    return res.download(exp.path);
  });
  return router;
}

module.exports = { exportRoutes };
