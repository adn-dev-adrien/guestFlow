/**
 * The journal read model of the standalone documents (specs/pricing-components.md §3 rules 63, 74; the outside-visit spec rule 30).
 *
 * `salesOfDocument({ sale, lines, payments, client })` → the sales of one document, one per payment day, in the shape
 * `utils/standaloneSales.js` lists (`{ key, date, totalCents, booksCents, cardCents, label, client, vatRate: null, groups, invoiceNumber }`).
 * What the journal books on a day is the part of the day's payments that SETTLEMENT allocated to the document's lines on the books — the caisse
 * interne is out (`books = 0`), an offered or cancelled line never carries an allocation, and what a payment filed on no line (a surplus owed back)
 * is not revenue. The VAT of a (class, rate) group is the VAT component's, cut on the group's cumulative booked TTC and differenced with what the
 * earlier days booked, so a document paid in pieces books exactly the VAT of its whole. Pure: no DB, no clock.
 *
 * `payments[i]` = `{ id, paidAt, tenders: [{ method, amountCents, internal }], allocations: [{ lineRef, amountCents, books }] }` in the order they were taken,
 * `lines[i]` = `{ ref, vatClass, vatRate }`.
 *
 * Loop t1 B-1 (outside-visit rule 49): `refunds[i]` = `{ lineRef, amountCents, books, at }` (the money a « Marquer remboursé » gave back, positive) → one
 * avoir per refund day (`role: 'refund'`, key `…:<day>:refund`), its groups the TTC and VAT that leave the books, the VAT cut on the cumulative TTC like a payment's.
 * Loop t1 B-6 (rule 50, owner 2026-11-16): `kept[i]` = `{ id, amountCents, day }` (a link surplus closed « rien à rembourser ») → one tip
 * (`role: 'tip'`, key `…:<day>:tip:<id>`, no group), booked like a stay's tip. A document with neither lists exactly what it listed before.
 */
const { vatOf } = require('../pricing/vat');

const vatCentsOf = (ttcCents, rate) => (ttcCents > 0
  ? vatOf([{ amountCents: ttcCents, vatClass: 'external', customerContext: 'external' }], { regime: null, settings: { get: () => rate } }).totals.vatCents
  : 0);

function salesOfDocument({
  sale, lines, payments, refunds = [], kept = [], client,
}) {
  const lineOf = new Map(lines.map((line) => [line.ref, line]));
  const cumulative = new Map();
  const byDay = new Map();
  for (const payment of [...payments].sort((a, b) => String(a.paidAt).localeCompare(String(b.paidAt)) || a.id - b.id)) {
    const day = byDay.get(payment.paidAt) || {
      groups: new Map(), receivedCents: 0, cardCents: 0,
    };
    byDay.set(payment.paidAt, day);
    day.receivedCents += payment.tenders.reduce((sum, tender) => sum + Number(tender.amountCents || 0), 0);
    day.cardCents += payment.tenders.filter((tender) => tender.method === 'card').reduce((sum, tender) => sum + Number(tender.amountCents || 0), 0);
    for (const allocation of payment.allocations) addTo(day.groups, lineOf.get(allocation.lineRef), allocation);
  }
  // Rule 48 — the money given back, per day, on the lines it left (the caisse interne and what no line held stay off the books).
  const refundDays = new Map();
  for (const refund of refunds) {
    const groups = refundDays.get(refund.at) || new Map();
    refundDays.set(refund.at, groups);
    addTo(groups, lineOf.get(refund.lineRef), refund);
  }
  const invoiceNumber = sale.invoiceNumber && !sale.invoiceCancelledAt ? sale.invoiceNumber : null;
  // The VAT of a group is cut on its cumulative TTC, oldest day first and, on one day, the payments before the money given back.
  const cut = (groups, sign) => {
    const out = [];
    for (const [key, group] of groups) {
      const before = cumulative.get(key) || { ttcCents: 0, vatCents: 0 };
      const ttcCents = before.ttcCents + sign * group.ttcCents;
      const vatCents = vatCentsOf(ttcCents, group.rate);
      out.push({ vatClass: group.vatClass, rate: group.rate, ttcCents: group.ttcCents, vatCents: sign * (vatCents - before.vatCents) });
      cumulative.set(key, { ttcCents, vatCents });
    }
    return out.sort((a, b) => a.rate - b.rate || String(a.vatClass).localeCompare(String(b.vatClass)));
  };
  const out = [];
  for (const day of [...new Set([...byDay.keys(), ...refundDays.keys()])].sort()) {
    const data = byDay.get(day);
    if (data) {
      const groups = cut(data.groups, 1);
      out.push({
        key: `standalone:${sale.id}:${day}`,
        date: day,
        totalCents: data.receivedCents,
        booksCents: groups.reduce((sum, group) => sum + group.ttcCents, 0),
        cardCents: data.cardCents,
        label: 'Vente hors séjour',
        client,
        vatRate: null,
        groups,
        invoiceNumber,
      });
    }
    if (refundDays.has(day)) {
      const groups = cut(refundDays.get(day), -1);
      out.push({
        key: `standalone:${sale.id}:${day}:refund`,
        date: day,
        totalCents: 0,
        booksCents: groups.reduce((sum, group) => sum + group.ttcCents, 0),
        cardCents: 0,
        label: 'Remboursement vente hors séjour',
        client,
        vatRate: null,
        groups,
        invoiceNumber,
        role: 'refund',
      });
    }
  }
  // Rule 49 (owner 2026-11-16) — a link surplus kept is a tip, on the day it was kept: no line, no VAT.
  for (const row of kept) {
    out.push({
      key: `standalone:${sale.id}:${row.day}:tip:${row.id}`,
      date: row.day,
      totalCents: 0,
      booksCents: Number(row.amountCents),
      cardCents: 0,
      label: 'Pourboire vente hors séjour',
      client,
      vatRate: null,
      invoiceNumber: null,
      role: 'tip',
    });
  }
  return out;
}

// What an allocation (or a refund) puts on the books for its line's (class, rate) group; the caisse interne and money on no line put nothing.
function addTo(groups, line, allocation) {
  if (!line || !Number(allocation.books)) return;
  const key = `${line.vatClass}|${line.vatRate}`;
  const group = groups.get(key) || { vatClass: line.vatClass, rate: Number(line.vatRate || 0), ttcCents: 0 };
  group.ttcCents += Math.abs(Number(allocation.amountCents));
  groups.set(key, group);
}

module.exports = { salesOfDocument };
