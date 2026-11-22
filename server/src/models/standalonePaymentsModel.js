/**
 * Standalone payments model — `standalone_sale_payments` and their `payment_allocations` (the outside-visit spec §5, rules 19, 41).
 *
 * A payment is one row (its tenders, what it received, the shortfall kept as a reste) and its allocations, written in the caller's
 * transaction: `payment_allocations.paymentRef = 'standalone-payment:<id>'`, and `…:internal` for the part taken in the caisse interne,
 * which the books do not carry (`books = 0`, mixed-method-payments rule 14). The allocation itself — which line a cent covers — is SETTLEMENT's
 * (`allocateDocumentPayment`), never decided here.
 *
 *   record({ saleId, paidAt, tenders, receivedCents, shortfallCents, shortfallKind, source, createdBy, allocations })  → the payment id; an allocation is `internal` (caisse
 *                                 interne) or `prepaid` (money a plugin's instrument already collected, SDK 2.33.0): both are off the books (`books = 0`), told apart by their ref suffix
 *   paymentsOf(saleId)            the rows with their tenders parsed
 *   allocationsOf(saleId)         the document's `payment_allocations` rows, oldest first
 *   recordRefund({ saleId, obligationId, at, rows })   the money a `lineLowered` row gave back, as refund allocations (negative, `kind = 'refund'`,
 *                                 `refundId` = the row, `paymentRef` `standalone-refund:<row>` and `…:internal` off the books) — loop t1 B-1, rule 49;
 *                                 which line a cent leaves is decided by the caller (`standaloneSale.writeObligationRefund`)
 *   recordKept({ saleId, obligationId, at, rows })   an open row closed « rien à rembourser », kept as a tip (rules 50, 55, 56, loop t3 B3-2, t4 B4-1): negative
 *                                 `payment` allocations on the rows the caller picked (`rowsLeaving`: no line for a link surplus, the lowered line first for a
 *                                 `lineLowered` row), `paymentRef` `standalone-kept:<row>` (`…:internal` off the books), `refundId` = the row — the money leaves
 *                                 the document (SETTLEMENT's `paidCents` falls); the journal books the line's part as an avoir and the booked part as a tip
 *   recordTransfer({ saleId, at, rows })   money a lowered line held moved onto a line still due (loop t2 B2-3, outside-visit rule 52): signed `payment`
 *                                 allocations under one `standalone-transfer:<sale>:<n>` ref (`…:internal` off the books), dated the day of the change; which
 *                                 line gives and which takes is SETTLEMENT's (`refileDocumentExcess`)
 *   documentsPaidBetween(from, to)  every document with money moved in the window (a payment, a refund, a transfer, a kept surplus) and what the journal reads
 */
const sales = require('./standaloneSalesModel');

const { documentRef } = sales;

const database = () => require('../database');

const paymentRef = (id) => `standalone-payment:${Number(id)}`;

function record({
  saleId, paidAt, tenders, receivedCents, shortfallCents = 0, shortfallKind = null, source = null, createdBy = null, allocations,
}) {
  const db = database();
  const info = db.prepare(`INSERT INTO standalone_sale_payments (saleId, paidAt, tendersJson, receivedCents, shortfallCents, shortfallKind, source, recordedAt, createdBy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(Number(saleId), paidAt, JSON.stringify(tenders || []), receivedCents, shortfallCents, shortfallKind, source, new Date().toISOString(), createdBy);
  const id = Number(info.lastInsertRowid);
  const insert = db.prepare(`INSERT INTO payment_allocations (paymentRef, documentRef, lineRef, amountCents, kind, at, books, origin)
    VALUES (?, ?, ?, ?, 'payment', ?, ?, 'live')`);
  for (const row of allocations) {
    const off = row.prepaid ? ':prepaid' : (row.internal ? ':internal' : '');
    insert.run(`${paymentRef(id)}${off}`, documentRef(saleId), row.lineRef || null, row.amountCents, paidAt, off ? 0 : 1);
  }
  return id;
}

const refundRef = (obligationId) => `standalone-refund:${Number(obligationId)}`;

function recordRefund({ saleId, obligationId, at, rows }) {
  const insert = database().prepare(`INSERT INTO payment_allocations (paymentRef, documentRef, lineRef, amountCents, kind, at, refundId, books, origin)
    VALUES (?, ?, ?, ?, 'refund', ?, ?, ?, 'live')`);
  for (const row of rows) {
    if (!(row.amountCents > 0)) continue;
    insert.run(row.internal ? `${refundRef(obligationId)}:internal` : refundRef(obligationId), documentRef(saleId), row.lineRef || null, -row.amountCents, at, Number(obligationId), row.internal ? 0 : 1);
  }
}

const KEPT = 'standalone-kept:';

function recordKept({
  saleId, obligationId, at, rows,
}) {
  const insert = database().prepare(`INSERT INTO payment_allocations (paymentRef, documentRef, lineRef, amountCents, kind, at, refundId, books, origin)
    VALUES (?, ?, ?, ?, 'payment', ?, ?, ?, 'live')`);
  for (const row of rows) {
    if (!(row.amountCents > 0)) continue;
    insert.run(`${KEPT}${Number(obligationId)}${row.internal ? ':internal' : ''}`, documentRef(saleId), row.lineRef || null, -row.amountCents, at, Number(obligationId), row.internal ? 0 : 1);
  }
}

const TRANSFER = 'standalone-transfer:';

function recordTransfer({ saleId, at, rows }) {
  const db = database();
  const ref = `${TRANSFER}${Number(saleId)}:${Number(db.prepare(`SELECT COUNT(DISTINCT REPLACE(paymentRef, ':internal', '')) AS n FROM payment_allocations
    WHERE documentRef = ? AND paymentRef LIKE '${TRANSFER}%'`).get(documentRef(saleId)).n) + 1}`;
  const insert = db.prepare(`INSERT INTO payment_allocations (paymentRef, documentRef, lineRef, amountCents, kind, at, books, origin)
    VALUES (?, ?, ?, ?, 'payment', ?, ?, 'live')`);
  for (const row of rows) {
    if (!row.amountCents) continue;
    insert.run(Number(row.books) ? ref : `${ref}:internal`, documentRef(saleId), row.lineRef, row.amountCents, at, Number(row.books) ? 1 : 0);
  }
}

const parse = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return []; } };

function paymentsOf(saleId) {
  return database().prepare('SELECT * FROM standalone_sale_payments WHERE saleId = ? ORDER BY id').all(Number(saleId)).map((row) => ({ ...row, tenders: parse(row.tendersJson) }));
}

function allocationsOf(saleId) {
  return database().prepare('SELECT paymentRef, lineRef, amountCents, kind, books, at, refundId FROM payment_allocations WHERE documentRef = ? ORDER BY id').all(documentRef(saleId));
}

// Loop t4 B4-1 (rule 56 a) — the money kept from a closed row, read from its kept allocations: `[{ id, amountCents (booked, the tip), day, rows }]`,
// `rows` its legs on a line (`{ lineRef, amountCents, books, at }`, positive) — the avoir of that day.
function keptOf(allocations) {
  const byRow = new Map();
  for (const row of allocations.filter((r) => String(r.paymentRef || '').startsWith(KEPT))) {
    const kept = byRow.get(row.refundId) || {
      id: Number(row.refundId), amountCents: 0, day: row.at, rows: [],
    };
    byRow.set(row.refundId, kept);
    if (Number(row.books) === 1) kept.amountCents += Math.abs(Number(row.amountCents));
    if (row.lineRef != null) {
      kept.rows.push({
        lineRef: row.lineRef, amountCents: Math.abs(Number(row.amountCents)), books: Number(row.books), at: row.at, seq: row.id,
      });
    }
  }
  return [...byRow.values()];
}

/**
 * The documents that moved money between two days (inclusive) — a payment taken, money given back (rule 49), a link surplus kept (rule 50) — each with
 * everything the journal reads: its frozen lines, ALL its payments (the VAT of a day is cut cumulatively) with their allocations, its refunds, its kept
 * surpluses and its client. `[{ sale, lines: [{ ref, vatClass, vatRate }], payments, refunds: [{ lineRef, amountCents, books, at }], transfers: [{ lineRef, amountCents (signed),
 * books, at }], kept: [{ id, amountCents, day, rows }], client }]`.
 */
function documentsPaidBetween(from, to) {
  const db = database();
  const ids = [...new Set([
    ...db.prepare('SELECT DISTINCT saleId FROM standalone_sale_payments WHERE paidAt >= ? AND paidAt <= ?').all(from, to).map((row) => row.saleId),
    ...db.prepare(`SELECT DISTINCT CAST(substr(documentRef, 12) AS INTEGER) AS saleId FROM payment_allocations
      WHERE documentRef LIKE 'standalone:%' AND (kind = 'refund' OR paymentRef LIKE '${TRANSFER}%' OR paymentRef LIKE '${KEPT}%') AND at >= ? AND at <= ?`).all(from, to).map((row) => row.saleId),
  ])].sort((a, b) => a - b).filter((saleId) => sales.findSale(saleId));
  return ids.map((saleId) => {
    const sale = sales.findSale(saleId);
    // Loop t5 B5-1 — with each row's id: the order the money was written in, which the journal cuts the VAT in.
    const allocations = database().prepare('SELECT id, paymentRef, lineRef, amountCents, kind, books, at, refundId FROM payment_allocations WHERE documentRef = ? ORDER BY id')
      .all(documentRef(saleId));
    const payments = paymentsOf(saleId).map((payment) => ({
      id: payment.id,
      paidAt: payment.paidAt,
      tenders: payment.tenders,
      allocations: allocations.filter((row) => row.paymentRef === paymentRef(payment.id) || row.paymentRef === `${paymentRef(payment.id)}:internal`),
    }));
    const client = sale.clientId ? sales.clientById(sale.clientId) : null;
    return {
      sale,
      lines: sales.linesOf(saleId).map((line) => ({ ref: sales.lineRef(line.id), vatClass: line.vatClass, vatRate: Number(line.vatRate || 0) })),
      payments,
      refunds: allocations.filter((row) => row.kind === 'refund').map((row) => ({
        lineRef: row.lineRef, amountCents: Math.abs(Number(row.amountCents)), books: Number(row.books), at: row.at, seq: row.id,
      })),
      transfers: allocations.filter((row) => String(row.paymentRef || '').startsWith(TRANSFER)).map((row) => ({
        lineRef: row.lineRef, amountCents: Number(row.amountCents), books: Number(row.books), at: row.at, seq: row.id,
      })),
      kept: keptOf(allocations),
      client,
    };
  });
}

module.exports = {
  record, recordRefund, recordKept, recordTransfer, paymentsOf, allocationsOf, paymentRef, documentsPaidBetween,
};
