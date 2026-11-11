/**
 * Guest email sequence — operator endpoints (specs/guest-email-sequence.md §3.6, §4.3).
 *
 *   GET /api/email-sequence/simulation?from=YYYY-MM-DD&to=YYYY-MM-DD
 *     → { rows, startDate, assumedStartDate, autoMailKeys }
 *     Same eligibility code as the daily pass; no SMTP, no ledger write.
 */

const { simulate } = require('../utils/guestEmailSequenceRunner');
const { dateWindowMessage, isRealIsoDay } = require('../utils/stayDates');

const MAX_RANGE_DAYS = 400;

function buildController({ database, ledger, settingsModel, templatesModel }) {
  function simulation(req, res) {
    const from = String((req.query && req.query.from) || '');
    const to = String((req.query && req.query.to) || '');
    if (!isRealIsoDay(from) || !isRealIsoDay(to)) {
      return res.status(400).json({ error: 'INVALID_RANGE' });
    }
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days < 0 || days > MAX_RANGE_DAYS) return res.status(400).json({ error: 'INVALID_RANGE', maxDays: MAX_RANGE_DAYS });
    // specs/reservations-backend-mvc.md rule 13 (reading of 2026-11-02) — both ends inside the date window.
    const outside = dateWindowMessage(from) || dateWindowMessage(to);
    if (outside) return res.status(400).json({ error: 'INVALID_RANGE', message: outside });
    return res.json(simulate({ database, ledger, settingsModel, templatesModel }, { from, to }));
  }

  return { simulation };
}

module.exports = { buildController, MAX_RANGE_DAYS };
