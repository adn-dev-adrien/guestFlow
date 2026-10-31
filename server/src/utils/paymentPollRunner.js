/**
 * Payment poll + webhook core (specs/online-payments-qonto.md §3.3 / §3.4,
 * specs/public-online-payment.md §3/§3bis), provider-neutral since
 * specs/plugins-phase-3a-online-payment.md rules 2, 4, 8.
 *
 * `processPaidLink` is the single idempotent effect of a PAID link — shared by the cron/on-demand
 * **poll** (`runPaymentPoll`) and the provider's **webhook**. Every dependency is injected so it's
 * unit-testable without network or the prod DB:
 *   - paymentLinksModel : retireSettled() / settledBucketDateOf() / markRetiredLinkPaid() / retireExpired() / lapseIfOpen() / listPollable() / touchPolled() /
 *                         hasKnownExpiry() / markPaid() / updateStatus() / listRemoteCancelPending() / clearRemoteCancelPending() /
 *                         setLastLook() / claimLastLook() / claimDeactivationAlert()
 *   - provider          : the payment provider (utils/paymentProviders) — getPayment / getLinkStatus / cancelLink
 *   - devisModel        : convertToReservation(id)
 *   - database          : better-sqlite3 handle (bookingConflictAt)
 *   - recordPayment?    : ({ reservationId, bucket }) → records the paid bucket (utils/stayPaymentRecorder)
 *   - sendConfirmation? : (reservationId) => send the confirmation email (best-effort)
 *   - checkConflict?    : ({ reservationId }) => boolean — dates no longer free at conversion
 *   - notifyConflict?   : (reservationId) => notify the admin of an over-booked paid booking (best-effort)
 *   - notifyPaidAfterCancel? : (link, { settledOn }?) => tell the admin a cancelled link was paid (best-effort,
 *                              rule 8; `settledOn` = the bucket was settled another way before, rule 24;
 *                              `orphan` = the stay row is gone, specs/payment-link-lifecycle.md rule 3)
 *   - notifyDeactivationStuck? : (link, { providerLabel }) => a lapsed link still active after 24 h (rule 20)
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

const { linkAmountCents, acompteIsLinkMoney, bookPaidAfterAmountChange } = require('./ledgerLinks');
const { withConvertedDevis } = require('./deletionGuard');
const { LINK_REASONS } = require('../constants/paymentLinks');
const { unavailableNights } = require('./closedStayDates');

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
    if (!settledAlready && effect === 'already-converted' && bucketAlreadySettled(convertedRow, link.type)) {
      return { effect: 'double-payment', reservationId, conflict: false };
    }
    const conflict = flagConflictIfAny({ database, checkConflict, reservationId });
    // specs/payment-link-lifecycle.md rule 55 (audit R10-1) — defence in depth: a devis that reached closed nights
    // anyway is booked, but its guest is never confirmed there.
    const closed = closedNightsOf(database, reservationId);
    // The quote can be re-priced after its link was minted, and a link older than the tourist-tax rule
    // charges less than the quote asks: what the guest paid is booked, never the quote's amount.
    // A legacy devis stored without its split (both NULL) has no amount to compare with.
    // An already converted devis is compared with the stay it became, which the fiche may have re-priced.
    const priced = effect === 'already-converted' && convertedRow && convertedRow.kind === 'reservation' ? convertedRow : row;
    const hasSplit = priced.depositAmount != null && priced.balanceAmount != null;
    const expectedCents = hasSplit ? linkAmountCents(link.type, priced) : null;
    if (expectedCents != null && link.amountCents != null && Number(link.amountCents) !== expectedCents) {
      const booked = bookPaidAfterAmountChange({ database, recordPayment }, link, { paidDay: paidDate });
      return { effect: booked.effect, reservationId, conflict, closed, justConverted: effect === 'converted', amountMismatch: mismatchOf(link, priced, database, paidDate) };
    }
    recordPayment({ reservationId, bucket: isFull ? 'full' : 'deposit', paidDate });
    return { effect, reservationId, conflict, closed };
  }

  // A link minted on the stay itself, paid after another link of the same stay (its own or the devis it
  // came from) already took the money: a refund to make, like two links of one devis.
  if ((isDeposit || isFull) && row.kind === 'reservation') {
    const second = secondPaidLink(database, link, row.id, isFull);
    if (second) {
      if (second.duplicateCents != null) recordPayment({ reservationId: row.id, bucket: 'balance', paidDate });
      return { effect: 'double-payment', duplicateLink: true, duplicateCents: second.duplicateCents, reservationId: row.id, conflict: false };
    }
  }

  if (link.type === 'balance' && row.kind === 'reservation' && Number(row.balancePaid || 0) === 1) {
    const owners = withConvertedDevis(database, [Number(row.id)]);
    const earlier = database.prepare(
      `SELECT 1 FROM payment_links WHERE reservationId IN (${owners.map(() => '?').join(',')}) AND type IN ('balance', 'full') AND status = 'paid' AND id <> ? LIMIT 1`,
    ).get(...owners, Number(link.id));
    if (earlier) return { effect: 'double-payment', duplicateLink: true, duplicateCents: null, reservationId: row.id, conflict: false };
  }

  if (!settledAlready && bucketAlreadySettled(row, link.type)) {
    return { effect: 'double-payment', reservationId: row.id, conflict: false };
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

// A minimal schema (a unit suite's) without closures or logements has no closed nights.
function closedNightsOf(database, stayId) {
  const hasClosures = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'establishment_closures'").get();
  const hasProperty = database.prepare('PRAGMA table_info(reservations)').all().some((c) => c.name === 'propertyId');
  return Boolean(hasClosures && hasProperty && require('./closedStayDates').closedDatesRefusal(database, stayId));
}

// Rule 39 — the bucket a link pays was already collected another way (the arrival payment, a tick by hand):
// the payment is neither recorded nor confirmed again, and `processPaidLink` compares the two days (rule 24).
function bucketAlreadySettled(stay, type) {
  if (!stay || stay.kind !== 'reservation') return false;
  if (type === 'deposit') return Number(stay.depositPaid || 0) === 1 || Number(stay.depositPaidCash || 0) === 1;
  if (type === 'balance' || type === 'full') return Number(stay.balancePaid || 0) === 1 || Number(stay.balancePaidCash || 0) === 1;
  return false;
}

// Rule 44 — what the alert compares the payment with: a full link paid on a stay whose acompte is already
// collected is booked as the solde, so the amount to chase or refund is read against the solde alone.
// Rule 45 — unless that acompte was ticked the day of the payment: it is then the link's own money, booked
// with the solde, and the link is compared with the whole amount.
function alertExpectedCents(link, stay, database = null, paidDay = null) {
  const depositCollected = Number(stay.depositPaid || 0) === 1 && Number(stay.depositAmount || 0) > 0;
  return String(link.type) === 'full' && depositCollected && Number(stay.balancePaid || 0) !== 1
    && !(database && acompteIsLinkMoney(database, link, stay, paidDay))
    ? linkAmountCents('balance', stay) : linkAmountCents(link.type, stay);
}

// Online-payment rule 47 — what the admin is told about a link paid for another amount. A payment booked as the
// acompte (an acompte link, or a full link short of the acompte) records the acompte at what was received and
// lets the solde absorb the gap (pre-arrival total unchanged): it carries the resulting solde (`balanceCents`),
// and `excessCents` when the payment exceeds the whole pre-arrival total. Read on the stay before the booking.
// Rule 48 — an acompte link paid on a stay switched to « Sans acompte » re-enables it: `depositReenabled`.
// Rule 49 — on a solde already collected, `balanceSettled`, `balanceCents` is that solde, the excess `excessCents`.
function mismatchOf(link, stay, database, paidDay) {
  const receivedCents = Number(link.amountCents);
  const depositCents = Math.round(Number(stay.depositAmount || 0) * 100);
  const depositSettled = Number(stay.depositPaid || 0) === 1 || Number(stay.depositPaidCash || 0) === 1;
  const bookedAsDeposit = String(link.type) === 'deposit'
    || (String(link.type) === 'full' && (!depositSettled || acompteIsLinkMoney(database, link, stay, paidDay))
      && Number(stay.depositDisabled || 0) !== 1 && depositCents > 0 && receivedCents <= depositCents);
  if (bookedAsDeposit) {
    const storedBalanceCents = Math.round(Number(stay.balanceAmount || 0) * 100);
    const preArrival = depositCents + storedBalanceCents;
    // Rule 49 — a solde already collected keeps its amount: the acompte lands on top of it.
    const balanceSettled = Number(stay.balancePaid || 0) === 1 || Number(stay.balancePaidCash || 0) === 1;
    const balanceCents = balanceSettled ? storedBalanceCents : Math.max(0, preArrival - receivedCents);
    const excessCents = receivedCents + balanceCents - preArrival;
    return {
      expectedCents: depositCents, receivedCents, balanceCents,
      ...(balanceSettled ? { balanceSettled: true } : {}),
      ...(String(link.type) === 'deposit' && Number(stay.depositDisabled || 0) === 1 ? { depositReenabled: true } : {}),
      ...(excessCents > 0 ? { excessCents } : {}),
    };
  }
  return { expectedCents: alertExpectedCents(link, stay, database, paidDay), receivedCents };
}

// Only the acompte wording says whether the confirmation went out; the other alerts always state it is held.
function alertOptions(amountMismatch, confirmationSent) {
  return amountMismatch.balanceCents != null ? { amountMismatch, confirmationSent } : { amountMismatch };
}

// Rule 43 — a bucket collected at the door is never the link's money, so rule 24's same-day reading does not apply.
function atArrival(paymentLinksModel, link) {
  return typeof paymentLinksModel.settledAtArrival === 'function' && paymentLinksModel.settledAtArrival(link);
}

// Two live links of one quote both paid (a retried request minted twice): the second money is a refund
// to make, not a second payment to record or a second confirmation to send.
// The links of the stay and of the devis it came from count together: a devis link keeps the devis id.
function secondPaidLink(database, link, reservationId, isFull) {
  const owners = withConvertedDevis(database, [Number(reservationId), Number(link.reservationId)]);
  const others = database.prepare(
    `SELECT type, amountCents FROM payment_links WHERE reservationId IN (${owners.map(() => '?').join(',')}) AND type IN ('deposit', 'full') AND status = 'paid' AND id <> ?`,
  ).all(...owners, Number(link.id));
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

// The stay a `full` link pays on when its acompte is already collected and its solde is not. The duplicate is
// what the link brought beyond the solde still owed (rule 41); a link whose amount no longer matches the stay
// carries `mismatch` instead, and is booked at what it brought. An acompte ticked the day of the payment, with
// no paid acompte or full link behind it, is the money the operator saw arrive (rule 42): `sameDay`.
function fullAfterDeposit(database, link, paidDay = null) {
  if (String(link.type) !== 'full') return null;
  const own = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(link.reservationId));
  if (!own) return null;
  const stay = own.kind === 'devis' && own.convertedReservationId
    ? database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(own.convertedReservationId)) : own;
  if (!stay || stay.kind !== 'reservation') return null;
  if (Number(stay.depositPaid || 0) !== 1 || Number(stay.balancePaid || 0) === 1 || !(Number(stay.depositAmount || 0) > 0)) return null;
  const linkCents = Number(link.amountCents || 0);
  const expectedCents = linkAmountCents('full', stay);
  const found = { stayId: stay.id, duplicateCents: 0, mismatch: null, sameDay: acompteIsLinkMoney(database, link, stay, paidDay) };
  if (stay.balanceAmount != null && linkCents !== expectedCents) {
    found.mismatch = mismatchOf(link, stay, database, paidDay);
    return found;
  }
  if (found.sameDay) return found;
  found.duplicateCents = Math.max(0, linkCents - Math.round(Number(stay.balanceAmount || 0) * 100));
  return found;
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
// retired link (rule 31), and the admin is told like for that one (online-payment rule 47: `amountMismatch`,
// read on the row before the booking rewrites it, so no confirmation goes out). Null when the amounts agree, for a devis, or when the bucket was already
// perceived another way (the idempotent recorder below then records nothing, as before).
function bookIfAmountChanged({ database, link, paidDate, recordPayment }) {
  if (!database || !['deposit', 'balance', 'full'].includes(String(link.type))) return null;
  const row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(link.reservationId));
  if (!row || String(row.kind) !== 'reservation') return null;
  const column = { deposit: 'depositAmount', balance: 'balanceAmount', full: 'balanceAmount' }[link.type];
  if (row[column] == null) return null;
  const expected = linkAmountCents(link.type, row);
  if (expected == null || Number(link.amountCents) === expected) return null;
  const amountMismatch = mismatchOf(link, row, database, paidDate);
  const booked = bookPaidAfterAmountChange({ database, recordPayment: recordPayment || recordOn(database) }, link, { paidDay: paidDate });
  return booked.effect === 'double-payment' ? null : { ...booked, amountMismatch };
}

const stayIsMissing = (database, link) => Boolean(database) && !database.prepare('SELECT 1 FROM reservations WHERE id = ?').get(Number(link.reservationId));
const orphanAlert = (pay, paidAt) => ({ orphan: true, paidAt: paidAt || (pay && pay.paidAt) || null, providerPaymentId: (pay && pay.paymentId) || null });

// A paid link confirms the stay (→ confirmation email) for the deposit (use case 1) and full-payment
// (use case 2) flows; a balance payment is a later top-up, not the initial confirmation.
const CONFIRMING_TYPES = new Set(['deposit', 'full']);
const CONFIRMING_EFFECTS = new Set(['converted', 'already-converted', 'deposit-marked', 'balance-marked', 'deposit-booked', 'balance-booked', 'full-booked']);

// The shared effect of one PAID link: mark paid → apply the business effect → confirmation email +
// conflict notification (both best-effort). Idempotent. Returns the per-link result object.
// `emitPluginEvent` is injectable like every other dep; by default the webhook, the on-demand poll
// and the cron all announce a freshly converted reservation to the plugins (Google pushes it at
// once — specs/plugins-phase-1-sdk.md rule 9).
// `retiredReason` books a withdrawn link instead (cancelled → paid, only while it still carries that reason).
// `quietOnConflict`: a booking that lands in date conflict sends the guest no confirmation.
async function processPaidLink({ database, devisModel, paymentLinksModel, link, paidPayment, sendConfirmation, checkConflict, notifyConflict, notifyPaidAfterCancel, recordPayment, emitPluginEvent = require('../plugins/sdk/eventBus').emit, retiredReason = null, quietOnConflict = false }) {
  const p = paidPayment || {};
  // markPaid is atomic (UPDATE … WHERE status='open') and reports whether THIS call flipped the link.
  // The webhook, the on-demand /status poll and the cron can all observe the same paid link at once;
  // only the caller that actually flips it runs the effect + confirmation email, so the guest never
  // gets a duplicate email and the admin never gets a duplicate conflict alert.
  const paidAt = p.paidAt || new Date().toISOString();
  const { flipped } = retiredReason
    ? paymentLinksModel.markRetiredLinkPaid(link.id, { providerPaymentId: p.paymentId || null, paidAt, reason: retiredReason })
    : paymentLinksModel.markPaid(link.id, { providerPaymentId: p.paymentId || null, paidAt });
  if (!flipped) {
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', effect: 'already-processed' };
  }
  // The day the guest paid, as the provider says, in Paris time — not the day we noticed.
  const paidDate = require('./stayPaymentRecorder').paidDayOf(p.paidAt);
  // A full link paid while the acompte was collected another way: the acompte part is paid twice.
  const rebooked = bookIfAmountChanged({ database, link, paidDate, recordPayment });
  // A devis link on a re-priced stay is compared with the stay by applyPaidEffect (rule 41).
  const found = rebooked ? null : fullAfterDeposit(database, link, paidDate);
  const afterDeposit = found && !found.mismatch ? found : null;
  if (afterDeposit) (recordPayment || recordOn(database))({ reservationId: afterDeposit.stayId, bucket: 'balance', paidDate });
  const effect = rebooked
    || (afterDeposit && afterDeposit.sameDay
      ? { effect: 'settled-elsewhere', reservationId: afterDeposit.stayId, conflict: false }
      : afterDeposit
        ? { effect: 'double-payment', duplicateLink: true, duplicateCents: afterDeposit.duplicateCents, reservationId: afterDeposit.stayId, conflict: false }
        : applyPaidEffect({ database, devisModel, link, checkConflict, paidDate, recordPayment }));
  // The link that just paid settles its bucket: every other open link of it is retired now, not at the next poll.
  if (typeof paymentLinksModel.retireSettled === 'function') paymentLinksModel.retireSettled();
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
    if (settledOn && paidDate && (settledOn < paidDate || atArrival(paymentLinksModel, link))) {
      if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, { settledOn }); } catch { /* best effort */ } }
      return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid-after-settled', settledOn, ...effect };
    }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect, effect: 'settled-elsewhere' };
  }
  if (effect.amountMismatch && effect.amountMismatch.balanceCents != null && !effect.amountMismatch.excessCents) {
    if (effect.justConverted) emitPluginEvent('reservation.created', { reservationId: effect.reservationId });
    if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, alertOptions(effect.amountMismatch, !effect.closed)); } catch { /* best effort */ } }
  } else if (effect.amountMismatch) {
    if (effect.justConverted) emitPluginEvent('reservation.created', { reservationId: effect.reservationId });
    if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, alertOptions(effect.amountMismatch, false)); } catch { /* best effort */ } }
    if (effect.conflict && notifyConflict) { try { await notifyConflict(effect.reservationId); } catch { /* best effort */ } }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect };
  }
  if (effect.effect === 'reservation-cancelled' || effect.effect === 'installment-unallocated' || effect.effect === 'installment-double-payment') {
    if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link); } catch { /* best effort */ } }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect };
  }
  // specs/payment-link-lifecycle.md rule 3 — the stay row is gone: the money stays on the link, nothing is
  // booked or confirmed, the admin refunds it.
  if (effect.effect === 'no-reservation') {
    if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, orphanAlert(p, paidAt)); } catch { /* best effort */ } }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect };
  }

  // Devis→reservation conversion is the only paid effect that changes the calendar event set
  // (deposit/balance flags are not event-visible fields).
  if (effect.effect === 'converted' && effect.reservationId) {
    emitPluginEvent('reservation.created', { reservationId: effect.reservationId });
  }

  if (CONFIRMING_TYPES.has(link.type) && CONFIRMING_EFFECTS.has(effect.effect)) {
    const confirmedId = effect.reservationId || link.reservationId;
    if (sendConfirmation && !(quietOnConflict && effect.conflict) && !effect.closed) { try { await sendConfirmation(confirmedId); } catch (e) { /* logged inside the sender */ } }
    // Rule 55 (R10-1) — paid for closed nights: the admin moves or refunds it. A withdrawn link booked late is told by
    // its own caller (bookWithdrawnPaid, bookDatesTakenPaid).
    if (effect.closed && !retiredReason && notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, { nightsUnavailable: 'closed', livePayment: true }); } catch { /* best effort */ } }
    if (effect.conflict && notifyConflict) { try { await notifyConflict(confirmedId); } catch (e) { /* best effort */ } }
  }
  return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...effect };
}

// specs/plugins-phase-3a-online-payment.md rule 8 — the links GuestFlow abandoned but could not
// deactivate. A paid one is never recorded on the stay (it was cancelled or replaced) — except a link
// retired for an amount change, booked at its amount (specs/reservation-payment-ledger.md rule 31): the admin is told,
// the payment's id stays on the row for the refund. Returns the per-link results, and whether a rate
// limit stopped the retries.
// A run for the same scope (all links, or one `only`) is shared; runs of different scopes are chained, never
// concurrent and never answered with another scope's result.
const retryState = new WeakMap();
function retryPendingCancellations(deps) {
  let state = retryState.get(deps.paymentLinksModel);
  if (!state) { state = { tail: Promise.resolve(), running: new Map() }; retryState.set(deps.paymentLinksModel, state); }
  const scope = deps.only == null ? 'all' : String(deps.only);
  if (state.running.has(scope)) return state.running.get(scope);
  const run = state.tail.then(() => retryPendingCancellationsOnce(deps)).finally(() => state.running.delete(scope));
  state.running.set(scope, run);
  state.tail = run.catch(() => {});
  return run;
}

async function retryPendingCancellationsOnce({ only = null, paymentLinksModel, provider, notifyPaidAfterCancel, database, devisModel, recordPayment, checkConflict, notifyConflict, sendConfirmation, emitPluginEvent, logger = console, now = new Date() }) {
  const results = [];
  for (const link of paymentLinksModel.listRemoteCancelPending().filter((l) => only == null || Number(l.id) === Number(only))) {
    if (link.provider !== provider.id || !link.providerLinkId) continue;
    if (link.status === 'expired') {
      const outcome = await deactivateThenRead({ link, provider, paymentLinksModel, now, database, devisModel, sendConfirmation, checkConflict, notifyConflict, notifyPaidAfterCancel, recordPayment, emitPluginEvent });
      results.push(outcome.result);
      if (outcome.rateLimited) return { results, stoppedBy: 'rate-limit' };
      continue;
    }
    try {
      const pay = await provider.getPayment(link.providerLinkId, { origin: 'cancel-link' });
      // specs/payment-link-lifecycle.md rule 3 — checked before every reason's branch: with no stay row
      // there is nothing to settle, book or convert, whatever the link was withdrawn for.
      const orphan = stayIsMissing(database, link);
      if (pay.paid && orphan) {
        const paidAt = pay.paidAt || new Date().toISOString();
        paymentLinksModel.clearRemoteCancelPending(link.id, { providerPaymentId: pay.paymentId || null, paidAt });
        if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, orphanAlert(pay, paidAt)); } catch { /* best effort */ } }
        results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid-after-cancel', effect: 'no-reservation' });
        continue;
      }
      if (pay.paid && link.cancelReason === 'settled') {
        results.push(await settleRetiredPaidLink({ paymentLinksModel, notifyPaidAfterCancel, database, devisModel, recordPayment, link, pay }));
        continue;
      }
      if (pay.paid && link.cancelReason === 'amount-changed' && database) {
        const book = link.type === 'installment' ? bookInstallmentPaidAfterAmountChange : bookAmountChangedPaidLink;
        results.push(await book({ paymentLinksModel, notifyPaidAfterCancel, database, devisModel, recordPayment, checkConflict, notifyConflict, emitPluginEvent, link, pay }));
        continue;
      }
      // specs/payment-link-lifecycle.md rule 42 — a link withdrawn by hand while the provider could not be read,
      // paid before that withdrawal, is the guest's money for the stay: booked as the connected path books it.
      // Re-review of #902 (R1): nights closed since the withdrawal (rule 55) or taken by another stay are booked
      // like rule 33's — the money recorded, no guest confirmation, the admin told to move or refund.
      if (pay.paid && link.cancelReason === LINK_REASONS.OPERATOR && paidBeforeWithdrawal(link, pay)) {
        results.push(await bookWithdrawnPaid({ database, devisModel, paymentLinksModel, link, pay, sendConfirmation, checkConflict, notifyConflict, notifyPaidAfterCancel, recordPayment, emitPluginEvent }));
        continue;
      }
      // specs/payment-link-lifecycle.md rule 33 — a link withdrawn because its dates were taken, paid before its
      // deactivation: the money is the stay's, recorded on the fiche in date conflict, without a confirmation.
      if (pay.paid && link.cancelReason === LINK_REASONS.DATES_TAKEN) {
        results.push(await bookDatesTakenPaid({ database, devisModel, paymentLinksModel, link, pay, checkConflict, notifyConflict, notifyPaidAfterCancel, recordPayment, emitPluginEvent }));
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
      // Rule 5 — the outcome of each orphan withdrawn at the upgrade is logged.
      if (orphan) logger.log(`[payments] orphan link #${link.id} deactivated at ${link.provider}`);
      results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'deactivated' });
    } catch (err) {
      if (await require('./paymentLinkDeactivation').alreadyInactive(provider, link.providerLinkId)) {
        paymentLinksModel.clearRemoteCancelPending(link.id);
        if (stayIsMissing(database, link)) logger.log(`[payments] orphan link #${link.id} already inactive at ${link.provider}`);
        results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'already-inactive' });
        continue;
      }
      results.push({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'deactivation-pending', error: String((err && err.message) || err) });
      if (err && err.code === 'RATE_LIMITED') return { results, stoppedBy: 'rate-limit' };
    }
  }
  return { results, stoppedBy: null };
}

// specs/payment-link-lifecycle.md rules 42 and 56 — a link withdrawn by hand booked as the stay's money (`cancelled →
// paid`): by the poll when paid before its withdrawal, or by the operator's « Enregistrer sur le séjour ». Nights
// closed since (rule 55) or taken by another stay get no guest confirmation and the « déplacer ou rembourser » alert.
async function bookWithdrawnPaid({ database, link, pay, sendConfirmation, notifyPaidAfterCancel, ...effect }) {
  // Final check of #902 (M1) — decided before the booking, on the stay the link answers for (a fiche included).
  const before = unavailableNights(database, link.reservationId, { checkConflict: effect.checkConflict });
  const outcome = await processPaidLink({
    ...effect, database, link, paidPayment: pay, notifyPaidAfterCancel,
    sendConfirmation: before ? null : sendConfirmation, quietOnConflict: true, retiredReason: LINK_REASONS.OPERATOR,
  });
  const unavailable = outcome.effect === 'already-processed' ? null : before || (outcome.conflict ? 'taken' : null);
  if (unavailable && notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, { nightsUnavailable: unavailable }); } catch { /* best effort */ } }
  return outcome;
}

// Rule 33 (decided 2026-10-30, §9 Q5) — `cancelled → paid`, then the effect of a live payment of that link (a devis
// is converted with `allowConflict`, a reservation records the bucket). The stay the link answers for is stamped
// `bookingConflictAt` while another stay still holds its nights; the guest gets no confirmation; the admin is told
// to move the stay or refund it, with the stay that took the dates.
async function bookDatesTakenPaid({ database, link, pay, notifyPaidAfterCancel, notifyConflict, checkConflict, ...effect }) {
  const outcome = await processPaidLink({
    ...effect, database, link, paidPayment: pay, checkConflict, notifyConflict, notifyPaidAfterCancel,
    sendConfirmation: null, quietOnConflict: true, retiredReason: LINK_REASONS.DATES_TAKEN,
  });
  if (outcome.effect === 'already-processed' || outcome.effect === 'reservation-cancelled') return outcome;
  const { answeringStay, heldOverlaps, stayRefs } = require('./datesTaken');
  const found = answeringStay(database, link.reservationId);
  if (!found) return outcome;
  const conflict = Boolean(outcome.conflict) || flagConflictIfAny({ database, checkConflict, reservationId: found.stay.id });
  if (conflict && !outcome.conflict && notifyConflict) { try { await notifyConflict(found.stay.id); } catch { /* best effort */ } }
  const [holder] = heldOverlaps(database, { ...found.stay, excludeIds: [found.row.id, found.stay.id] });
  const [takenBy] = holder ? stayRefs(database, [holder], String(found.stay.startDate || '').slice(0, 4)) : [];
  if (notifyPaidAfterCancel) {
    try { await notifyPaidAfterCancel(link, { nightsUnavailable: 'taken', datesTaken: true, ...(takenBy ? { takenBy: takenBy.label } : {}) }); } catch { /* best effort */ }
  }
  return { ...outcome, datesTaken: true, conflict };
}

// A withdrawal by hand ends the link at its moment (`expiresAt`); a payment with no known date is not before it.
function paidBeforeWithdrawal(link, pay) {
  const paidMs = Date.parse(String((pay && pay.paidAt) || ''));
  const endMs = Date.parse(String(link.expiresAt || ''));
  return paidMs > 0 && endMs > 0 && paidMs <= endMs;
}

const linkResult = (link, extra) => ({ id: link.id, reservationId: link.reservationId, type: link.type, ...extra });
const errorText = (err) => String((err && err.message) || err);

// specs/payment-link-lifecycle.md rule 18 — a LAPSED link is deactivated first and its payment read after,
// so no payment can start after the read: paid → booked like any payment of the stay (rule 14); not paid →
// the deactivation is done and one last look is due in an hour (rule 19). A refused deactivation (other than
// a rate limit) still reads the payment: a provider refuses to deactivate a link already paid, and that
// payment must be booked; unpaid, the marker stays for the next pass.
async function deactivateThenRead({ link, provider, paymentLinksModel, now, ...effect }) {
  let refused = null;
  try {
    await provider.cancelLink(link.providerLinkId);
  } catch (err) {
    // A rate limit is not asked about again (rule 21): the pass stops here.
    if (err && err.code === 'RATE_LIMITED') return { result: linkResult(link, { status: 'deactivation-pending', error: errorText(err) }), rateLimited: true };
    if (!(await require('./paymentLinkDeactivation').alreadyInactive(provider, link.providerLinkId))) refused = err;
  }
  let pay;
  try {
    pay = await provider.getPayment(link.providerLinkId, { origin: 'lapsed-link' });
  } catch (err) {
    return { result: linkResult(link, { status: 'deactivation-pending', error: errorText(refused || err) }), rateLimited: Boolean(err && err.code === 'RATE_LIMITED') };
  }
  if (pay.paid) return { result: await processPaidLink({ ...effect, paymentLinksModel, link, paidPayment: pay }) };
  if (refused) return { result: linkResult(link, { status: 'deactivation-pending', error: errorText(refused) }) };
  paymentLinksModel.clearRemoteCancelPending(link.id);
  paymentLinksModel.setLastLook(link.id, require('./paymentLinkLifecycle').lastLookAfter(now));
  return { result: linkResult(link, { status: 'deactivated' }) };
}

// Rule 19 — the one last read of a lapsed link, for a payment the provider completed after the read of rule
// 18 (a 3-D Secure step in flight at the deactivation). Paid → booked (rule 14); either way, never again.
async function runLastLooks({ database, paymentLinksModel, provider, now, ...effect }) {
  const results = [];
  for (const link of require('./paymentLinkLifecycle').listLastLookDue(database, { now })) {
    if (link.provider !== provider.id || !link.providerLinkId) continue;
    if (!paymentLinksModel.claimLastLook(link.id)) continue;
    try {
      const pay = await provider.getPayment(link.providerLinkId, { origin: 'last-look' });
      if (pay.paid) {
        results.push(await processPaidLink({ ...effect, database, paymentLinksModel, link, paidPayment: pay }));
      } else {
        results.push(linkResult(link, { status: 'expired', effect: 'last-look' }));
      }
    } catch (err) {
      // Not read: the look stays owed, for the next pass.
      paymentLinksModel.setLastLook(link.id, now);
      results.push(linkResult(link, { status: 'error', effect: 'last-look', error: errorText(err) }));
      if (err && err.code === 'RATE_LIMITED') return { results, stoppedBy: 'rate-limit' };
    }
  }
  return { results, stoppedBy: null };
}

// Rule 20 — a lapsed link whose deactivation has kept failing for 24 hours: one notification per link.
async function alertStuckDeactivations({ paymentLinksModel, pending, now, notifyDeactivationStuck, providerLabel }) {
  if (typeof notifyDeactivationStuck !== 'function') return;
  const { parseTimestampMs } = require('../models/paymentLinksModel');
  const { DEACTIVATION_ALERT_AFTER_HOURS } = require('../constants/paymentLinks');
  const limitMs = now.getTime() - DEACTIVATION_ALERT_AFTER_HOURS * 60 * 60 * 1000;
  for (const result of pending.filter((r) => r.status === 'deactivation-pending')) {
    const link = paymentLinksModel.findById(result.id);
    if (!link || link.status !== 'expired' || !link.remoteCancelPendingAt) continue;
    const sinceMs = parseTimestampMs(link.remoteCancelPendingAt);
    if (sinceMs == null || sinceMs > limitMs) continue;
    if (!paymentLinksModel.claimDeactivationAlert(link.id, now)) continue;
    try { await notifyDeactivationStuck(link, { providerLabel }); } catch { /* best effort */ }
  }
}

/**
 * specs/payment-link-lifecycle.md rule 16 — the lifecycle pass: the links whose time is up leave `open` in
 * the database (no provider call), then the provider is asked only about the links that owe something —
 * a deactivation (rule 18, with the existing retries of plugins-phase-3a rule 8) or a last look (rule 19).
 * Run at the start of every poll pass and by the plugin's `payment-link-lifecycle` job. A rate limit stops
 * it; the rest waits for the next run.
 * @returns {Promise<{ moved: object[], results: object[], stoppedBy: string|null }>}
 */
async function runLinkLifecycle({ database, paymentLinksModel, provider, now = new Date(), notifyDeactivationStuck, ...effect }) {
  const moved = require('./paymentLinkLifecycle').retireLapsedAndWithdrawn(database, { now, paymentLinksModel });
  const movedResults = moved
    .filter((link) => !link.providerLinkId)
    .map((link) => linkResult(link, { status: link.status, effect: 'retired-locally', reason: link.cancelReason }));
  const pending = await retryPendingCancellations({ ...effect, database, paymentLinksModel, provider, now });
  await alertStuckDeactivations({ paymentLinksModel, pending: pending.results, now, notifyDeactivationStuck, providerLabel: provider.label || 'le prestataire de paiement' });
  if (pending.stoppedBy) return { moved, results: [...movedResults, ...pending.results], stoppedBy: pending.stoppedBy };
  const looks = await runLastLooks({ ...effect, database, paymentLinksModel, provider, now });
  return { moved, results: [...movedResults, ...pending.results, ...looks.results], stoppedBy: looks.stoppedBy };
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
  if (settledOn && paidDay && (settledOn < paidDay || atArrival(paymentLinksModel, link))) {
    paymentLinksModel.clearRemoteCancelPending(link.id, { providerPaymentId: pay.paymentId || null, paidAt });
    if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, { settledOn }); } catch { /* best effort */ } }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid-after-settled', settledOn };
  }
  paymentLinksModel.markRetiredLinkPaid(link.id, { providerPaymentId: pay.paymentId || null, paidAt });
  if (!database) return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', effect: 'settled-elsewhere' };
  // A full link retired because the acompte was paid, paid anyway: the acompte part is paid twice, the
  // rest is the solde (same as a live second link, see applyPaidEffect).
  const duplicate = fullAfterDeposit(database, link, paidDay);
  if (duplicate && duplicate.mismatch) {
    const booked = bookPaidAfterAmountChange({ database, recordPayment: recordPayment || recordOn(database) }, link, { paidDay });
    if (notifyPaidAfterCancel) { try { await notifyPaidAfterCancel(link, alertOptions(duplicate.mismatch, false)); } catch { /* best effort */ } }
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', ...booked, amountMismatch: duplicate.mismatch };
  }
  if (duplicate && duplicate.sameDay) {
    (recordPayment || recordOn(database))({ reservationId: duplicate.stayId, bucket: 'balance', paidDate: paidDay });
    return { id: link.id, reservationId: link.reservationId, type: link.type, status: 'paid', effect: 'settled-elsewhere' };
  }
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
  const mismatch = target && target.kind === 'reservation' && ['deposit', 'balance', 'full'].includes(String(link.type))
    ? mismatchOf(link, target, database, paidDayOf(paidAt)) : null;
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
    const options = booked.effect === 'no-reservation' ? orphanAlert(pay, paidAt) : (mismatch && !unbooked ? alertOptions(mismatch, false) : {});
    try { await notifyPaidAfterCancel(link, options); } catch { /* best effort */ }
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

// One pass (specs/payment-polling-fair-use.md): the lifecycle pass first (specs/payment-link-lifecycle.md
// rule 16: links whose time is up leave `open` without a provider call, then the owed deactivations and
// last looks), then check only the open links the decaying cadence says are due (`force` = a human asked,
// every open link). A rate limit that survives the client's back-off stops the pass: the links not yet
// examined wait for the next tick instead of being requested into a `429`.
async function runPaymentPoll({ database, paymentLinksModel, provider, devisModel, sendConfirmation, checkConflict, notifyConflict, notifyPaidAfterCancel, notifyDeactivationStuck, recordPayment, force = false, now = new Date() }) {
  // specs/plugins-phase-3a-online-payment.md rule 23 — a link whose bucket was settled another way
  // leaves the polling list and joins the owed deactivations retried just below.
  const settled = typeof paymentLinksModel.retireSettled === 'function' ? paymentLinksModel.retireSettled() : [];
  const lifecycle = await runLinkLifecycle({ database, paymentLinksModel, provider, now, devisModel, sendConfirmation, checkConflict, notifyConflict, notifyPaidAfterCancel, notifyDeactivationStuck, recordPayment });
  const retired = lifecycle.moved.length;
  const results = [
    ...settled.filter((link) => !link.providerLinkId).map((link) => ({ id: link.id, reservationId: link.reservationId, type: link.type, status: 'settled', effect: 'retired-locally' })),
    ...lifecycle.results,
  ];
  if (lifecycle.stoppedBy) return { checked: 0, paid: 0, retired, settled: settled.length, stoppedBy: lifecycle.stoppedBy, results };
  const pollable = paymentLinksModel.listPollable({ now, force }).filter((link) => (link.provider || provider.id) === provider.id);
  let checked = 0;
  let stoppedBy = null;

  for (const polled of pollable) {
    // A payment earlier in this pass may have retired it: the retry of owed deactivations owns it now.
    const link = paymentLinksModel.findById(polled.id);
    if (!link || link.status !== 'open') continue;
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

  return { checked, paid: results.filter((r) => r.status === 'paid').length, retired, settled: settled.length, stoppedBy, results };
}

module.exports = { runPaymentPoll, runLinkLifecycle, processPaidLink, applyPaidEffect, retryPendingCancellations, bookWithdrawnPaid };
