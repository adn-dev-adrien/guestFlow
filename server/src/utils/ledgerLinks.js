/**
 * Payment links whose amount the fiche changes (specs/reservation-payment-ledger.md §3.5, rules 29-31;
 * UI/UX review 2026-10-18, §9 Q3 decided 2026-10-19: retire, offer « Renvoyer la demande », book a late
 * payment of the old link at its real amount).
 *
 *   - `staleLinks(openLinks, row)`: the open links whose `amountCents` no longer matches what the row
 *     now asks for (rule 29);
 *   - `findPaidStaleLink(stale, provider)`: the first of them the guest has paid meanwhile — the save is
 *     then refused (rule 30). A provider that cannot answer refuses nothing: the link is retired
 *     locally and the poll checks it later (rule 29);
 *   - `bookPaidAfterAmountChange(...)`: the poll found a link retired for `'amount-changed'` paid —
 *     the money is real and lands on the fiche at the link's amount (rule 31).
 *
 * Every dependency is injected; nothing here talks to the network on its own.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toCents = (n) => Math.round(round2(n) * 100);
const fmt = (n) => require('./reservationLedger').formatEuros(n);

/**
 * What a link of `type` would be minted for today on this stored row (or engine quote) — the figures
 * `paymentsController.resolveAmountCents` reads. A `full` link charges what its payment records: the
 * acompte plus the solde, i.e. the pre-arrival amount, tourist tax included and the arrival complement
 * excluded (specs/deposit-blocks-the-dates.md rule 18, decided 2026-10-27).
 */
function linkAmountCents(type, row = {}) {
  switch (String(type)) {
    case 'deposit': return toCents(row.depositAmount);
    case 'balance': return toCents(row.balanceAmount);
    case 'full': return toCents(Number(row.depositAmount || 0) + Number(row.balanceAmount || 0));
    case 'complement': return toCents(row.complementAmount);
    default: return null;
  }
}

/**
 * Rule 45 (and plugins-phase-3a rule 42) — a `full` link paid while the stay's acompte is already ticked:
 * is that tick the link's own money? True when the acompte was ticked on the day of the payment or later,
 * not at the door, with no other paid acompte or full link behind it and the solde still open — the
 * operator saw the money arrive and ticked it before the webhook did. `stay` is a reservation row.
 */
function acompteIsLinkMoney(database, link, stay, paidDay) {
  if (!paidDay || !stay || String(link.type) !== 'full') return false;
  if (Number(stay.depositPaid || 0) !== 1 || Number(stay.balancePaid || 0) === 1 || !(Number(stay.depositAmount || 0) > 0)) return false;
  if (!stay.depositPaidDate || String(stay.depositPaidDate).slice(0, 10) < paidDay || Number(stay.depositPaidAtArrival || 0) === 1) return false;
  const owners = require('./deletionGuard').withConvertedDevis(database, [Number(stay.id), Number(link.reservationId)]);
  return !database.prepare(
    `SELECT 1 FROM payment_links WHERE reservationId IN (${owners.map(() => '?').join(',')}) AND type IN ('deposit', 'full') AND status = 'paid' AND id <> ? LIMIT 1`,
  ).get(...owners, Number(link.id));
}

/** Rule 29 — the open links whose amount differs from the row's amount in cents. */
function staleLinks(openLinks, row) {
  return (openLinks || []).filter((link) => {
    if (!link || link.status !== 'open') return false;
    const now = linkAmountCents(link.type, row);
    return now != null && Number(link.amountCents) !== now;
  });
}

/**
 * Rule 30 — the first stale link the guest has paid. `provider` may be null (plugin off): nothing can
 * be checked, nothing is refused; the poll will meet the payment, if any (rule 31).
 */
async function findPaidStaleLink(stale, provider) {
  return (await inspectStaleLinks(stale, provider)).paid;
}

/**
 * Like `findPaidStaleLink`, and says which links the provider could not answer for: those are neither
 * known paid nor known unpaid, so a caller about to deactivate them must keep them and retry later.
 */
async function inspectStaleLinks(stale, provider) {
  const unreadable = [];
  for (const link of stale || []) {
    if (!link.providerLinkId || !provider || typeof provider.getPayment !== 'function') continue;
    if (link.provider && provider.id && link.provider !== provider.id) continue;
    let pay = null;
    try {
      pay = await provider.getPayment(link.providerLinkId, { origin: 'amount-changed' });
    } catch {
      unreadable.push(link);
      continue;
    }
    if (pay && pay.paid) return { paid: link, unreadable };
  }
  return { paid: null, unreadable };
}

/**
 * Rule 31 — a link retired because its amount changed was paid anyway. Returns the effect.
 *
 * deps: { database, recordPayment({ reservationId, bucket, paidDate }), reservationsModel? } —
 * `reservationsModel` defaults to the model bound to `database`.
 */
function bookPaidAfterAmountChange({ database, recordPayment, reservationsModel = null }, link, { paidDay }) {
  let row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(link.reservationId));
  if (!row) return { effect: 'no-reservation' };
  // A link minted on a devis that was then converted is paid on the reservation it became
  // (specs/vat-optional-mode.md rule 34).
  if (String(row.kind) === 'devis' && row.convertedReservationId) {
    row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(row.convertedReservationId)) || row;
  }
  if (String(row.kind) !== 'reservation') return { effect: 'not-a-reservation' };
  const paidAmount = round2(Number(link.amountCents || 0) / 100);
  const type = String(link.type);
  const settled = {
    deposit: Number(row.depositPaid || 0) === 1 || Number(row.depositPaidCash || 0) === 1,
    balance: Number(row.balancePaid || 0) === 1 || Number(row.balancePaidCash || 0) === 1,
    complement: Number(row.complementPaid || 0) === 1 || Number(row.complementPaidCash || 0) === 1,
  };
  let bucket = type === 'full' ? 'balance' : type;
  if (!(bucket in settled)) return { effect: 'noop' };
  // Perceived another way meanwhile: a double payment, refunded by hand (current behaviour).
  if (settled[bucket]) return { effect: 'double-payment' };

  // The stay grew an acompte after a `full` link was minted (moved out of the last-minute window): the
  // single payment covers the acompte first. Not even the acompte → it is booked as an acompte.
  // An acompte ticked the day the link was paid is the link's own money (rule 45): it is booked like an unsettled one.
  const depositIsLinkMoney = type === 'full' && settled.deposit && acompteIsLinkMoney(database, link, row, paidDay);
  const fullOverDeposit = type === 'full' && (!settled.deposit || depositIsLinkMoney) && Number(row.depositDisabled || 0) !== 1
    && round2(row.depositAmount) > 0;
  if (fullOverDeposit && paidAmount <= round2(row.depositAmount)) bucket = 'deposit';
  else if (fullOverDeposit) {
    // The solde gets the rest and both are recorded — the acompte is never claimed a second time.
    // Short of the pre-arrival total, the rest is owed as the arrival complement; above it, the excess
    // is the trop-perçu (specs/reservation-refunds.md rule 34).
    const depositBefore = round2(row.depositAmount);
    const balanceBefore = round2(row.balanceAmount);
    const deposit = depositBefore;
    const balance = round2(paidAmount - deposit);
    const shortfall = round2(depositBefore + balanceBefore - paidAmount);
    const complementOpen = Number(row.complementPaid || 0) !== 1 && Number(row.complementPaidCash || 0) !== 1;
    database.transaction(() => {
      database.prepare(`UPDATE reservations SET depositAmountOverride = ?, depositAmount = ?, balanceAmount = ?,
        updatedAt = datetime('now') WHERE id = ?`)
        .run(deposit, deposit, balance, row.id);
      const changes = [
        { field: 'ledgerDepositAmount', label: 'Acompte', from: fmt(depositBefore), to: `${fmt(deposit)} (payé par un lien retiré)` },
        { field: 'ledgerBalanceAmount', label: 'Solde', from: fmt(balanceBefore), to: `${fmt(balance)} (payé par un lien retiré)` },
      ];
      if (shortfall > 0 && complementOpen) {
        const complementBefore = round2(row.complementAmount);
        database.prepare("UPDATE reservations SET complementAmount = ?, updatedAt = datetime('now') WHERE id = ?")
          .run(round2(complementBefore + shortfall), row.id);
        changes.push({ field: 'complementAmount', label: "Complément d'arrivée", from: fmt(complementBefore), to: `${fmt(complementBefore + shortfall)} (reste dû après le lien retiré)` });
      }
      database.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'update', ?)")
        .run(row.id, JSON.stringify(changes));
      recordPayment({ reservationId: row.id, bucket: 'full', paidDate: paidDay });
    })();
    return { effect: 'full-booked', amount: paidAmount, shortfall: shortfall > 0 ? shortfall : 0, excess: shortfall < 0 ? -shortfall : 0 };
  }

  if (bucket === 'deposit') {
    // The acompte is the link's amount; the solde absorbs the difference (pre-arrival unchanged).
    const preArrival = round2(Number(row.depositAmount || 0) + Number(row.balanceAmount || 0));
    database.transaction(() => {
      database.prepare(`UPDATE reservations SET depositAmountOverride = ?, depositAmount = ?, balanceAmount = ?,
        updatedAt = datetime('now') WHERE id = ?`)
        .run(paidAmount, paidAmount, round2(Math.max(0, preArrival - paidAmount)), row.id);
      database.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'update', ?)")
        .run(row.id, JSON.stringify([{ field: 'ledgerDepositAmount', label: 'Acompte', from: fmt(row.depositAmount), to: `${fmt(paidAmount)} (payé par un lien retiré)` }]));
      recordPayment({ reservationId: row.id, bucket: 'deposit', paidDate: paidDay });
    })();
    return { effect: 'deposit-booked', amount: paidAmount };
  }
  if (bucket === 'balance') {
    // The solde is what the guest paid. Short of the new solde, the rest is owed as the arrival
    // complement (the engine keeps a paid solde of a stay without acompte, pricing rule 36, and routes
    // the gap there); above it, the excess is the trop-perçu of specs/reservation-refunds.md rule 34.
    // One transaction: the amounts, the payment and the history land together or not at all.
    const before = round2(row.balanceAmount);
    const shortfall = round2(before - paidAmount);
    const complementOpen = Number(row.complementPaid || 0) !== 1 && Number(row.complementPaidCash || 0) !== 1;
    database.transaction(() => {
      database.prepare("UPDATE reservations SET balanceAmount = ?, updatedAt = datetime('now') WHERE id = ?").run(paidAmount, row.id);
      const changes = [{ field: 'ledgerBalanceAmount', label: 'Solde', from: fmt(before), to: `${fmt(paidAmount)} (payé par un lien retiré)` }];
      if (shortfall > 0 && complementOpen) {
        const complementBefore = round2(row.complementAmount);
        database.prepare("UPDATE reservations SET complementAmount = ?, updatedAt = datetime('now') WHERE id = ?")
          .run(round2(complementBefore + shortfall), row.id);
        changes.push({ field: 'complementAmount', label: "Complément d'arrivée", from: fmt(complementBefore), to: `${fmt(complementBefore + shortfall)} (reste dû après le lien retiré)` });
      }
      database.prepare("INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'update', ?)")
        .run(row.id, JSON.stringify(changes));
      recordPayment({ reservationId: row.id, bucket: 'balance', paidDate: paidDay });
    })();
    return { effect: 'balance-booked', amount: paidAmount, shortfall: shortfall > 0 ? shortfall : 0, excess: shortfall < 0 ? -shortfall : 0 };
  }
  // The complement keeps its amount: the ledger row warns « Payé X par un lien retiré, Y attendus ».
  // Recorded the way the fiche's « Marquer perçu » records it (reservationsController.updatePayment):
  // same resolver, the single-payment group released, the arrival extras baseline pinned — and traced.
  const { depsFor, paidDayOf } = require('./stayPaymentRecorder');
  const { resolveComplementPayment } = require('./complementPayment');
  const model = reservationsModel || depsFor(database).reservationsModel;
  const { paid, cash, date } = resolveComplementPayment({
    paidInput: true, dateInput: paidDay,
    prevPaid: row.complementPaid, prevCash: row.complementPaidCash, prevDate: row.complementPaidDate,
    today: paidDayOf(new Date().toISOString()),
  });
  database.transaction(() => {
    database.prepare("UPDATE reservations SET complementPaid = ?, complementPaidDate = ?, complementPaidCash = ?, updatedAt = datetime('now') WHERE id = ?")
      .run(paid, date, cash, row.id);
    model.releaseComplementBucket(row.id);
    model.captureArrivalExtrasBaseline(row.id);
    model.addHistoryEntry(row.id, 'update', [{
      field: 'complementPaid', label: "Complément d'arrivée", from: `${fmt(row.complementAmount)} à percevoir`,
      to: `${fmt(paidAmount)} perçus (payé par un lien retiré)`,
    }]);
  })();
  return { effect: 'complement-booked', amount: paidAmount };
}

module.exports = { linkAmountCents, acompteIsLinkMoney, staleLinks, findPaidStaleLink, inspectStaleLinks, bookPaidAfterAmountChange };
