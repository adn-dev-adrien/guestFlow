/**
 * Payment poll + webhook core (specs/online-payments-qonto.md §3.3 / §3.4,
 * specs/public-online-payment.md §3/§3bis), provider-neutral since
 * specs/plugins-phase-3a-online-payment.md rules 2, 4, 8.
 *
 * `processPaidLink` is the single idempotent effect of a PAID link — shared by the cron/on-demand
 * **poll** (`runPaymentPoll`) and the provider's **webhook**. Every dependency is injected so it's
 * unit-testable without network or the prod DB:
 *   - paymentLinksModel : retireExpired() / listPollable() / touchPolled() / hasKnownExpiry() / markPaid() /
 *                         updateStatus() / listRemoteCancelPending() / clearRemoteCancelPending()
 *   - provider          : the payment provider (utils/paymentProviders) — getPayment / getLinkStatus / cancelLink
 *   - devisModel        : convertToReservation(id)
 *   - database          : better-sqlite3 handle (bookingConflictAt)
 *   - recordPayment?    : ({ reservationId, bucket }) → records the paid bucket (utils/stayPaymentRecorder)
 *   - sendConfirmation? : (reservationId) => send the confirmation email (best-effort)
 *   - checkConflict?    : ({ reservationId }) => boolean — dates no longer free at conversion
 *   - notifyConflict?   : (reservationId) => notify the admin of an over-booked paid booking (best-effort)
 *   - notifyPaidAfterCancel? : (link) => tell the admin a cancelled link was paid (best-effort, rule 8)
 *
 * Idempotent: a link already `paid` is never re-listed by the poll; converting an already-converted devis
 * only records the bucket again, which the recorder ignores; a webhook replay re-runs the same no-ops.
 */

// Money already received: a failed contribs capture never loses it (utils/stayPaymentRecorder).
function recordOn(database) {
  return (payment) => {
    const { recordStayPayment, depsFor } = require('./stayPaymentRecorder');
    return recordStayPayment(depsFor(database), { ...payment, keepPaymentOnCaptureFailure: true });
  };
}

// Apply the business consequence of a PAID link. A deposit OR a full payment on a devis converts it to a
// reservation; a full payment marks it fully settled (deposit + balance). On conversion the dates are
// re-checked (the devis never blocked them) — a conflict flags the reservation + surfaces `conflict:true`.
// The bucket goes through the same recorder as a manual tick (rule 1).
function applyPaidEffect({ database, devisModel, link, checkConflict, recordPayment = recordOn(database) }) {
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
    recordPayment({ reservationId, bucket: isFull ? 'full' : 'deposit' });
    return { effect, reservationId, conflict: flagConflictIfAny({ database, checkConflict, reservationId }) };
  }

  if (isDeposit) {
    recordPayment({ reservationId: link.reservationId, bucket: 'deposit' });
    return { effect: 'deposit-marked' };
  }

  // balance / full on an existing reservation → the stay is fully paid pre-arrival.
  if (link.type === 'balance' || isFull) {
    recordPayment({ reservationId: link.reservationId, bucket: 'balance' });
    return { effect: 'balance-marked' };
  }
  return { effect: 'noop' };
}

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
// `emitPluginEvent` is injectable like every other dep; by default the webhook, the on-demand poll
// and the cron all announce a freshly converted reservation to the plugins (Google pushes it at
// once — specs/plugins-phase-1-sdk.md rule 9).
async function processPaidLink({ database, devisModel, paymentLinksModel, link, paidPayment, sendConfirmation, checkConflict, notifyConflict, recordPayment, emitPluginEvent = require('../plugins/sdk/eventBus').emit }) {
  const p = paidPayment || {};
  // markPaid is atomic (UPDATE … WHERE status='open') and reports whether THIS call flipped the link.
  // The webhook, the on-demand /status poll and the cron can all observe the same paid link at once;
  // only the caller that actually flips it runs the effect + confirmation email, so the guest never
  // gets a duplicate email and the admin never gets a duplicate conflict alert.
  const { flipped } = paymentLinksModel.markPaid(link.id, { providerPaymentId: p.paymentId || null, paidAt: p.paidAt || new Date().toISOString() });
  if (!flipped) {
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', effect: 'already-processed' };
  }
  const effect = applyPaidEffect({ database, devisModel, link, checkConflict, recordPayment });

  // Devis→reservation conversion is the only paid effect that changes the calendar event set
  // (deposit/balance flags are not event-visible fields).
  if (effect.effect === 'converted' && effect.reservationId) {
    emitPluginEvent('reservation.created', { reservationId: effect.reservationId });
  }

  if (CONFIRMING_TYPES.has(link.type) && CONFIRMING_EFFECTS.has(effect.effect)) {
    const confirmedId = effect.reservationId || link.reservationId;
    if (sendConfirmation) { try { await sendConfirmation(confirmedId); } catch (e) { /* logged inside the sender */ } }
    if (effect.conflict && notifyConflict) { try { await notifyConflict(confirmedId); } catch (e) { /* best effort */ } }
  }
  return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect };
}

// specs/plugins-phase-3a-online-payment.md rule 8 — the links GuestFlow abandoned but could not
// deactivate. A paid one is never recorded on the stay (it was cancelled or replaced): the admin is told,
// the payment's id stays on the row for the refund. Returns the per-link results, and whether a rate
// limit stopped the retries.
async function retryPendingCancellations({ paymentLinksModel, provider, notifyPaidAfterCancel }) {
  const results = [];
  for (const link of paymentLinksModel.listRemoteCancelPending()) {
    if (link.provider !== provider.id || !link.providerLinkId) continue;
    try {
      const pay = await provider.getPayment(link.providerLinkId, { origin: 'cancel-link' });
      if (pay.paid) {
        paymentLinksModel.clearRemoteCancelPending(link.id, { providerPaymentId: pay.paymentId || null, paidAt: pay.paidAt || new Date().toISOString() });
        if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link); } catch { /* best effort */ } }
        results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid-after-cancel' });
        continue;
      }
      await provider.cancelLink(link.providerLinkId);
      paymentLinksModel.clearRemoteCancelPending(link.id);
      results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'deactivated' });
    } catch (err) {
      results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'deactivation-pending', error: String((err && err.message) || err) });
      if (err && err.code === 'RATE_LIMITED') return { results, stoppedBy: 'rate-limit' };
    }
  }
  return { results, stoppedBy: null };
}

// One pass (specs/payment-polling-fair-use.md): retry the owed deactivations, retire links past a known
// expiry without calling the provider, then check only the open links the decaying cadence says are due
// (`force` = a human asked, every open link). A rate limit that survives the client's back-off stops the
// pass: the links not yet examined wait for the next tick instead of being requested into a `429`.
async function runPaymentPoll({ database, paymentLinksModel, provider, devisModel, sendConfirmation, checkConflict, notifyConflict, notifyPaidAfterCancel, recordPayment, force = false, now = new Date() }) {
  const pending = await retryPendingCancellations({ paymentLinksModel, provider, notifyPaidAfterCancel });
  const retired = paymentLinksModel.retireExpired({ now });
  const results = [...pending.results, ...retired.map((link) => ({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'expired', effect: 'retired-locally' }))];
  if (pending.stoppedBy) return { checked: 0, paid: 0, retired: retired.length, stoppedBy: pending.stoppedBy, results };
  const pollable = paymentLinksModel.listPollable({ now, force }).filter((link) => (link.provider || provider.id) === provider.id);
  let checked = 0;
  let stoppedBy = null;

  for (const link of pollable) {
    checked += 1;
    if (!link.providerLinkId) { results.push({ id: link.id, status: 'skipped-no-remote-id' }); continue; }
    try {
      // Stamped with the pass start, not the call time, so the hourly tier fires every 4th tick
      // instead of drifting to the 5th.
      paymentLinksModel.touchPolled(link.id, now);
      // Authoritative "paid" signal = the provider's payment record for the link.
      const pay = await provider.getPayment(link.providerLinkId, { origin: 'poll' });
      if (pay.paid) {
        const res = await processPaidLink({ database, devisModel, paymentLinksModel, link, paidPayment: pay, sendConfirmation, checkConflict, notifyConflict, recordPayment });
        results.push(res);
        continue;
      }
      // With a known expiry the status call buys nothing: retireExpired closes the link on time.
      if (paymentLinksModel.hasKnownExpiry(link)) {
        results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'open' });
        continue;
      }
      // Not paid → only a terminal expired/cancelled link status changes our record; else stays open.
      const remote = await provider.getLinkStatus(link.providerLinkId);
      if (remote === 'expired' || remote === 'cancelled') {
        paymentLinksModel.updateStatus(link.id, remote);
        results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: remote });
      } else {
        results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'open' });
      }
    } catch (err) {
      results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'error', error: String(err && err.message || err) });
      if (err && err.code === 'RATE_LIMITED') { stoppedBy = 'rate-limit'; break; }
    }
  }

  return { checked, paid: results.filter((r) => r.status === 'paid').length, retired: retired.length, stoppedBy, results };
}

module.exports = { runPaymentPoll, processPaidLink, applyPaidEffect, retryPendingCancellations };
