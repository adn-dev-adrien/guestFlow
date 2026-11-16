/**
 * Standalone payments model — `standalone_sale_payments` and their `payment_allocations` (the outside-visit spec §5, rules 19, 41).
 *
 * A payment is one row (its tenders, what it received, the shortfall kept as a reste) and its allocations, written in the caller's
 * transaction: `payment_allocations.paymentRef = 'standalone-payment:<id>'`, and `…:internal` for the part taken in the caisse interne,
 * which the books do not carry (`books = 0`, mixed-method-payments rule 14). The allocation itself — which line a cent covers — is SETTLEMENT's
 * (`allocateDocumentPayment`), never decided here.
 *
 *   record({ saleId, paidAt, tenders, receivedCents, shortfallCents, shortfallKind, source, createdBy, allocations })  → the payment id
 *   paymentsOf(saleId)            the rows with their tenders parsed
 *   allocationsOf(saleId)         the document's `payment_allocations` rows, oldest first
 *   recordRefund({ saleId, obligationId, at, rows })   the money a `lineLowered` row gave back, as refund allocations (negative, `kind = 'refund'`,
 *                                 `refundId` = the row, `paymentRef` `standalone-refund:<row>` and `…:internal` off the books) — loop t1 B-1, rule 49;
 *                                 which line a cent leaves is decided by the caller (`standaloneSale.writeObligationRefund`)
 *   documentsPaidBetween(from, to)  every document with money moved in the window (a payment, a refund, a kept surplus) and what the journal reads
 */
const sales = require('./standaloneSalesModel');
const { localIsoDate } = require('../utils/localDate');

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
    insert.run(row.internal ? `${paymentRef(id)}:internal` : paymentRef(id), documentRef(saleId), row.lineRef || null, row.amountCents, paidAt, row.internal ? 0 : 1);
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

const parse = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return []; } };

function paymentsOf(saleId) {
  return database().prepare('SELECT * FROM standalone_sale_payments WHERE saleId = ? ORDER BY id').all(Number(saleId)).map((row) => ({ ...row, tenders: parse(row.tendersJson) }));
}

function allocationsOf(saleId) {
  return database().prepare('SELECT paymentRef, lineRef, amountCents, kind, books, at, refundId FROM payment_allocations WHERE documentRef = ? ORDER BY id').all(documentRef(saleId));
}

// The local day a row closed on (`settledAt` is SQLite's UTC `datetime('now')`).
const closedDay = (settledAt) => (settledAt ? localIsoDate(new Date(`${String(settledAt).replace(' ', 'T')}Z`)) : null);

/**
 * The documents that moved money between two days (inclusive) — a payment taken, money given back (rule 49), a link surplus kept (rule 50) — each with
 * everything the journal reads: its frozen lines, ALL its payments (the VAT of a day is cut cumulatively) with their allocations, its refunds, its kept
 * surpluses and its client. `[{ sale, lines: [{ ref, vatClass, vatRate }], payments, refunds: [{ lineRef, amountCents, books, at }], kept: [{ id, amountCents, day }], client }]`.
 */
function documentsPaidBetween(from, to) {
  const db = database();
  const kept = sales.keptSurpluses().map((row) => ({ ...row, day: closedDay(row.settledAt) }));
  const ids = [...new Set([
    ...db.prepare('SELECT DISTINCT saleId FROM standalone_sale_payments WHERE paidAt >= ? AND paidAt <= ?').all(from, to).map((row) => row.saleId),
    ...db.prepare(`SELECT DISTINCT CAST(substr(documentRef, 12) AS INTEGER) AS saleId FROM payment_allocations
      WHERE documentRef LIKE 'standalone:%' AND kind = 'refund' AND at >= ? AND at <= ?`).all(from, to).map((row) => row.saleId),
    ...kept.filter((row) => row.day && row.day >= from && row.day <= to).map((row) => row.saleId),
  ])].sort((a, b) => a - b).filter((saleId) => sales.findSale(saleId));
  return ids.map((saleId) => {
    const sale = sales.findSale(saleId);
    const allocations = allocationsOf(saleId);
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
        lineRef: row.lineRef, amountCents: Math.abs(Number(row.amountCents)), books: Number(row.books), at: row.at,
      })),
      kept: kept.filter((row) => row.saleId === saleId && row.day).map((row) => ({ id: row.id, amountCents: Number(row.amountCents), day: row.day })),
      client,
    };
  });
}

module.exports = {
  record, recordRefund, paymentsOf, allocationsOf, paymentRef, documentsPaidBetween,
};
