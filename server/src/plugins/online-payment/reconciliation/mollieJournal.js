/**
 * What the accounting export books of Mollie (specs/mollie-rolling-reserve-and-incoming-payments.md rules 28-31).
 * Plain facts — the export owns the accounts and the journal code:
 *   - `link`   a paid link, on its payment day: the client settles, Mollie owes the gross;
 *   - `credit` a reconciled Mollie credit, on its bank day: Mollie paid (part of) what it owed;
 *   - `cost`   the costs of the credit's settlement, when Mollie reports them.
 * The balance of what Mollie still owes at a date is exactly what the three kinds leave. A credit not reconciled yet is
 * listed apart and books nothing: an allocation is never guessed into the books (rule 31).
 */

const { day } = require('./dates');
const { settlementReferenceOf } = require('./mollieSettlements');

const inWindow = (date, from, to) => Boolean(date) && date >= from && date <= to;

const clientOf = (brief) => {
  const lastName = brief.lastName || '';
  const whole = brief.clientName || '';
  return { firstName: whole.endsWith(lastName) ? whole.slice(0, whole.length - lastName.length).trim() : whole, lastName };
};

/**
 * @param {object} data        the reconciliation controller's computed pass
 * @param {{ from: string, to: string }} window  the month exported; `to` is also the date of the clearing balance
 * @param {Map<string, object>} settlements  Mollie settlements by reference
 */
function mollieJournal(data, { from, to }, settlements = new Map()) {
  const mollieItems = data.items.filter((i) => i.mollie);
  const linkOnce = new Map();
  mollieItems.forEach((i) => { if (!linkOnce.has(i.mollie.paymentLinkId)) linkOnce.set(i.mollie.paymentLinkId, i); });
  const links = [...linkOnce.values()].map((i) => ({
    kind: 'link', date: i.paidDate, amountCents: i.mollie.paymentGrossCents, reservationId: i.reservation.id,
    client: clientOf(i.reservation), libelle: i.reservation.clientName, ledgerKey: i.mollie.baseKey,
  }));

  const mollieByKey = new Set(mollieItems.map((i) => i.key));
  const perCredit = new Map();
  data.linesByReceipt.forEach((lines, key) => {
    if (!mollieByKey.has(key)) return;
    lines.forEach((l) => {
      const entry = perCredit.get(l.transactionId) || { cents: 0, perReservation: new Map() };
      entry.cents += l.amountCents;
      entry.perReservation.set(l.reservationId, (entry.perReservation.get(l.reservationId) || 0) + l.amountCents);
      perCredit.set(l.transactionId, entry);
    });
  });

  const credits = [];
  const costs = [];
  perCredit.forEach((booked, transactionId) => {
    const tx = data.txById.get(transactionId);
    if (!tx) return;
    const reference = settlementReferenceOf(tx);
    const base = { date: day(tx.settledAt), settlementReference: reference, qontoReference: tx.qontoReference || String(tx.id) };
    credits.push({ kind: 'credit', ...base, amountCents: booked.cents, perReservation: booked.perReservation, libelle: 'VERSEMENT MOLLIE' });
    const settlement = reference ? settlements.get(reference) : null;
    if (settlement && Number(settlement.costsCents) > 0) costs.push({ kind: 'cost', ...base, amountCents: Number(settlement.costsCents), libelle: 'FRAIS MOLLIE' });
  });

  const unattached = data.credits
    .filter((c) => c.kind === 'mollie' && c.status !== 'outside' && c.remainingCents > 0 && inWindow(c.date, from, to))
    .map((c) => ({
      date: c.date, amountCents: c.remainingCents, qontoReference: c.refs.qonto, settlementReference: c.refs.mollieSettlement, counterparty: c.counterparty,
    }));

  const upTo = (list) => list.filter((e) => e.date && e.date <= to);
  const balanceCents = upTo(links).reduce((t, e) => t + e.amountCents, 0)
    - upTo(credits).reduce((t, e) => t + e.amountCents, 0) - upTo(costs).reduce((t, e) => t + e.amountCents, 0);
  const heldBy = new Map();
  upTo(links).forEach((e) => {
    const held = heldBy.get(e.reservationId) || { clientName: e.libelle, balanceCents: 0 };
    held.balanceCents += e.amountCents;
    heldBy.set(e.reservationId, held);
  });
  upTo(credits).forEach((e) => e.perReservation.forEach((cents, reservationId) => {
    if (heldBy.has(reservationId)) heldBy.get(reservationId).balanceCents -= cents;
  }));
  const clients = [...heldBy.entries()].filter(([, v]) => v.balanceCents !== 0)
    .map(([reservationId, v]) => ({ reservationId, clientName: v.clientName, balanceCents: v.balanceCents }))
    .sort((a, b) => b.balanceCents - a.balanceCents);

  return {
    entries: [...links, ...credits, ...costs].filter((e) => inWindow(e.date, from, to))
      .map(({ perReservation, ...entry }) => entry)
      .sort((a, b) => a.date.localeCompare(b.date)),
    unattached,
    clearing: { asOf: to, balanceCents, clients },
  };
}

module.exports = { mollieJournal };
