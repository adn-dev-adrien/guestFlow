/**
 * Balance-request daily pass (specs/public-online-deposit.md §3 rule 8, widened by
 * specs/payment-schedule-and-cancellation.md §3.7 rule 38). For every DIRECT reservation whose SOLDE
 * is due (balancePaid=0, balanceAmount>0, balanceDueDate ≤ today), create/reuse the `balance` Qonto
 * link and email the `balance_request` template. One send ever per reservation (email_log dedup);
 * a failed send retries the next day. Pure orchestration — every dependency injected for unit tests.
 *
 * The pass used to require the acompte to have been paid ONLINE (a paid `deposit` payment link on the
 * devis it converted from), which limited it to the public-website funnel: a booking taken by phone
 * never got its solde request. The schedule is now a policy, not a funnel feature — every direct
 * reservation owes its solde 30 days before arrival, whatever channel took the booking.
 *
 *   deps: { database, templatesModel, logModel, sendBalanceRequest(reservationId) → { httpStatus },
 *           today?: 'YYYY-MM-DD' }
 * Returns { checked, sent, skipped, failed, results }.
 */

const { DIRECT_CHANNELS } = require('./platformNameFormat');

// Bound as parameters (never interpolated values) so the direct-channel list stays a single source
// of truth in platformNameFormat.js — adding one own channel there reaches this pass for free.
const DIRECT_CHANNEL_LIST = [...DIRECT_CHANNELS];
const DIRECT_CHANNEL_PLACEHOLDERS = DIRECT_CHANNEL_LIST.map(() => '?').join(', ');

function isoToday(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Reservations eligible for an automatic balance request today.
function selectEligible(database, today) {
  return database.prepare(`
    SELECT r.id
      FROM reservations r
     WHERE COALESCE(r.kind, 'reservation') = 'reservation'
       AND r.balancePaid = 0
       AND r.balanceAmount > 0
       AND r.balanceDueDate IS NOT NULL
       AND r.balanceDueDate <= ?
       -- Direct channels only: a platform booking is settled by the platform after the stay, so
       -- there is no solde to ask the guest for (specs/payment-schedule-and-cancellation.md rule 1).
       AND LOWER(COALESCE(NULLIF(TRIM(r.platform), ''), 'direct')) IN (${DIRECT_CHANNEL_PLACEHOLDERS})
     ORDER BY r.id
  `).all(today, ...DIRECT_CHANNEL_LIST);
}

async function runBalanceRequestPass(deps) {
  const { database, templatesModel, logModel, sendBalanceRequest } = deps;
  const today = deps.today || isoToday();

  const template = templatesModel.findByStableKey('balance_request');
  if (!template || !template.enabled) return { checked: 0, sent: 0, skipped: 0, failed: 0, results: [], reason: 'template-disabled' };

  const rows = selectEligible(database, today);
  const results = [];
  let sent = 0; let skipped = 0; let failed = 0;

  for (const { id } of rows) {
    // One request ever per reservation — a prior `sent` row means we already asked (manual send counts).
    if (logModel.existsFor(template.id, id, ['sent'])) { skipped++; results.push({ reservationId: id, status: 'skipped' }); continue; }
    try {
      const out = await sendBalanceRequest(id);
      if (out && out.httpStatus === 200) { sent++; results.push({ reservationId: id, status: 'sent' }); }
      else { failed++; results.push({ reservationId: id, status: 'failed', httpStatus: out && out.httpStatus }); }
    } catch (e) {
      failed++; results.push({ reservationId: id, status: 'error', error: String(e && e.message || e) });
    }
  }

  return { checked: rows.length, sent, skipped, failed, results };
}

module.exports = { runBalanceRequestPass, selectEligible, isoToday };
