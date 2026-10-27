/**
 * What GuestFlow expects to find on the bank account (specs/qonto-bank-reconciliation.md rules 2, 8–10).
 *
 * One receipt per ledger row that moves money through the bank, read from the core's own payments ledger
 * (`buildLedger`): the plugin re-implements no amount. Cash and caisse-interne rows never reach the bank
 * and are left out; a « paiement unique » is one receipt for its total.
 */

const flag = (v) => Number(v || 0) === 1 || v === true;
const cents = (n) => Math.round((Number(n) || 0) * 100);
const { day } = require('./dates');

// The ledger rows of the direct buckets, with the stored column of their cash flag and their date.
const DIRECT_ROWS = {
  deposit: { cash: 'depositPaidCash', dueDate: 'depositDueDate', paidDate: 'depositPaidDate' },
  balance: { cash: 'balancePaidCash', dueDate: 'balanceDueDate', paidDate: 'balancePaidDate' },
  complement: { cash: 'complementPaidCash', dueDate: null, paidDate: 'complementPaidDate' },
  checkoutComplement: { cash: 'complementPaidCash', dueDate: null, paidDate: 'complementPaidDate' },
  endOfStayComplement: { cash: 'endOfStayComplementPaidCash', dueDate: null, paidDate: 'endOfStayComplementPaidDate' },
};

const reservationBrief = (row) => ({
  id: row.id,
  clientName: [row.firstName, row.lastName].filter(Boolean).join(' ').trim(),
  lastName: row.lastName || '',
  propertyName: row.propertyName || '',
  startDate: day(row.startDate),
  endDate: day(row.endDate),
  platform: row.platform || 'direct',
  reservationNumber: row.reservationNumber ? String(row.reservationNumber) : '',
  createdAt: day(row.createdAt),
});

/**
 * @param {object} row                 the stored reservation row joined with its client and property
 * @param {object} deps
 * @param {Function} deps.buildLedger  the core's ledger
 * @param {Function} deps.parseGroup   the core's single-payment parser
 * @param {object[]} deps.links        the reservation's payment links
 * @param {object[]} [deps.installments] the reservation's installments (specs/direct-installments.md rule 38)
 * @param {string} deps.today
 * @returns {object[]} receipts
 */
function receiptsOfReservation(row, { buildLedger, parseGroup, links, installments = [], today }) {
  const ledger = buildLedger({ row, links, today });
  const brief = reservationBrief(row);
  const platform = String(row.platform || 'direct');
  const isPlatform = platform.trim().toLowerCase() !== 'direct';
  const out = [];
  const isPaid = (r) => String(r.state).startsWith('paid');

  if (isPlatform) {
    const balance = ledger.rows.find((r) => r.key === 'balance');
    if (!balance) return out;
    const paid = isPaid(balance);
    const grossRaw = row.platformGrossAmount != null && row.platformGrossAmount !== ''
      ? Number(row.platformGrossAmount) : Number(row.depositAmount || 0) + Number(row.balanceAmount || 0);
    const payout = row.platformPayoutAmount != null && row.platformPayoutAmount !== '' && Number(row.platformPayoutAmount) > 0
      ? Number(row.platformPayoutAmount) : null;
    if (!(grossRaw > 0) && payout == null) return out;
    out.push({
      reservationId: row.id, ledgerKey: 'balance', label: balance.label, channel: `platform:${platform}`, platform,
      expectedCents: payout != null ? cents(payout) : cents(grossRaw),
      grossCents: cents(grossRaw),
      payoutRecorded: payout != null,
      expectedDate: paid ? day(row.balancePaidDate) : day(row.balanceDueDate),
      dueDate: day(row.balanceDueDate),
      paid, paidDate: paid ? day(row.balancePaidDate) : null,
      reservation: brief,
    });
    return out;
  }

  const group = parseGroup(row.arrivalPaymentGroup);
  if (group && !group.cash) {
    out.push({
      reservationId: row.id, ledgerKey: 'group', label: 'Paiement unique', channel: 'direct', platform,
      expectedCents: cents(group.total), grossCents: cents(group.total), payoutRecorded: true,
      expectedDate: group.at, dueDate: group.at, paid: true, paidDate: group.at, reservation: brief,
    });
  }
  // An installment of a plan is a receipt of its own — the plan replaced the acompte and the solde rows.
  // What the plan no longer owes (the stay is covered) expects nothing; paid in espèces never reaches the bank.
  const owed = !(Number(row.installmentsTarget || 0) > 0 && Number(row.installmentsPaidAmount || 0) >= Number(row.installmentsTarget));
  installments.forEach((i) => {
    const paid = Number(i.paid) === 1;
    if (!paid && !owed) return;
    if (paid && ['cash', 'internal'].includes(String(i.paidMethod))) return;
    const paidLink = links.find((l) => l.status === 'paid' && l.type === 'installment' && Number(l.installmentId) === Number(i.id));
    out.push({
      reservationId: row.id, ledgerKey: `installment-${i.number}`, installmentId: i.id,
      label: `Échéance ${i.number}/${installments.length}`,
      channel: paidLink ? 'link' : 'direct', platform,
      expectedCents: Number(i.amountCents), grossCents: Number(i.amountCents), payoutRecorded: true,
      expectedDate: paid ? day(i.paidDate) : day(i.dueDate),
      dueDate: day(i.dueDate), paid, paidDate: paid ? day(i.paidDate) : null,
      linkPaidAt: paidLink ? day(paidLink.paidAt) : null,
      reservation: brief,
    });
  });
  ledger.rows.forEach((r) => {
    const meta = DIRECT_ROWS[r.key];
    if (!meta) return;
    if (r.state === 'na' || r.state === 'none' || r.state === 'paid-group') return;
    if (flag(row[meta.cash])) return;
    const paid = isPaid(r);
    if (!(Number(r.amount) > 0)) return;
    const link = r.detail && r.detail.link && r.detail.link.status === 'paid' ? r.detail.link : null;
    const paidLink = link ? links.find((l) => l.status === 'paid' && ['deposit', 'balance', 'full', 'complement'].includes(String(l.type))
      && ((r.key === 'balance' && ['balance', 'full'].includes(String(l.type))) || String(l.type) === r.key)) : null;
    const due = meta.dueDate ? day(row[meta.dueDate]) : null;
    out.push({
      reservationId: row.id, ledgerKey: r.key, label: r.label,
      channel: paidLink ? 'link' : 'direct', platform,
      expectedCents: cents(r.amount), grossCents: cents(r.amount), payoutRecorded: true,
      expectedDate: paid ? day(row[meta.paidDate]) : due,
      dueDate: due, paid, paidDate: paid ? day(row[meta.paidDate]) : null,
      linkPaidAt: paidLink ? day(paidLink.paidAt) : null,
      reservation: brief,
    });
  });
  return out;
}

const RESERVATION_SQL = `
  SELECT r.*, c.firstName AS firstName, c.lastName AS lastName, p.name AS propertyName
  FROM reservations r
  LEFT JOIN clients c ON c.id = r.clientId
  LEFT JOIN properties p ON p.id = r.propertyId
  WHERE COALESCE(r.kind, 'reservation') = 'reservation' AND r.cancelledAt IS NULL AND r.endDate >= ?`;

// The plan's rows, read like the reservation: a core table. A database without it has no plan.
function installmentsOf(db, reservationId) {
  try {
    return db.prepare('SELECT id, number, dueDate, amountCents, paid, paidDate, paidMethod FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(Number(reservationId));
  } catch { return []; }
}

/** Rule 2 — every in-scope reservation with its receipts. */
function expectedReceipts({ db, startDate, today, buildLedger, parseGroup, listLinks }) {
  const rows = db.prepare(`${RESERVATION_SQL} ORDER BY r.endDate, r.id`).all(startDate);
  const receipts = [];
  rows.forEach((row) => {
    receiptsOfReservation(row, { buildLedger, parseGroup, links: listLinks(row.id), installments: installmentsOf(db, row.id), today })
      .forEach((rc) => receipts.push(rc));
  });
  return receipts;
}

/** The receipts of one reservation, scope included (the fiche's block). */
function expectedReceiptsOfReservation({ db, reservationId, startDate, today, buildLedger, parseGroup, listLinks }) {
  const row = db.prepare(`${RESERVATION_SQL} AND r.id = ?`).get(startDate, Number(reservationId));
  if (!row) return null;
  return receiptsOfReservation(row, { buildLedger, parseGroup, links: listLinks(row.id), installments: installmentsOf(db, row.id), today });
}

module.exports = { expectedReceipts, expectedReceiptsOfReservation, receiptsOfReservation, reservationBrief };
