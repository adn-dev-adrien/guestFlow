/**
 * Payment poll runner (specs/online-payments-qonto.md §3.3 / §3.4).
 *
 * Detects paid Qonto payment links and applies the business effect. Pure orchestration — every
 * dependency is injected so it's unit-testable without network or the prod DB:
 *   - paymentLinksModel : listOpen() / markPaid() / updateStatus()
 *   - qontoClient       : getPaymentLink({ accessToken, id })
 *   - getAccessToken()  : resolves a valid OAuth access token (lazy; called once if there's work)
 *   - devisModel        : convertToReservation(id)  (deposit-paid on a devis confirms the stay)
 *   - database          : better-sqlite3 handle (to flip depositPaid / balancePaid)
 *
 * Idempotent: a link already `paid` is never re-listed (listOpen returns open only); converting a
 * devis that's already converted is detected and only flips the deposit flag.
 *
 * Returns `{ checked, paid, results: [{ id, reservationId, type, status, effect?, reservationId? }] }`.
 */

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Apply the business consequence of a PAID link. Deposit on a devis → convert to a reservation and
// flag its deposit paid; deposit on a reservation → flag deposit paid; balance/full → flag balance paid.
function applyPaidEffect({ database, devisModel, link }) {
  const date = todayIso();
  const row = database.prepare('SELECT id, kind, convertedReservationId FROM reservations WHERE id = ?').get(link.reservationId);
  if (!row) return { effect: 'no-reservation' };

  if (link.type === 'deposit') {
    if (row.kind === 'devis') {
      // Already converted (e.g. a manual conversion happened first) → just flag the real reservation.
      if (row.convertedReservationId) {
        database.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ? WHERE id = ?').run(date, row.convertedReservationId);
        return { effect: 'already-converted', reservationId: row.convertedReservationId };
      }
      const conv = devisModel.convertToReservation(link.reservationId);
      if (conv && conv.error) return { effect: 'convert-failed', error: conv.error };
      const reservationId = conv.data.reservationId;
      database.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ? WHERE id = ?').run(date, reservationId);
      return { effect: 'converted', reservationId };
    }
    database.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ? WHERE id = ?').run(date, link.reservationId);
    return { effect: 'deposit-marked' };
  }

  // balance / full → the stay is fully paid pre-arrival.
  if (link.type === 'balance' || link.type === 'full') {
    database.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(date, link.reservationId);
    return { effect: 'balance-marked' };
  }
  return { effect: 'noop' };
}

// A paid link confirms the stay (→ send the confirmation email) for the deposit (use case 1) and the
// full-payment (use case 2) flows; a balance payment is a later top-up, not the initial confirmation.
const CONFIRMING_TYPES = new Set(['deposit', 'full']);
const CONFIRMING_EFFECTS = new Set(['converted', 'already-converted', 'deposit-marked', 'balance-marked']);

async function runPaymentPoll({ database, paymentLinksModel, qontoClient, getAccessToken, devisModel, sendConfirmation }) {
  const open = paymentLinksModel.listOpen();
  const results = [];
  let accessToken = null;

  for (const link of open) {
    if (!link.qontoPaymentLinkId) { results.push({ id: link.id, status: 'skipped-no-remote-id' }); continue; }
    try {
      if (!accessToken) accessToken = await getAccessToken();
      // Authoritative "paid" signal = a paid payment on the link's payments sub-resource. The link's
      // own top-level status only goes open → processing on payment (it never reports `paid` in sandbox).
      const pay = await qontoClient.getPaymentLinkPayments({ accessToken, id: link.qontoPaymentLinkId });
      if (pay.paid) {
        const p = pay.paidPayment || {};
        paymentLinksModel.markPaid(link.id, { qontoPaymentId: p.id || null, paidAt: p.paid_at || new Date().toISOString() });
        const effect = applyPaidEffect({ database, devisModel, link });
        // Best-effort confirmation email — never let an email failure break the payment poll.
        if (sendConfirmation && CONFIRMING_TYPES.has(link.type) && CONFIRMING_EFFECTS.has(effect.effect)) {
          const confirmedId = effect.reservationId || link.reservationId;
          try { await sendConfirmation(confirmedId); } catch (e) { /* logged inside the sender */ }
        }
        results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect });
        continue;
      }
      // Not paid → only a terminal expired/cancelled link status changes our record; else stays open.
      const remote = await qontoClient.getPaymentLink({ accessToken, id: link.qontoPaymentLinkId });
      if (remote.mappedStatus === 'expired' || remote.mappedStatus === 'cancelled') {
        paymentLinksModel.updateStatus(link.id, remote.mappedStatus);
        results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: remote.mappedStatus });
      } else {
        results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'open' });
      }
    } catch (err) {
      results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'error', error: String(err && err.message || err) });
    }
  }

  return { checked: open.length, paid: results.filter((r) => r.status === 'paid').length, results };
}

module.exports = { runPaymentPoll, applyPaidEffect };
