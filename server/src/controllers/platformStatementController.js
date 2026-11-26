// specs/platforms/platform-statement-after-payout.md §4.3 — thin: body → model → status.

const model = require('../models/platformStatementModel');

function respond(res, result) {
  if (!result.ok) {
    const { status, error, code, moved } = result;
    return res.status(status || 400).json({ error, ...(code ? { code } : {}), ...(moved ? { moved } : {}) });
  }
  return res.json({ netGap: result.netGap, netLabel: result.netLabel, changed: result.changed });
}

const update = (req, res) => respond(res, model.correct(req.params.id, req.body || {}));

// The panel's preview (rules 3-4, 7): the same checks and the net sentence, nothing written.
const preview = (req, res) => respond(res, model.correct(req.params.id, req.body || {}, { dryRun: true }));

module.exports = { update, preview };
