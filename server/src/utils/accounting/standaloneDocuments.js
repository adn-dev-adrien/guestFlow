/**
 * The journal read model of the standalone documents (specs/pricing-components.md §3 rules 63, 74; specs/outside-booking-sas.md rule 30).
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
 */
const { vatOf } = require('../pricing/vat');

const vatCentsOf = (ttcCents, rate) => (ttcCents > 0
  ? vatOf([{ amountCents: ttcCents, vatClass: 'external', customerContext: 'external' }], { regime: null, settings: { get: () => rate } }).totals.vatCents
  : 0);

function salesOfDocument({
  sale, lines, payments, client,
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
    for (const allocation of payment.allocations) {
      const line = lineOf.get(allocation.lineRef);
      if (!line || !allocation.books) continue;
      const key = `${line.vatClass}|${line.vatRate}`;
      const group = day.groups.get(key) || { vatClass: line.vatClass, rate: Number(line.vatRate || 0), ttcCents: 0 };
      group.ttcCents += allocation.amountCents;
      day.groups.set(key, group);
    }
  }
  const sales = [];
  for (const [day, data] of byDay) {
    const groups = [];
    for (const [key, group] of data.groups) {
      const before = cumulative.get(key) || { ttcCents: 0, vatCents: 0 };
      const ttcCents = before.ttcCents + group.ttcCents;
      const vatCents = vatCentsOf(ttcCents, group.rate);
      groups.push({ vatClass: group.vatClass, rate: group.rate, ttcCents: group.ttcCents, vatCents: vatCents - before.vatCents });
      cumulative.set(key, { ttcCents, vatCents });
    }
    const booksCents = groups.reduce((sum, group) => sum + group.ttcCents, 0);
    sales.push({
      key: `standalone:${sale.id}:${day}`,
      date: day,
      totalCents: data.receivedCents,
      booksCents,
      cardCents: data.cardCents,
      label: 'Vente hors séjour',
      client,
      vatRate: null,
      groups: groups.sort((a, b) => a.rate - b.rate || String(a.vatClass).localeCompare(String(b.vatClass))),
      invoiceNumber: sale.invoiceNumber && !sale.invoiceCancelledAt ? sale.invoiceNumber : null,
    });
  }
  return sales;
}

module.exports = { salesOfDocument };
