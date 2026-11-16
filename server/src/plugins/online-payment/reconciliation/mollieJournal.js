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

const holderOf = (reservationId, saleKey) => (saleKey ? `sale:${saleKey}` : reservationId);

const clientOf = (brief, anonymous = false) => {
  if (anonymous) return { firstName: '', lastName: '' };
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
  mollieItems.forEach((i) => { if (!linkOnce.has(i.mollie.splitId)) linkOnce.set(i.mollie.splitId, i); });
  // A payment taken on site (rule 1, second half) books like a link: the client settles, Mollie owes the gross. A sale
  // outside a stay has no stay: its holder is the sale (`holderOf`), its client the one named on the sale, if any.
  const links = [...linkOnce.values()].map((i) => ({
    kind: 'link', date: i.paidDate, amountCents: i.mollie.paymentGrossCents, reservationId: i.reservation.id, saleKey: i.reservation.saleKey || null,
    client: clientOf(i.reservation, i.reservation.hasClient === false), libelle: i.reservation.clientName, ledgerKey: i.mollie.baseKey,
  }));

  const mollieByKey = new Set(mollieItems.map((i) => i.key));
  const saleOf = new Map(mollieItems.map((i) => [i.key, i.reservation.saleKey || null]));
  const perCredit = new Map();
  data.linesByReceipt.forEach((lines, key) => {
    if (!mollieByKey.has(key)) return;
    lines.forEach((l) => {
      const entry = perCredit.get(l.transactionId) || { cents: 0, perReservation: new Map() };
      entry.cents += l.amountCents;
      const holder = holderOf(l.reservationId, saleOf.get(`${l.reservationId}|${l.ledgerKey}`));
      entry.perReservation.set(holder, (entry.perReservation.get(holder) || 0) + l.amountCents);
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
    const holder = holderOf(e.reservationId, e.saleKey);
    const held = heldBy.get(holder) || { clientName: e.libelle, reservationId: e.reservationId, saleKey: e.saleKey, balanceCents: 0 };
    held.balanceCents += e.amountCents;
    heldBy.set(holder, held);
  });
  upTo(credits).forEach((e) => e.perReservation.forEach((cents, holder) => {
    if (heldBy.has(holder)) heldBy.get(holder).balanceCents -= cents;
  }));
  const clients = [...heldBy.values()].filter((v) => v.balanceCents !== 0)
    .map((v) => ({ reservationId: v.reservationId, saleKey: v.saleKey, clientName: v.clientName, balanceCents: v.balanceCents }))
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
