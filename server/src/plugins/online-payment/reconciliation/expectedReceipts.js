/**
 * What GuestFlow expects to find on the bank account (specs/qonto-bank-reconciliation.md rules 2, 8–10).
 *
 * One receipt per ledger row that moves money through the bank, read from the core's own payments ledger
 * (`buildLedger`): the plugin re-implements no amount. Cash and caisse-interne rows never reach the bank
 * and are left out; a « paiement unique » is one receipt for its total.
 */

const flag = (v) => Number(v || 0) === 1 || v === true;
const sdk = require('../../sdk');
const { toCentsOrZero: cents } = sdk.coreModule('money');
const { day } = require('./dates');

// Rule 46 — what a platform that took an acompte already paid out for it (PLATFORM PAYMENT's `acompteNet`).
const { acompteNet: platformAcompteNet, grossOf } = sdk.coreModule('platformPayment');

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
 * specs/plugins-phase-1-sdk.md rule 47 (guest-app rule 35) — a paid link billing a plugin's own basket (a guest
 * order) lands on the account like any link payment: its whole amount, whatever part is flagged « à rembourser »
 * (that money leaves later, as a refund). On a platform stay as on a direct one: the guest paid GuestFlow, not
 * the platform.
 */
function basketReceipts(row, links, brief, platform) {
  return links.filter((l) => l.status === 'paid' && l.basketJson && Number(l.amountCents) > 0).map((l) => ({
    reservationId: row.id, ledgerKey: `basket-${l.id}`, label: `Paiement en ligne (lien ${l.id})`,
    channel: 'link', platform,
    expectedCents: Number(l.amountCents), grossCents: Number(l.amountCents), payoutRecorded: true,
    expectedDate: day(l.paidAt), dueDate: day(l.paidAt), paid: true, paidDate: day(l.paidAt),
    linkPaidAt: day(l.paidAt),
    reservation: brief,
  }));
}

/**
 * @param {object} row                 the stored reservation row joined with its client and property
 * @param {object} deps
 * @param {Function} deps.buildLedger  the core's ledger
 * @param {Function} deps.parseGroup   the core's single-payment parser
 * @param {object[]} deps.links        the reservation's payment links
 * @param {object[]} [deps.installments] the reservation's installments (specs/direct-installments.md rule 38)
 * @param {object[]} [deps.settlements] the reservation's split payments (specs/mixed-method-payments.md rule 28)
 * @param {Function} [deps.settlementFigures] the core's reading of one settlement
 * @param {string} deps.today
 * @returns {object[]} receipts
 */
function receiptsOfReservation(row, { buildLedger, parseGroup, links, installments = [], settlements = [], settlementFigures = null, today }) {
  const ledger = buildLedger({ row, links, today });
  const brief = reservationBrief(row);
  const platform = String(row.platform || 'direct');
  const isPlatform = platform.trim().toLowerCase() !== 'direct';
  const out = [];
  const isPaid = (r) => String(r.state).startsWith('paid');
  const baskets = basketReceipts(row, links, brief, platform);

  if (isPlatform) {
    const balance = ledger.rows.find((r) => r.key === 'balance');
    if (!balance) return baskets;
    const paid = isPaid(balance);
    const grossRaw = grossOf(row);
    const payout = row.platformPayoutAmount != null && row.platformPayoutAmount !== '' && Number(row.platformPayoutAmount) > 0
      ? Number(row.platformPayoutAmount) : null;
    if (!(grossRaw > 0) && payout == null) return baskets;
    // Rule 46 — the solde credit of a platform that took an acompte carries the solde only.
    const acompteNet = platformAcompteNet(row);
    // Rule 31 of the reconciliation spec — what the platform kept as a penalty never reaches the account.
    const penalties = Math.max(0, Number(row.platformPenaltyAmount || 0));
    const soldeGross = acompteNet > 0 ? Math.max(0, grossRaw - Number(row.depositAmount || 0)) : grossRaw;
    out.push({
      reservationId: row.id, ledgerKey: 'balance', label: balance.label, channel: `platform:${platform}`, platform,
      expectedCents: payout != null ? cents(Math.max(0, payout - acompteNet - penalties)) : cents(soldeGross),
      grossCents: cents(soldeGross),
      payoutRecorded: payout != null,
      expectedDate: paid ? day(row.balancePaidDate) : day(row.balanceDueDate),
      dueDate: day(row.balanceDueDate),
      paid, paidDate: paid ? day(row.balancePaidDate) : null,
      reservation: brief,
    });
    return [...out, ...baskets];
  }

  // specs/mixed-method-payments.md rule 28 — a payment split over several methods is expected settlement by
  // settlement, for its card, cheque and transfer lines only; what it paid is not expected a second time.
  const splitKinds = new Set(settlements.flatMap((s) => (s.parts || []).map((p) => p.kind)));
  const splitInstallments = new Set(settlements.filter((s) => s.targetKind === 'installment').map((s) => String(s.targetKey)));
  const splitGroup = settlements.some((s) => s.targetKind === 'arrivalGroup');
  const group = parseGroup(row.arrivalPaymentGroup);
  if (group && !group.cash && !splitGroup) {
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
    if (paid && splitInstallments.has(String(i.id))) return;
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
    if (splitKinds.has(r.key === 'checkoutComplement' ? 'complement' : r.key) && isPaid(r)) return;
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
  settlements.forEach((s) => {
    const bankCents = settlementFigures ? settlementFigures(s).bankCents : 0;
    if (!(bankCents > 0)) return;
    out.push({
      reservationId: row.id, ledgerKey: `settlement-${s.id}`, label: 'Paiement réparti (CB, chèque, virement)',
      channel: 'direct', platform,
      expectedCents: bankCents, grossCents: bankCents, payoutRecorded: true,
      expectedDate: day(s.paidDate), dueDate: day(s.paidDate), paid: true, paidDate: day(s.paidDate),
      linkPaidAt: null,
      reservation: brief,
    });
  });
  return [...out, ...baskets];
}

// The stay's split payments, read through the core's model (specs/mixed-method-payments.md rule 28).
function settlementsReader(db) {
  const model = sdk.coreModule('paymentSettlementsModel').buildModel(db);
  const { settlementFigures } = sdk.coreModule('paymentTenders');
  return { settlementsOf: (reservationId) => model.listFor(reservationId), settlementFigures };
}

const RESERVATION_SQL = `
  SELECT r.*, c.firstName AS firstName, c.lastName AS lastName, p.name AS propertyName
  FROM reservations r
  LEFT JOIN clients c ON c.id = r.clientId
  LEFT JOIN properties p ON p.id = r.propertyId
  WHERE COALESCE(r.kind, 'reservation') = 'reservation' AND r.cancelledAt IS NULL AND r.endDate >= ?`;

// The plan's rows, read through the core's installments model (a core table): a read failure is a real
// error and surfaces, never an empty plan that would silently expect nothing (audit 2026-10-27).
function installmentsReader(db, listInstallments) {
  if (typeof listInstallments === 'function') return listInstallments;
  const model = require('../../sdk').coreModule('installmentsModel').buildModel(db);
  return (reservationId) => model.listFor(reservationId);
}

/** Rule 2 — every in-scope reservation with its receipts. */
function expectedReceipts({ db, startDate, today, buildLedger, parseGroup, listLinks, listInstallments }) {
  const rows = db.prepare(`${RESERVATION_SQL} ORDER BY r.endDate, r.id`).all(startDate);
  const installmentsOf = installmentsReader(db, listInstallments);
  const { settlementsOf, settlementFigures } = settlementsReader(db);
  const receipts = [];
  rows.forEach((row) => {
    receiptsOfReservation(row, { buildLedger, parseGroup, links: listLinks(row.id), installments: installmentsOf(row.id), settlements: settlementsOf(row.id), settlementFigures, today })
      .forEach((rc) => receipts.push(rc));
  });
  return receipts;
}

/** The receipts of one reservation, scope included (the fiche's block). */
function expectedReceiptsOfReservation({ db, reservationId, startDate, today, buildLedger, parseGroup, listLinks, listInstallments }) {
  const row = db.prepare(`${RESERVATION_SQL} AND r.id = ?`).get(startDate, Number(reservationId));
  if (!row) return null;
  const installmentsOf = installmentsReader(db, listInstallments);
  const { settlementsOf, settlementFigures } = settlementsReader(db);
  return receiptsOfReservation(row, { buildLedger, parseGroup, links: listLinks(row.id), installments: installmentsOf(row.id), settlements: settlementsOf(row.id), settlementFigures, today });
}

module.exports = { expectedReceipts, expectedReceiptsOfReservation, receiptsOfReservation, reservationBrief, platformAcompteNet };
