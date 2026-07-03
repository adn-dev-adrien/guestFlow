/**
 * Balance-request daily pass (specs/public-online-deposit.md §3 rule 8). For every reservation whose
 * DEPOSIT was collected online (a paid `deposit` link on the devis it converted from) but whose SOLDE
 * is still due (balancePaid=0, balanceAmount>0, balanceDueDate ≤ today), create/reuse the `balance`
 * Qonto link and email the `balance_request` template. One send ever per reservation (email_log dedup);
 * a failed send retries the next day. Pure orchestration — every dependency injected for unit tests.
 *
 *   deps: { database, templatesModel, logModel, sendBalanceRequest(reservationId) → { httpStatus },
 *           today?: 'YYYY-MM-DD' }
 * Returns { checked, sent, skipped, failed, results }.
 */

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
       AND r.balanceDueDate <= @today
       AND EXISTS (
             SELECT 1 FROM payment_links pl
              JOIN reservations d ON d.id = pl.reservationId
             WHERE d.convertedReservationId = r.id
               AND pl.type = 'deposit'
               AND pl.status = 'paid'
           )
     ORDER BY r.id
  `).all({ today });
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
