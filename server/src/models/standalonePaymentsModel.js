/**
 * Standalone payments model — `standalone_sale_payments` and their `payment_allocations` (specs/outside-booking-sas.md §5, rules 19, 41).
 *
 * A payment is one row (its tenders, what it received, the shortfall kept as a reste) and its allocations, written in the caller's
 * transaction: `payment_allocations.paymentRef = 'standalone-payment:<id>'`, and `…:internal` for the part taken in the caisse interne,
 * which the books do not carry (`books = 0`, mixed-method-payments rule 14). The allocation itself — which line a cent covers — is SETTLEMENT's
 * (`allocateDocumentPayment`), never decided here.
 *
 *   record({ saleId, paidAt, tenders, receivedCents, shortfallCents, shortfallKind, source, createdBy, allocations })  → the payment id
 *   paymentsOf(saleId)            the rows with their tenders parsed
 *   allocationsOf(saleId)         the document's `payment_allocations` rows, oldest first
 *   writeRefund(...)              not here: a refund is executed through the refund path (rule 25)
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
    insert.run(row.internal ? `${paymentRef(id)}:internal` : paymentRef(id), documentRef(saleId), row.lineRef || null, row.amountCents, paidAt, row.internal ? 0 : 1);
  }
  return id;
}

const parse = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return []; } };

function paymentsOf(saleId) {
  return database().prepare('SELECT * FROM standalone_sale_payments WHERE saleId = ? ORDER BY id').all(Number(saleId)).map((row) => ({ ...row, tenders: parse(row.tendersJson) }));
}

function allocationsOf(saleId) {
  return database().prepare('SELECT paymentRef, lineRef, amountCents, kind, books, at FROM payment_allocations WHERE documentRef = ? ORDER BY id').all(documentRef(saleId));
}

/**
 * The documents that took a payment between two days (inclusive), each with everything the journal reads: its frozen lines, ALL its payments (the
 * VAT of a day is cut cumulatively) with their allocations, and its client. `[{ sale, lines: [{ ref, vatClass, vatRate }], payments, client }]`.
 */
function documentsPaidBetween(from, to) {
  const db = database();
  const ids = db.prepare('SELECT DISTINCT saleId FROM standalone_sale_payments WHERE paidAt >= ? AND paidAt <= ? ORDER BY saleId').all(from, to).map((row) => row.saleId);
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
      client,
    };
  });
}

module.exports = {
  record, paymentsOf, allocationsOf, paymentRef, documentsPaidBetween,
};
