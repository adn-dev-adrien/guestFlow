/**
 * Guest email sequence — operator endpoints (specs/guest-email-sequence.md §3.6, §4.3).
 *
 *   GET /api/email-sequence/simulation?from=YYYY-MM-DD&to=YYYY-MM-DD
 *     → { rows, startDate, assumedStartDate, autoSendEnabled }
 *     Same eligibility code as the daily pass; no SMTP, no ledger write.
 */

const { simulate } = require('../utils/guestEmailSequenceRunner');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 400;

function buildController({ database, ledger, settingsModel }) {
  function simulation(req, res) {
    const from = String((req.query && req.query.from) || '');
    const to = String((req.query && req.query.to) || '');
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      return res.status(400).json({ error: 'INVALID_RANGE' });
    }
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days < 0 || days > MAX_RANGE_DAYS) return res.status(400).json({ error: 'INVALID_RANGE', maxDays: MAX_RANGE_DAYS });
    return res.json(simulate({ database, ledger, settingsModel }, { from, to }));
  }

  return { simulation };
}

module.exports = { buildController, MAX_RANGE_DAYS };
