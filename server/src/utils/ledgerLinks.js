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
 * What a link of `type` would be minted for today on this stored row — the same columns
 * `paymentsController.resolveAmountCents` reads for a reservation.
 */
function linkAmountCents(type, row = {}) {
  switch (String(type)) {
    case 'deposit': return toCents(row.depositAmount);
    case 'balance': return toCents(row.balanceAmount);
    case 'full': return toCents(row.finalPrice);
    case 'complement': return toCents(row.complementAmount);
    default: return null;
  }
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
  for (const link of stale || []) {
    if (!link.providerLinkId || !provider || typeof provider.getPayment !== 'function') continue;
    if (link.provider && provider.id && link.provider !== provider.id) continue;
    let pay = null;
    try {
      pay = await provider.getPayment(link.providerLinkId, { origin: 'amount-changed' });
    } catch {
      pay = null;
    }
    if (pay && pay.paid) return link;
  }
  return null;
}

/**
 * Rule 31 — a link retired because its amount changed was paid anyway. Returns the effect.
 *
 * deps: { database, recordPayment({ reservationId, bucket, paidDate }) }
 */
function bookPaidAfterAmountChange({ database, recordPayment }, link, { paidDay }) {
  const row = database.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(link.reservationId));
  if (!row) return { effect: 'no-reservation' };
  if (String(row.kind) !== 'reservation') return { effect: 'not-a-reservation' };
  const paidAmount = round2(Number(link.amountCents || 0) / 100);
  const type = String(link.type);
  const settled = {
    deposit: Number(row.depositPaid || 0) === 1 || Number(row.depositPaidCash || 0) === 1,
    balance: Number(row.balancePaid || 0) === 1 || Number(row.balancePaidCash || 0) === 1,
    complement: Number(row.complementPaid || 0) === 1 || Number(row.complementPaidCash || 0) === 1,
  };
  const bucket = type === 'full' ? 'balance' : type;
  if (!(bucket in settled)) return { effect: 'noop' };
  // Perceived another way meanwhile: a double payment, refunded by hand (current behaviour).
  if (settled[bucket]) return { effect: 'double-payment' };

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
  database.prepare("UPDATE reservations SET complementPaid = 1, complementPaidDate = ?, updatedAt = datetime('now') WHERE id = ?")
    .run(paidDay, row.id);
  return { effect: 'complement-booked', amount: paidAmount };
}

module.exports = { linkAmountCents, staleLinks, findPaidStaleLink, bookPaidAfterAmountChange };
