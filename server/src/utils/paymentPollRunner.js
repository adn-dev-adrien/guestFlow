/**
 * Payment poll + webhook core (specs/online-payments-qonto.md §3.3 / §3.4,
 * specs/public-online-payment.md §3/§3bis), provider-neutral since
 * specs/plugins-phase-3a-online-payment.md rules 2, 4, 8.
 *
 * `processPaidLink` is the single idempotent effect of a PAID link — shared by the cron/on-demand
 * **poll** (`runPaymentPoll`) and the provider's **webhook**. Every dependency is injected so it's
 * unit-testable without network or the prod DB:
 *   - paymentLinksModel : retireSettled() / settledBucketDateOf() / markRetiredLinkPaid() / retireExpired() / listPollable() / touchPolled() / hasKnownExpiry() / markPaid() /
 *                         updateStatus() / listRemoteCancelPending() / clearRemoteCancelPending()
 *   - provider          : the payment provider (utils/paymentProviders) — getPayment / getLinkStatus / cancelLink
 *   - devisModel        : convertToReservation(id)
 *   - database          : better-sqlite3 handle (bookingConflictAt)
 *   - recordPayment?    : ({ reservationId, bucket }) → records the paid bucket (utils/stayPaymentRecorder)
 *   - sendConfirmation? : (reservationId) => send the confirmation email (best-effort)
 *   - checkConflict?    : ({ reservationId }) => boolean — dates no longer free at conversion
 *   - notifyConflict?   : (reservationId) => notify the admin of an over-booked paid booking (best-effort)
 *   - notifyPaidAfterCancel? : (link, { settledOn }?) => tell the admin a cancelled link was paid (best-effort,
 *                              rule 8; `settledOn` = the bucket was settled another way before, rule 24)
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

const { linkAmountCents, bookPaidAfterAmountChange } = require('./ledgerLinks');

// Apply the business consequence of a PAID link. A deposit OR a full payment on a devis converts it to a
// reservation; a full payment marks it fully settled (deposit + balance). On conversion the dates are
// re-checked (the devis never blocked them) — a conflict flags the reservation + surfaces `conflict:true`.
// The bucket goes through the same recorder as a manual tick (rule 1).
function applyPaidEffect({ database, devisModel, link, checkConflict, paidDate = null, recordPayment = recordOn(database), settledAlready = false }) {
  const row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(link.reservationId);
  if (!row) return { effect: 'no-reservation' };
  // A payment that lands after the stay was cancelled is money to refund, never a paid stay.
  if (row.kind === 'cancelled') return { effect: 'reservation-cancelled' };
  // A devis link keeps the devis id once the devis is converted: the stay it became is the one that counts.
  const convertedRow = row.kind === 'devis' && row.convertedReservationId
    ? database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(row.convertedReservationId)) : null;
  if (convertedRow && convertedRow.kind === 'cancelled') return { effect: 'reservation-cancelled' };

  // specs/direct-installments.md rule 15 — a paid link of an installment marks that installment paid.
  if (link.type === 'installment') {
    const { recordInstallmentPayment } = require('./installmentPayment');
    const { emit } = require('../plugins/sdk/eventBus');
    // Booked at what the link really charged: a link retired by a rebalance and paid anyway keeps its amount.
    const booked = recordInstallmentPayment({ db: database, emit }, {
      installmentId: link.installmentId, paidDate, method: 'link', amountCents: link.amountCents,
    });
    // Rule 34 — money with no installment to land on, or on one already collected, is the admin's to sort out.
    if (!booked.found) return { effect: 'installment-unallocated' };
    if (!booked.flipped && !settledAlready) return { effect: 'installment-double-payment' };
    return { effect: 'installment-marked' };
  }

  const isDeposit = link.type === 'deposit';
  const isFull = link.type === 'full';

  // Deposit or full payment on a DEVIS → confirm the stay (convert) and mark paid.
  if ((isDeposit || isFull) && row.kind === 'devis') {
    let reservationId = row.convertedReservationId;
    let effect = 'already-converted';
    if (!reservationId) {
      const conv = devisModel.convertToReservation(link.reservationId, { allowConflict: true });
      if (conv && conv.error) return { effect: 'convert-failed', error: conv.error };
      reservationId = conv.data.reservationId;
      effect = 'converted';
    }
    if (effect === 'already-converted') {
      const second = secondPaidLink(database, link, reservationId, isFull);
      if (second) {
        // Acompte paid, then the full link: only the acompte part is paid twice, the rest is the solde.
        if (second.duplicateCents != null) recordPayment({ reservationId, bucket: 'balance', paidDate });
        return { effect: 'double-payment', duplicateLink: true, duplicateCents: second.duplicateCents, reservationId, conflict: false };
      }
    }
    const conflict = flagConflictIfAny({ database, checkConflict, reservationId });
    // The quote can be re-priced after its link was minted, and a link older than the tourist-tax rule
    // charges less than the quote asks: what the guest paid is booked, never the quote's amount.
    // A legacy devis stored without its split (both NULL) has no amount to compare with.
    // An already converted devis is compared with the stay it became, which the fiche may have re-priced.
    const priced = effect === 'already-converted' && convertedRow && convertedRow.kind === 'reservation' ? convertedRow : row;
    const hasSplit = priced.depositAmount != null && priced.balanceAmount != null;
    const expectedCents = hasSplit ? linkAmountCents(link.type, priced) : null;
    if (expectedCents != null && link.amountCents != null && Number(link.amountCents) !== expectedCents) {
      const booked = bookPaidAfterAmountChange({ database, recordPayment }, link, { paidDay: paidDate });
      return { effect: booked.effect, reservationId, conflict, justConverted: effect === 'converted', amountMismatch: { expectedCents, receivedCents: Number(link.amountCents) } };
    }
    recordPayment({ reservationId, bucket: isFull ? 'full' : 'deposit', paidDate });
    return { effect, reservationId, conflict };
  }

  if (isDeposit) {
    recordPayment({ reservationId: link.reservationId, bucket: 'deposit', paidDate });
    return { effect: 'deposit-marked' };
  }

  // balance / full on an existing reservation → the stay is fully paid pre-arrival. A full link charged
  // the acompte too when there is one (specs/deposit-blocks-the-dates.md rule 18): both buckets.
  if (link.type === 'balance' || isFull) {
    const coversDeposit = isFull && Number(row.depositAmount || 0) > 0;
    recordPayment({ reservationId: link.reservationId, bucket: coversDeposit ? 'full' : 'balance', paidDate });
    return { effect: 'balance-marked' };
  }
  return { effect: 'noop' };
}

// Two live links of one quote both paid (a retried request minted twice): the second money is a refund
// to make, not a second payment to record or a second confirmation to send.
function secondPaidLink(database, link, reservationId, isFull) {
  const others = database.prepare(
    "SELECT type, amountCents FROM payment_links WHERE reservationId = ? AND type IN ('deposit', 'full') AND status = 'paid' AND id <> ?",
  ).all(Number(link.reservationId), Number(link.id));
  if (others.length === 0) return null;
  const flags = database.prepare('SELECT depositPaid, balancePaid FROM reservations WHERE id = ?').get(Number(reservationId));
  if (!flags) return null;
  // An acompte link and a full link both settle the acompte. Acompte first, then the full link: the
  // acompte part is the only duplicate, the surplus is the solde (only while the solde is still open).
  const deposit = others.find((o) => o.type === 'deposit');
  if (isFull && deposit && Number(flags.depositPaid || 0) === 1) {
    if (Number(flags.balancePaid || 0) === 1) return { duplicateCents: null };
    return { duplicateCents: Math.min(Number(deposit.amountCents || 0), Number(link.amountCents || 0)) };
  }
  if (others.some((o) => o.type !== link.type)) return Number(flags.depositPaid || 0) === 1 ? { duplicateCents: null } : null;
  if (!others.some((o) => o.type === link.type)) return null;
  return Number(flags.depositPaid || 0) === 1 && (!isFull || Number(flags.balancePaid || 0) === 1) ? { duplicateCents: null } : null;
}

// The stay a `full` link pays on when its acompte is already collected and its solde is not.
function fullAfterDeposit(database, link) {
  if (String(link.type) !== 'full') return null;
  const own = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(link.reservationId));
  if (!own) return null;
  const stay = own.kind === 'devis' && own.convertedReservationId
    ? database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(own.convertedReservationId)) : own;
  if (!stay || stay.kind !== 'reservation') return null;
  if (Number(stay.depositPaid || 0) !== 1 || Number(stay.balancePaid || 0) === 1 || !(Number(stay.depositAmount || 0) > 0)) return null;
  return { stayId: stay.id, duplicateCents: Math.min(Math.round(Number(stay.depositAmount) * 100), Number(link.amountCents || 0)) };
}

function recordRefundOwed(database, reservationId, link, duplicateCents = null) {
  const amount = require('./reservationLedger').formatEuros(Number(duplicateCents == null ? link.amountCents || 0 : duplicateCents) / 100);
  database.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'update', ?)")
    .run(Number(reservationId), JSON.stringify([{
      field: 'refundOwed', label: 'Remboursement à faire', from: '', to: `${amount} payés deux fois (lien ${link.id}) : à rembourser depuis l’espace du prestataire`,
    }]));
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

// specs/reservation-payment-ledger.md rule 47 — an OPEN link paid for an amount the reservation no
// longer asks for. The HTTP save retires such a link (rule 29), but a stay re-priced through
// `performUpdate` (plugins, SAS, arrival payment) keeps it open; ticking the bucket would then record
// the new amount as received. The money is booked at the link's amount instead, exactly as for a
// retired link (rule 31). Null when the amounts agree, for a devis, or when the bucket was already
// perceived another way (the idempotent recorder below then records nothing, as before).
function bookIfAmountChanged({ database, link, paidDate, recordPayment }) {
  if (!database || !['deposit', 'balance', 'full'].includes(String(link.type))) return null;
  const row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(link.reservationId));
  if (!row || String(row.kind) !== 'reservation') return null;
  const column = { deposit: 'depositAmount', balance: 'balanceAmount', full: 'balanceAmount' }[link.type];
  if (row[column] == null) return null;
  const expected = linkAmountCents(link.type, row);
  if (expected == null || Number(link.amountCents) === expected) return null;
  const booked = bookPaidAfterAmountChange({ database, recordPayment: recordPayment || recordOn(database) }, link, { paidDay: paidDate });
  return booked.effect === 'double-payment' ? null : booked;
}

// A paid link confirms the stay (→ confirmation email) for the deposit (use case 1) and full-payment
// (use case 2) flows; a balance payment is a later top-up, not the initial confirmation.
const CONFIRMING_TYPES = new Set(['deposit', 'full']);
const CONFIRMING_EFFECTS = new Set(['converted', 'already-converted', 'deposit-marked', 'balance-marked', 'deposit-booked', 'balance-booked', 'full-booked']);

// The shared effect of one PAID link: mark paid → apply the business effect → confirmation email +
// conflict notification (both best-effort). Idempotent. Returns the per-link result object.
// `emitPluginEvent` is injectable like every other dep; by default the webhook, the on-demand poll
// and the cron all announce a freshly converted reservation to the plugins (Google pushes it at
// once — specs/plugins-phase-1-sdk.md rule 9).
async function processPaidLink({ database, devisModel, paymentLinksModel, link, paidPayment, sendConfirmation, checkConflict, notifyConflict, notifyPaidAfterCancel, recordPayment, emitPluginEvent = require('../plugins/sdk/eventBus').emit }) {
  const p = paidPayment || {};
  // markPaid is atomic (UPDATE … WHERE status='open') and reports whether THIS call flipped the link.
  // The webhook, the on-demand /status poll and the cron can all observe the same paid link at once;
  // only the caller that actually flips it runs the effect + confirmation email, so the guest never
  // gets a duplicate email and the admin never gets a duplicate conflict alert.
  const { flipped } = paymentLinksModel.markPaid(link.id, { providerPaymentId: p.paymentId || null, paidAt: p.paidAt || new Date().toISOString() });
  if (!flipped) {
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', effect: 'already-processed' };
  }
  // The day the guest paid, as the provider says, in Paris time — not the day we noticed.
  const paidDate = require('./stayPaymentRecorder').paidDayOf(p.paidAt);
  const effect = bookIfAmountChanged({ database, link, paidDate, recordPayment })
    || applyPaidEffect({ database, devisModel, link, checkConflict, paidDate, recordPayment });
  if (effect.effect === 'double-payment') {
    // Two live links of one devis both paid: the second money is a refund, kept on the fiche's history.
    if (effect.duplicateLink) {
      recordRefundOwed(database, effect.reservationId, link, effect.duplicateCents);
      if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, { doublePaid: true, ...(effect.duplicateCents != null ? { duplicateCents: effect.duplicateCents } : {}) }); } catch { /* best effort */ } }
      return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid-after-cancel', ...effect };
    }
    // The bucket was settled another way. Settled the very day of the payment (or after), it is the same
    // money ticked by hand; settled on an earlier day, it may be a second one (ledger rule 24).
    const settledOn = typeof paymentLinksModel.settledBucketDateOf === 'function' ? paymentLinksModel.settledBucketDateOf(link) : null;
    if (settledOn && paidDate && settledOn < paidDate) {
      if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, { settledOn }); } catch { /* best effort */ } }
      return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid-after-settled', settledOn, ...effect };
    }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect, effect: 'settled-elsewhere' };
  }
  if (effect.amountMismatch) {
    if (effect.justConverted) emitPluginEvent('reservation.created', { reservationId: effect.reservationId });
    if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, { amountMismatch: effect.amountMismatch }); } catch { /* best effort */ } }
    if (effect.conflict && notifyConflict) { try { await notifyConflict(effect.reservationId); } catch { /* best effort */ } }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect };
  }
  if (effect.effect === 'reservation-cancelled' || effect.effect === 'installment-unallocated' || effect.effect === 'installment-double-payment') {
    if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link); } catch { /* best effort */ } }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect };
  }

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
// deactivate. A paid one is never recorded on the stay (it was cancelled or replaced) — except a link
// retired for an amount change, booked at its amount (specs/reservation-payment-ledger.md rule 31): the admin is told,
// the payment's id stays on the row for the refund. Returns the per-link results, and whether a rate
// limit stopped the retries.
const retryInFlight = new WeakMap();
function retryPendingCancellations(deps) {
  const running = retryInFlight.get(deps.paymentLinksModel);
  if (running) return running;
  const run = retryPendingCancellationsOnce(deps).finally(() => retryInFlight.delete(deps.paymentLinksModel));
  retryInFlight.set(deps.paymentLinksModel, run);
  return run;
}

async function retryPendingCancellationsOnce({ paymentLinksModel, provider, notifyPaidAfterCancel, database, devisModel, recordPayment, checkConflict, notifyConflict, emitPluginEvent }) {
  const results = [];
  for (const link of paymentLinksModel.listRemoteCancelPending()) {
    if (link.provider !== provider.id || !link.providerLinkId) continue;
    try {
      const pay = await provider.getPayment(link.providerLinkId, { origin: 'cancel-link' });
      if (pay.paid && link.cancelReason === 'settled') {
        results.push(await settleRetiredPaidLink({ paymentLinksModel, notifyPaidAfterCancel, database, devisModel, recordPayment, link, pay }));
        continue;
      }
      if (pay.paid && link.cancelReason === 'amount-changed' && database) {
        const book = link.type === 'installment' ? bookInstallmentPaidAfterAmountChange : bookAmountChangedPaidLink;
        results.push(await book({ paymentLinksModel, notifyPaidAfterCancel, database, devisModel, recordPayment, checkConflict, notifyConflict, emitPluginEvent, link, pay }));
        continue;
      }
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
      if (await require('./paymentLinkDeactivation').alreadyInactive(provider, link.providerLinkId)) {
        paymentLinksModel.clearRemoteCancelPending(link.id);
        results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'already-inactive' });
        continue;
      }
      results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'deactivation-pending', error: String((err && err.message) || err) });
      if (err && err.code === 'RATE_LIMITED') return { results, stoppedBy: 'rate-limit' };
    }
  }
  return { results, stoppedBy: null };
}

// specs/plugins-phase-3a-online-payment.md rule 24 — a link retired by rule 23 and found paid. Most of
// the time it is the very payment the operator saw arrive and ticked by hand before the webhook did:
// the link becomes `paid` and the bucket goes through the idempotent recorder (already paid → nothing).
// Only a bucket recorded paid on an EARLIER day than this payment points to a second payment: then the
// link keeps its payment id for a possible refund and the admin is asked to check.
async function settleRetiredPaidLink({ paymentLinksModel, notifyPaidAfterCancel, database, devisModel, recordPayment, link, pay }) {
  const { paidDayOf } = require('./stayPaymentRecorder');
  const paidAt = pay.paidAt || new Date().toISOString();
  const paidDay = paidDayOf(paidAt);
  const settledOn = paymentLinksModel.settledBucketDateOf(link);
  if (settledOn && paidDay && settledOn < paidDay) {
    paymentLinksModel.clearRemoteCancelPending(link.id, { providerPaymentId: pay.paymentId || null, paidAt });
    if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, { settledOn }); } catch { /* best effort */ } }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid-after-settled', settledOn };
  }
  paymentLinksModel.markRetiredLinkPaid(link.id, { providerPaymentId: pay.paymentId || null, paidAt });
  if (!database) return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', effect: 'settled-elsewhere' };
  // A full link retired because the acompte was paid, paid anyway: the acompte part is paid twice, the
  // rest is the solde (same as a live second link, see applyPaidEffect).
  const duplicate = fullAfterDeposit(database, link);
  if (duplicate) {
    (recordPayment || recordOn(database))({ reservationId: duplicate.stayId, bucket: 'balance', paidDate: paidDay });
    recordRefundOwed(database, duplicate.stayId, link, duplicate.duplicateCents);
    if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, { doublePaid: true, duplicateCents: duplicate.duplicateCents }); } catch { /* best effort */ } }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid-after-cancel', effect: 'double-payment', duplicateLink: true, duplicateCents: duplicate.duplicateCents };
  }
  const effect = applyPaidEffect({ database, devisModel, link, paidDate: paidDay, recordPayment: recordPayment || recordOn(database), settledAlready: true });
  if (effect.effect === 'double-payment' && effect.duplicateLink) {
    recordRefundOwed(database, effect.reservationId, link, effect.duplicateCents);
    if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, { doublePaid: true, ...(effect.duplicateCents != null ? { duplicateCents: effect.duplicateCents } : {}) }); } catch { /* best effort */ } }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid-after-cancel', ...effect };
  }
  if ((effect.effect === 'reservation-cancelled' || effect.effect === 'installment-unallocated') && notifyPaidAfterCancel) {
    try { await notifyPaidAfterCancel(link); } catch { /* best effort */ }
  }
  return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect };
}

// specs/reservation-payment-ledger.md rule 31 (§9 Q3) — a link the fiche retired because its amount
// changed, paid anyway. The money is real: it lands on the fiche at the link's amount (the acompte
// becomes that amount and the solde absorbs the rest; the solde is recorded at it; the complement is
// recorded and its ledger row warns). The link becomes `paid` and the admin is told, as for every paid
// retired link. If the bucket was meanwhile perceived another way it is a double payment: nothing is
// recorded, the link keeps its payment id for the refund — the behaviour of rule 8.
async function bookAmountChangedPaidLink({ paymentLinksModel, notifyPaidAfterCancel, database, devisModel, recordPayment, checkConflict, notifyConflict, emitPluginEvent = require('../plugins/sdk/eventBus').emit, link, pay }) {
  const { paidDayOf } = require('./stayPaymentRecorder');
  const paidAt = pay.paidAt || new Date().toISOString();
  if (!paymentLinksModel.claimRemoteCancelPending(link.id)) {
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'already-processed', effect: 'claimed-elsewhere' };
  }
  try {
    return await bookClaimedAmountChangedLink({ paymentLinksModel, notifyPaidAfterCancel, database, devisModel, recordPayment, checkConflict, notifyConflict, emitPluginEvent, link, pay, paidAt, paidDayOf });
  } catch (err) {
    paymentLinksModel.restoreRemoteCancelPending(link.id);
    throw err;
  }
}

async function bookClaimedAmountChangedLink({ paymentLinksModel, notifyPaidAfterCancel, database, devisModel, recordPayment, checkConflict, notifyConflict, emitPluginEvent, link, pay, paidAt, paidDayOf }) {
  // A link retired from a devis the guest paid before it was deactivated: the money is real, so the devis
  // becomes the stay first (the payment is what confirms it) and the link is booked at what was received.
  const stay = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(link.reservationId));
  let converted = null;
  if (stay && stay.kind === 'devis' && !stay.convertedReservationId && devisModel && typeof devisModel.convertToReservation === 'function') {
    const conv = devisModel.convertToReservation(link.reservationId, { allowConflict: true });
    if (conv && !conv.error && conv.data) converted = conv.data.reservationId;
  }
  // What the stay asks, read before the booking rewrites it: the alert states the real direction.
  const target = converted
    ? database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(converted))
    : (stay && stay.kind === 'devis' && stay.convertedReservationId
      ? database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(stay.convertedReservationId)) : stay);
  const expectedCents = target && target.kind === 'reservation' && ['deposit', 'balance', 'full'].includes(String(link.type))
    ? linkAmountCents(link.type, target) : null;
  const mismatch = expectedCents != null ? { expectedCents, receivedCents: Number(link.amountCents) } : null;
  const booked = bookPaidAfterAmountChange(
    { database, recordPayment: recordPayment || recordOn(database) },
    link,
    { paidDay: paidDayOf(paidAt) },
  );
  const unbooked = ['double-payment', 'no-reservation', 'not-a-reservation', 'noop'].includes(booked.effect);
  if (unbooked) {
    paymentLinksModel.clearRemoteCancelPending(link.id, { providerPaymentId: pay.paymentId || null, paidAt });
  } else {
    paymentLinksModel.markRetiredLinkPaid(link.id, { providerPaymentId: pay.paymentId || null, paidAt, reason: 'amount-changed' });
  }
  if (converted) {
    emitPluginEvent('reservation.created', { reservationId: converted });
    const conflict = flagConflictIfAny({ database, checkConflict, reservationId: converted });
    if (conflict && notifyConflict) { try { await notifyConflict(converted); } catch { /* best effort */ } }
  }
  if (notifyPaidAfterCancel) {
    try { await notifyPaidAfterCancel(link, mismatch && !unbooked ? { amountMismatch: mismatch } : {}); } catch { /* best effort */ }
  }
  return { id: link.id, reservationId: link.reservationId, type: link.type, status: unbooked ? 'paid-after-cancel' : 'paid', ...booked };
}

// specs/direct-installments.md rule 17 — the same for an installment: the link retired for an amount change
// was paid at its old amount. The money is real, so the installment takes that amount (pinned) and the
// others rebalance; an installment paid meanwhile another way makes it a double payment (nothing recorded,
// the payment id stays on the row for the refund).
async function bookInstallmentPaidAfterAmountChange({ paymentLinksModel, notifyPaidAfterCancel, database, link, pay }) {
  const { paidDayOf } = require('./stayPaymentRecorder');
  const { recordInstallmentPayment } = require('./installmentPayment');
  const { emit } = require('../plugins/sdk/eventBus');
  const paidAt = pay.paidAt || new Date().toISOString();
  const booked = recordInstallmentPayment({ db: database, emit }, {
    installmentId: link.installmentId, paidDate: paidDayOf(paidAt), method: 'link', amountCents: link.amountCents,
  });
  if (booked.flipped) paymentLinksModel.markRetiredLinkPaid(link.id, { providerPaymentId: pay.paymentId || null, paidAt, reason: 'amount-changed' });
  else paymentLinksModel.clearRemoteCancelPending(link.id, { providerPaymentId: pay.paymentId || null, paidAt });
  if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link); } catch { /* best effort */ } }
  const effect = booked.flipped ? 'installment-booked' : (booked.found ? 'double-payment' : 'installment-unallocated');
  return { id: link.id, reservationId: link.reservationId, type: link.type, status: booked.flipped ? 'paid' : 'paid-after-cancel', effect };
}

// One pass (specs/payment-polling-fair-use.md): retry the owed deactivations, retire links past a known
// expiry without calling the provider, then check only the open links the decaying cadence says are due
// (`force` = a human asked, every open link). A rate limit that survives the client's back-off stops the
// pass: the links not yet examined wait for the next tick instead of being requested into a `429`.
async function runPaymentPoll({ database, paymentLinksModel, provider, devisModel, sendConfirmation, checkConflict, notifyConflict, notifyPaidAfterCancel, recordPayment, force = false, now = new Date() }) {
  // specs/plugins-phase-3a-online-payment.md rule 23 — a link whose bucket was settled another way
  // leaves the polling list and joins the owed deactivations retried just below.
  const settled = typeof paymentLinksModel.retireSettled === 'function' ? paymentLinksModel.retireSettled() : [];
  const pending = await retryPendingCancellations({ paymentLinksModel, provider, notifyPaidAfterCancel, database, devisModel, recordPayment, checkConflict, notifyConflict });
  const retired = paymentLinksModel.retireExpired({ now });
  const results = [
    ...settled.filter((link) => !link.providerLinkId).map((link) => ({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'settled', effect: 'retired-locally' })),
    ...pending.results,
    ...retired.map((link) => ({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'expired', effect: 'retired-locally' })),
  ];
  if (pending.stoppedBy) return { checked: 0, paid: 0, retired: retired.length, settled: settled.length, stoppedBy: pending.stoppedBy, results };
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
        const res = await processPaidLink({ database, devisModel, paymentLinksModel, link, paidPayment: pay, sendConfirmation, checkConflict, notifyConflict, notifyPaidAfterCancel, recordPayment });
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

  return { checked, paid: results.filter((r) => r.status === 'paid').length, retired: retired.length, settled: settled.length, stoppedBy, results };
}

module.exports = { runPaymentPoll, processPaidLink, applyPaidEffect, retryPendingCancellations };
