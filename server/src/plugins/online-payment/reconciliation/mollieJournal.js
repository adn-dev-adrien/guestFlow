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
const { settlementReferenceOf, normalizeReference } = require('./mollieSettlements');

const inWindow = (date, from, to) => Boolean(date) && date >= from && date <= to;

const holderOf = (reservationId, saleKey) => (saleKey ? `sale:${saleKey}` : reservationId);

const clientOf = (brief, anonymous = false) => {
  if (anonymous) return { firstName: '', lastName: '' };
  const lastName = brief.lastName || '';
  const whole = brief.clientName || '';
  return { firstName: whole.endsWith(lastName) ? whole.slice(0, whole.length - lastName.length).trim() : whole, lastName };
};

/** A settlement's costs split between the payments GuestFlow knows and the others, pro rata of the immediate shares they paid. */
function splitCosts(settlement, costsCents) {
  const rows = (settlement.payments || []).filter((p) => p.kind !== 'release');
  const total = rows.reduce((t, p) => t + Number(p.amountCents || 0), 0);
  const knownTotal = rows.filter((p) => p.splitId).reduce((t, p) => t + Number(p.amountCents || 0), 0);
  if (rows.length === 0 || total <= 0) return { known: costsCents, unknown: 0 };
  const known = Math.round((costsCents * knownTotal) / total);
  return { known, unknown: costsCents - known };
}

/** Spreads `total` cents over the holders of a credit, pro rata of what each received; the rounding rest goes to the largest. */
function spreadOver(total, perHolder) {
  const whole = [...perHolder.values()].reduce((t, c) => t + c, 0);
  const out = new Map();
  if (total <= 0 || whole <= 0) return out;
  let given = 0;
  let largest = null;
  perHolder.forEach((cents, holder) => {
    const part = Math.floor((total * cents) / whole);
    out.set(holder, part);
    given += part;
    if (largest === null || cents > perHolder.get(largest)) largest = holder;
  });
  out.set(largest, out.get(largest) + total - given);
  return out;
}

/**
 * @param {object} data        the reconciliation controller's computed pass
 * @param {{ from: string, to: string }} window  the month exported; `to` is also the date of the clearing balance
 * @param {Map<string, object>} settlements  Mollie settlements by reference
 */
function mollieJournal(data, { from, to }, settlements = new Map()) {
  const mollieItems = data.items.filter((i) => i.mollie);
  const linkOnce = new Map();
  mollieItems.forEach((i) => { if (!linkOnce.has(i.mollie.splitId)) linkOnce.set(i.mollie.splitId, i); });
  // A payment taken on site (rule 1, second half) books like a link: the client settles, Mollie owes the gross — less what
  // Mollie refunded of it (rule 6), which it never pays. A sale outside a stay has no stay: its holder is the sale
  // (`holderOf`), its client the one named on the sale, if any. The day is the Paris day of the payment (`day`).
  const links = [...linkOnce.values()].map((i) => ({
    kind: 'link', date: i.paidDate, amountCents: Math.max(0, i.mollie.paymentGrossCents - (i.mollie.refundedCents || 0)),
    reservationId: i.reservation.id, saleKey: i.reservation.saleKey || null,
    client: clientOf(i.reservation, i.reservation.hasClient === false), libelle: i.reservation.clientName, ledgerKey: i.mollie.baseKey,
  })).filter((e) => e.amountCents > 0);

  const mollieByKey = new Set(mollieItems.map((i) => i.key));
  const saleOf = new Map(mollieItems.map((i) => [i.key, i.reservation.saleKey || null]));
  const expectedOf = new Map(mollieItems.map((i) => [i.key, i.expectedCents]));
  const perCredit = new Map();
  data.linesByReceipt.forEach((lines, key) => {
    if (!mollieByKey.has(key)) return;
    const received = lines.reduce((t, l) => t + l.amountCents, 0);
    lines.forEach((l, index) => {
      const entry = perCredit.get(l.transactionId) || { cents: 0, perReservation: new Map(), shortCents: 0, shortPerHolder: new Map() };
      entry.cents += l.amountCents;
      const holder = holderOf(l.reservationId, saleOf.get(`${l.reservationId}|${l.ledgerKey}`));
      entry.perReservation.set(holder, (entry.perReservation.get(holder) || 0) + l.amountCents);
      // Rule 5 — a tranche confirmed short of its amount (the estimated fees, no token to read them) leaves that gap
      // at Mollie for good: it is the fee, booked with the credit that closed the tranche.
      if (index === lines.length - 1) {
        const short = Math.max(0, expectedOf.get(key) - received);
        entry.shortCents += short;
        if (short > 0) entry.shortPerHolder.set(holder, (entry.shortPerHolder.get(holder) || 0) + short);
      }
      perCredit.set(l.transactionId, entry);
    });
  });

  const credits = [];
  const costs = [];
  const unattachedCosts = [];
  perCredit.forEach((booked, transactionId) => {
    const tx = data.txById.get(transactionId);
    if (!tx) return;
    const reference = settlementReferenceOf(tx);
    const base = { date: day(tx.settledAt), settlementReference: reference, qontoReference: tx.qontoReference || String(tx.id) };
    credits.push({ kind: 'credit', ...base, amountCents: booked.cents, perReservation: booked.perReservation, libelle: 'VERSEMENT MOLLIE' });
    const settlement = reference ? settlements.get(normalizeReference(reference)) : null;
    const settlementCosts = settlement ? Number(settlement.costsCents) : 0;
    if (settlementCosts > 0) {
      // Rule 5 — the settlement's costs belong to the payments GuestFlow knows; what the unknown payments bore is
      // shown apart, never booked on a client.
      const { known, unknown } = splitCosts(settlement, settlementCosts);
      if (known > 0) costs.push({ kind: 'cost', ...base, amountCents: known, perReservation: spreadOver(known, booked.perReservation), libelle: 'FRAIS MOLLIE' });
      if (unknown > 0) unattachedCosts.push({ date: base.date, amountCents: unknown, qontoReference: base.qontoReference, settlementReference: reference, counterparty: 'Mollie (frais)', kind: 'cost' });
    } else if (booked.shortCents > 0) {
      costs.push({ kind: 'cost', ...base, amountCents: booked.shortCents, perReservation: booked.shortPerHolder, libelle: 'FRAIS MOLLIE ESTIMÉS' });
    }
  });

  const unattached = data.credits
    .filter((c) => c.kind === 'mollie' && c.status !== 'outside' && c.remainingCents > 0 && inWindow(c.date, from, to))
    .map((c) => ({
      date: c.date, amountCents: c.remainingCents, qontoReference: c.refs.qonto, settlementReference: c.refs.mollieSettlement, counterparty: c.counterparty, kind: 'credit',
    }))
    .concat(unattachedCosts.filter((u) => inWindow(u.date, from, to)));

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
  // Fees leave the clearing too (rule 5): a holder's balance is what Mollie owes of his payments, credits and fees taken off.
  upTo([...credits, ...costs]).forEach((e) => (e.perReservation || new Map()).forEach((cents, holder) => {
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
