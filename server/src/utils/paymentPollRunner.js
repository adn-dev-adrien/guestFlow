/**
 * Payment poll + webhook core (specs/online-payments-qonto.md §3.3 / §3.4,
 * specs/public-online-payment.md §3/§3bis).
 *
 * `processPaidLink` is the single idempotent effect of a PAID Qonto link — shared by the cron/on-demand
 * **poll** (`runPaymentPoll`) and the **webhook** (`qontoWebhookController`). Every dependency is
 * injected so it's unit-testable without network or the prod DB:
 *   - paymentLinksModel : listOpen() / markPaid() / updateStatus()
 *   - qontoClient       : getPaymentLink / getPaymentLinkPayments
 *   - getAccessToken()  : resolves a valid OAuth access token
 *   - devisModel        : convertToReservation(id)
 *   - database          : better-sqlite3 handle (flip depositPaid / balancePaid / bookingConflictAt)
 *   - sendConfirmation? : (reservationId) => send the confirmation email (best-effort)
 *   - checkConflict?    : ({ reservationId }) => boolean — dates no longer free at conversion
 *   - notifyConflict?   : (reservationId) => notify the admin of an over-booked paid booking (best-effort)
 *
 * Idempotent: a link already `paid` is never re-listed by the poll; converting an already-converted devis
 * only flips the flags; a webhook replay re-runs the same no-op writes.
 */

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Apply the business consequence of a PAID link. A deposit OR a full payment on a devis converts it to a
// reservation; a full payment marks it fully settled (deposit + balance). On conversion the dates are
// re-checked (the devis never blocked them) — a conflict flags the reservation + surfaces `conflict:true`.
function applyPaidEffect({ database, devisModel, link, checkConflict }) {
  const date = todayIso();
  const row = database.prepare('SELECT id, kind, convertedReservationId FROM reservations WHERE id = ?').get(link.reservationId);
  if (!row) return { effect: 'no-reservation' };

  const isDeposit = link.type === 'deposit';
  const isFull = link.type === 'full';

  // Deposit or full payment on a DEVIS → confirm the stay (convert) and mark paid.
  if ((isDeposit || isFull) && row.kind === 'devis') {
    let reservationId = row.convertedReservationId;
    let effect = 'already-converted';
    if (!reservationId) {
      const conv = devisModel.convertToReservation(link.reservationId);
      if (conv && conv.error) return { effect: 'convert-failed', error: conv.error };
      reservationId = conv.data.reservationId;
      effect = 'converted';
    }
    if (isFull) {
      database.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ?, balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(date, date, reservationId);
    } else {
      database.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ? WHERE id = ?').run(date, reservationId);
    }
    return { effect, reservationId, conflict: flagConflictIfAny({ database, checkConflict, reservationId }) };
  }

  if (isDeposit) {
    database.prepare('UPDATE reservations SET depositPaid = 1, depositPaidDate = ? WHERE id = ?').run(date, link.reservationId);
    return { effect: 'deposit-marked' };
  }

  // balance / full on an existing reservation → the stay is fully paid pre-arrival.
  if (link.type === 'balance' || isFull) {
    database.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(date, link.reservationId);
    return { effect: 'balance-marked' };
  }
  return { effect: 'noop' };
}

// Re-check availability for a just-confirmed reservation; stamp bookingConflictAt on a conflict. Returns
// whether a conflict was found. Best-effort: a checker error never breaks the (already paid) confirmation.
function flagConflictIfAny({ database, checkConflict, reservationId }) {
  if (typeof checkConflict !== 'function') return false;
  let conflict = false;
  try { conflict = Boolean(checkConflict({ reservationId })); } catch { conflict = false; }
  if (conflict) {
    database.prepare('UPDATE reservations SET bookingConflictAt = ? WHERE id = ? AND bookingConflictAt IS NULL').run(new Date().toISOString(), reservationId);
  }
  return conflict;
}

// A paid link confirms the stay (→ confirmation email) for the deposit (use case 1) and full-payment
// (use case 2) flows; a balance payment is a later top-up, not the initial confirmation.
const CONFIRMING_TYPES = new Set(['deposit', 'full']);
const CONFIRMING_EFFECTS = new Set(['converted', 'already-converted', 'deposit-marked', 'balance-marked']);

// The shared effect of one PAID link: mark paid → apply the business effect → confirmation email +
// conflict notification (both best-effort). Idempotent. Returns the per-link result object.
async function processPaidLink({ database, devisModel, paymentLinksModel, link, paidPayment, sendConfirmation, checkConflict, notifyConflict }) {
  const p = paidPayment || {};
  paymentLinksModel.markPaid(link.id, { qontoPaymentId: p.id || null, paidAt: p.paid_at || new Date().toISOString() });
  const effect = applyPaidEffect({ database, devisModel, link, checkConflict });

  if (CONFIRMING_TYPES.has(link.type) && CONFIRMING_EFFECTS.has(effect.effect)) {
    const confirmedId = effect.reservationId || link.reservationId;
    if (sendConfirmation) { try { await sendConfirmation(confirmedId); } catch (e) { /* logged inside the sender */ } }
    if (effect.conflict && notifyConflict) { try { await notifyConflict(confirmedId); } catch (e) { /* best effort */ } }
  }
  return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect };
}

async function runPaymentPoll({ database, paymentLinksModel, qontoClient, getAccessToken, devisModel, sendConfirmation, checkConflict, notifyConflict }) {
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
        const res = await processPaidLink({ database, devisModel, paymentLinksModel, link, paidPayment: pay.paidPayment, sendConfirmation, checkConflict, notifyConflict });
        results.push(res);
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

module.exports = { runPaymentPoll, processPaidLink, applyPaidEffect };
