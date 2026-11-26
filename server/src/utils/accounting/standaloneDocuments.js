/**
 * The journal read model of the standalone documents (specs/pricing/pricing-components.md §3 rules 63, 74; the outside-visit spec rule 30).
 *
 * `salesOfDocument({ sale, lines, payments, client })` → the sales of one document, one per payment day, in the shape
 * `utils/standaloneSales.js` lists (`{ key, date, totalCents, booksCents, cardCents, label, client, vatRate: null, groups, invoiceNumber }`).
 * What the journal books on a day is the part of the day's payments that SETTLEMENT allocated to the document's lines on the books — the caisse
 * interne is out (`books = 0`), an offered or cancelled line never carries an allocation, and what a payment filed on no line (a surplus owed back)
 * is not revenue. The VAT of a (class, rate) group is the VAT component's, cut on the group's cumulative booked TTC and differenced with what the
 * earlier days booked, so a document paid in pieces books exactly the VAT of its whole. Pure: no DB, no clock.
 *
 * `payments[i]` = `{ id, paidAt, tenders: [{ method, amountCents, internal }], allocations: [{ id, lineRef, amountCents, books }] }` in the order they were taken,
 * `lines[i]` = `{ ref, vatClass, vatRate }`. Loop t5 B5-1 (outside-visit rule 57 a): an allocation's `id` (a refund, kept or transfer row's `seq`) is the
 * order the money was written in, which the VAT is cut in; rows without one keep the days' order.
 *
 * Loop t1 B-1 (outside-visit rule 49): `refunds[i]` = `{ lineRef, amountCents, books, at }` (the money a « Marquer remboursé » gave back, positive) → one
 * avoir per refund day (`role: 'refund'`, key `…:<day>:refund`), its groups the TTC and VAT that leave the books, the VAT cut on the cumulative TTC like a payment's.
 * Loop t1 B-6 (rule 50, owner 2026-11-16): `kept[i]` = `{ id, amountCents, day }` (a link surplus closed « rien à rembourser ») → one tip
 * (`role: 'tip'`, key `…:<day>:tip:<id>`, no group), booked like a stay's tip. A document with neither lists exactly what it listed before.
 * Loop t4 B4-1 (rule 56 a, owner 2026-11-16): `kept[i].rows` = `{ lineRef, amountCents, books, at }` — a `lineLowered` row closed « rien à rembourser » keeps
 * money a line held: those legs leave the line in that day's avoir (its revenue and VAT off the books, like a refund) and the booked part is the tip, so
 * the journal nets per (class, rate) exactly the paid lines the invoice states.
 * Loop t2 B2-3 (rule 52): `transfers[i]` = `{ lineRef, amountCents (signed), books, at }` (money a lowered line held, filed on a line still due) → on its day,
 * the line it leaves in that day's avoir and the line it pays in that day's sale, no money received: the earlier days stay as they were booked.
 */
const { groupVatCents: vatCentsOf } = require('../pricing/vat');

function salesOfDocument({
  sale, lines, payments, refunds = [], transfers = [], kept = [], client,
}) {
  const lineOf = new Map(lines.map((line) => [line.ref, line]));
  // Every movement of money on the lines, with the entry it books in (`day`, `role`) and the order it was written in (`seq`, its first allocation's id).
  const moves = [];
  const move = (day, role, rows) => {
    const groups = new Map();
    for (const row of rows) addTo(groups, lineOf.get(row.lineRef), row);
    const seqs = rows.map((row) => Number(row.seq ?? row.id)).filter(Number.isFinite);
    if (groups.size) moves.push({ day, role, seq: seqs.length ? Math.min(...seqs) : 0, groups });
  };
  const byDay = new Map();
  const dayOf = (at) => {
    const day = byDay.get(at) || { receivedCents: 0, cardCents: 0 };
    byDay.set(at, day);
    return day;
  };
  for (const payment of payments) {
    const day = dayOf(payment.paidAt);
    day.receivedCents += payment.tenders.reduce((sum, tender) => sum + Number(tender.amountCents || 0), 0);
    day.cardCents += payment.tenders.filter((tender) => tender.method === 'card').reduce((sum, tender) => sum + Number(tender.amountCents || 0), 0);
    move(payment.paidAt, 'sale', payment.allocations);
  }
  // Rule 48 — the money given back, per day, on the lines it left (the caisse interne and what no line held stay off the books).
  const refundDays = new Set();
  const leave = (row) => {
    refundDays.add(row.at);
    move(row.at, 'refund', [row]);
  };
  for (const refund of refunds) leave(refund);
  for (const row of kept) for (const leg of row.rows || []) leave(leg);
  for (const row of transfers) {
    if (Number(row.amountCents) < 0) { leave(row); continue; }
    dayOf(row.at);
    move(row.at, 'sale', [row]);
  }
  const invoiceNumber = sale.invoiceNumber && !sale.invoiceCancelledAt ? sale.invoiceNumber : null;
  // The VAT of a group is cut on its cumulative TTC in the order the money was WRITTEN (loop t5 B5-1, the stay's rule 99: a cut is frozen when it is
  // taken): each movement takes the cut its group had left when it was recorded, so a payment recorded today and dated before an earlier payment day
  // books its own day and never re-cuts an entry written before it — a month already exported does not move. Rows with no order (a caller that
  // hands none) keep the days' order.
  const RANK = { sale: 0, refund: 1 };
  const cumulative = new Map();
  const entries = new Map();
  const entryOf = (day, role) => {
    const key = `${day}|${role}`;
    const entry = entries.get(key) || new Map();
    entries.set(key, entry);
    return entry;
  };
  const ordered = [...moves].sort((a, b) => a.seq - b.seq || String(a.day).localeCompare(String(b.day)) || RANK[a.role] - RANK[b.role]);
  for (const { day, role, groups } of ordered) {
    const sign = role === 'refund' ? -1 : 1;
    const entry = entryOf(day, role);
    for (const [key, group] of groups) {
      const before = cumulative.get(key) || { ttcCents: 0, vatCents: 0 };
      const ttcCents = before.ttcCents + sign * group.ttcCents;
      const vatCents = vatCentsOf(ttcCents, group.rate);
      cumulative.set(key, { ttcCents, vatCents });
      const booked = entry.get(key) || {
        vatClass: group.vatClass, rate: group.rate, ttcCents: 0, vatCents: 0,
      };
      booked.ttcCents += group.ttcCents;
      booked.vatCents += sign * (vatCents - before.vatCents);
      entry.set(key, booked);
    }
  }
  const groupsOf = (day, role) => [...(entries.get(`${day}|${role}`) || new Map()).values()]
    .sort((a, b) => a.rate - b.rate || String(a.vatClass).localeCompare(String(b.vatClass)));
  const out = [];
  for (const day of [...new Set([...byDay.keys(), ...refundDays])].sort()) {
    const data = byDay.get(day);
    if (data) {
      const groups = groupsOf(day, 'sale');
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
    // Loop t3 B3-1, B3-2 (rule 55) — money that leaves no line (a link surplus given back, or filed on a line) puts nothing in the day's avoir.
    const groups = groupsOf(day, 'refund');
    if (groups.length) {
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
  for (const row of kept.filter((r) => Number(r.amountCents) > 0)) {
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
