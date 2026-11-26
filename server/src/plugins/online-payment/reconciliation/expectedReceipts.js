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
const {
  afterRefund, expectedDates, trancheKey, splitIdOf, reservePercentOf, immediatePercentOf, LATE_AFTER_DAYS, saleLinkLedgerKey,
} = require('./molliePaymentSplits');
const { settlementLedgerRow } = require('./mollieCardSources');

// Rule 46 — what a platform that took an acompte already paid out for it (PLATFORM PAYMENT's `acompteNet`).
const { acompteNet: platformAcompteNet, grossOf, taxPaidWithPayout } = sdk.coreModule('platformPayment');
const platformsModel = sdk.coreModule('platformsModel');

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

const TRANCHE_WORDS = { immediat: 'versement immédiat', retenue: 'retenue Mollie' };

/**
 * specs/mollie-rolling-reserve-and-incoming-payments.md rules 7-8 — a paid link is two expected receipts, its immediate
 * share and its reserve, keyed `<ledgerKey>#immediat` and `<ledgerKey>#retenue`. A refund (rule 6) cuts the immediate
 * share first; a tranche left at 0 expects nothing. The guest still owes one échéance: the receipts are the bank's side.
 */
function trancheReceipts({ split, ledgerKey, label, brief, platform, ledgerRow = ledgerKey, reservationId = brief.id }) {
  const left = afterRefund(split);
  const dates = expectedDates({ paidAt: split.paidAt, holdDays: split.holdDays });
  const paidDay = day(split.paidAt);
  return [['immediat', left.immediateCents], ['retenue', left.reserveCents]].filter(([, cents]) => cents > 0).map(([tranche, cents]) => ({
    reservationId, ledgerKey: trancheKey(ledgerKey, tranche), baseKey: ledgerKey,
    label: `${label} · ${TRANCHE_WORDS[tranche]}`, channel: 'mollie', platform,
    expectedCents: cents, grossCents: cents, payoutRecorded: true,
    expectedDate: dates[tranche], dueDate: dates[tranche], paid: true, paidDate: paidDay, linkPaidAt: paidDay,
    mollie: {
      tranche, sourceType: split.sourceType, sourceKey: String(split.sourceKey), splitId: splitIdOf(split.sourceType, split.sourceKey),
      ledgerRow, paymentGrossCents: split.grossCents, ratePercent: split.ratePercent,
      holdDays: split.holdDays, lateAfterDays: LATE_AFTER_DAYS[tranche], molliePaymentId: split.molliePaymentId || null,
      // Rule 18 — the share the reserve really is of the payment (Mollie's own hold corrects the rate): the words print it.
      reservePercent: reservePercentOf(split), immediatePercent: immediatePercentOf(split), refundedCents: Number(split.refundedCents) || 0,
    },
    reservation: brief,
  }));
}

/**
 * specs/plugins-phase-1-sdk.md rule 47 (guest-app rule 35) — a paid link billing a plugin's own basket (a guest
 * order) lands on the account like any link payment: its whole amount, whatever part is flagged « à rembourser »
 * (that money leaves later, as a refund). On a platform stay as on a direct one: the guest paid GuestFlow, not
 * the platform.
 */
function basketReceipts(row, links, brief, platform, splitFor) {
  return links.filter((l) => l.status === 'paid' && l.basketJson && Number(l.amountCents) > 0).flatMap((l) => {
    const split = splitFor(l);
    const label = `Paiement en ligne (lien ${l.id})`;
    // A basket has no row of the payments ledger (its order is the plugin's): its tranches count in the fiche's schedule line only.
    if (split) return trancheReceipts({ split, ledgerKey: `basket-${l.id}`, label, brief, platform, ledgerRow: null });
    return [{
      reservationId: row.id, ledgerKey: `basket-${l.id}`, label,
      channel: 'link', platform,
      expectedCents: Number(l.amountCents), grossCents: Number(l.amountCents), payoutRecorded: true,
      expectedDate: day(l.paidAt), dueDate: day(l.paidAt), paid: true, paidDate: day(l.paidAt),
      linkPaidAt: day(l.paidAt),
      reservation: brief,
    }];
  });
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
 * @param {Function} [deps.splitFor] `(link) → stored Mollie split | null` (specs/mollie-rolling-reserve-and-incoming-payments.md rule 8)
 * @param {Function} [deps.sourceSplit] `(sourceType, sourceKey) → stored Mollie split | null`, for a card payment recorded on site (rule 1)
 * @param {string} deps.today
 * @returns {object[]} receipts
 */
function receiptsOfReservation(row, { buildLedger, parseGroup, links, installments = [], settlements = [], settlementFigures = null, splitFor = () => null, sourceSplit = () => null, today }) {
  const ledger = buildLedger({ row, links, today });
  const brief = reservationBrief(row);
  const platform = String(row.platform || 'direct');
  const isPlatform = platform.trim().toLowerCase() !== 'direct';
  const out = [];
  const isPaid = (r) => String(r.state).startsWith('paid');
  const baskets = basketReceipts(row, links, brief, platform, splitFor);

  if (isPlatform) {
    const balance = ledger.rows.find((r) => r.key === 'balance');
    if (!balance) return baskets;
    const paid = isPaid(balance);
    // Rule 8 — a platform that reverses the tax pays it with the transfer: the expected money is the host amount plus it.
    const grossRaw = grossOf(row, taxPaidWithPayout({ mode: platformsModel.getTouristTaxCollection(platform), box: row.platformTouristTaxAmount }));
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
    // Rule 1 (second half) — an instalment recorded paid by card without a link went through Mollie as well.
    const split = paidLink ? splitFor(paidLink) : (paid && i.paidMethod === 'card' ? sourceSplit('tender', `installment:${i.id}`) : null);
    if (split) {
      out.push(...trancheReceipts({ split, ledgerKey: `installment-${i.number}`, label: `Échéance ${i.number}/${installments.length}`, brief, platform }));
      return;
    }
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
    // The complement's link is typed `complement` whichever row the ledger draws it on (arrival, or deferred to the check-out).
    const linkType = r.key === 'checkoutComplement' ? 'complement' : r.key;
    const paidLink = link ? links.find((l) => l.status === 'paid' && ['deposit', 'balance', 'full', 'complement'].includes(String(l.type))
      && ((linkType === 'balance' && ['balance', 'full'].includes(String(l.type))) || String(l.type) === linkType)) : null;
    const due = meta.dueDate ? day(row[meta.dueDate]) : null;
    const split = paidLink ? splitFor(paidLink) : null;
    if (split) {
      out.push(...trancheReceipts({ split, ledgerKey: r.key, label: r.label, brief, platform }));
      return;
    }
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
    const figures = settlementFigures ? settlementFigures(s) : { bankCents: 0, byMethod: {} };
    let bankCents = figures.bankCents;
    // Rule 1 (second half) — the CB line of a split payment is Mollie's; its cheque and transfer lines stay one receipt.
    const cardSplit = (figures.byMethod.card || 0) > 0 ? sourceSplit('tender', `settlement:${s.id}`) : null;
    if (cardSplit) {
      out.push(...trancheReceipts({
        split: cardSplit, ledgerKey: `settlement-${s.id}-card`, label: 'Paiement réparti · CB', brief, platform,
        ledgerRow: settlementLedgerRow(s, installments),
      }));
      bankCents -= figures.byMethod.card;
    }
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
function expectedReceipts({ db, startDate, today, buildLedger, parseGroup, listLinks, listInstallments, splitFor, sourceSplit, sales = [], saleLinks = [] }) {
  const rows = db.prepare(`${RESERVATION_SQL} ORDER BY r.endDate, r.id`).all(startDate);
  const installmentsOf = installmentsReader(db, listInstallments);
  const { settlementsOf, settlementFigures } = settlementsReader(db);
  const receipts = [];
  rows.forEach((row) => {
    receiptsOfReservation(row, { buildLedger, parseGroup, links: listLinks(row.id), installments: installmentsOf(row.id), settlements: settlementsOf(row.id), settlementFigures, splitFor, sourceSplit, today })
      .forEach((rc) => receipts.push(rc));
  });
  return [...receipts, ...saleReceipts(sales, sourceSplit, { saleLinks, splitFor })];
}

/** The brief of a sale outside a stay: no stay, the sale named by its key, its client when it has one. */
function saleBrief(sale) {
  const client = [sale.client && sale.client.firstName, sale.client && sale.client.lastName].filter(Boolean).join(' ').trim();
  return {
    id: null, saleKey: String(sale.key), clientName: client || sale.label, lastName: (sale.client && sale.client.lastName) || '', hasClient: Boolean(client),
    propertyName: '', startDate: null, endDate: null, platform: 'direct', reservationNumber: '', createdAt: null, saleLabel: sale.label,
  };
}

const SALE_LABEL = 'Vente hors séjour';

/**
 * Rule 1 (second half) — a sale made outside any stay and paid by card through Mollie: the same two tranches as a link,
 * with no fiche. Its receipts carry reservation id 0 (no stay) and a brief that names the sale (`saleKey`) and its client.
 * Loop t10 D10-2 (rule 32) — a paid payment link of a sale outside a stay (`saleLinks`: links with `saleRef`, no stay) yields its own
 * tranches (`splitFor(link)`: the stored split, else the provisional one), keyed `sale:<sale key>:link-<id>`, the sale key being
 * `<saleRef>:<Paris day paid>` — named by the sale of that day when it is listed, else by the link alone.
 */
function saleReceipts(sales, sourceSplit = () => null, { saleLinks = [], splitFor = () => null } = {}) {
  const card = sales.flatMap(({ sale, sourceType, sourceKey }) => {
    const split = sourceSplit(sourceType, sourceKey);
    // A card amount that is gone from the sale leaves nothing to expect, unless Mollie's own payment is the proof of it.
    if (!split || (!split.molliePaymentId && !(Number(sale.cardCents) > 0))) return [];
    return trancheReceipts({ split, ledgerKey: `sale:${sale.key}`, label: sale.label, brief: saleBrief(sale), platform: 'direct', reservationId: 0, ledgerRow: null });
  });
  const byKey = new Map(sales.filter(({ sale }) => !sale.role).map(({ sale }) => [String(sale.key), sale]));
  const links = saleLinks.filter((l) => l.status === 'paid' && l.saleRef && l.paidAt && Number(l.amountCents) > 0).flatMap((l) => {
    const split = splitFor(l);
    if (!split) return [];
    const saleKey = `${l.saleRef}:${day(l.paidAt)}`;
    const sale = byKey.get(saleKey) || { key: saleKey, label: SALE_LABEL, client: null };
    return trancheReceipts({
      split, ledgerKey: saleLinkLedgerKey(saleKey, l.id), label: `${sale.label} (lien ${l.id})`, brief: saleBrief(sale), platform: 'direct', reservationId: 0, ledgerRow: null,
    });
  });
  return [...card, ...links];
}

/** The receipts of one reservation, scope included (the fiche's block). */
function expectedReceiptsOfReservation({ db, reservationId, startDate, today, buildLedger, parseGroup, listLinks, listInstallments, splitFor, sourceSplit }) {
  const row = db.prepare(`${RESERVATION_SQL} AND r.id = ?`).get(startDate, Number(reservationId));
  if (!row) return null;
  const installmentsOf = installmentsReader(db, listInstallments);
  const { settlementsOf, settlementFigures } = settlementsReader(db);
  return receiptsOfReservation(row, { buildLedger, parseGroup, links: listLinks(row.id), installments: installmentsOf(row.id), settlements: settlementsOf(row.id), settlementFigures, splitFor, sourceSplit, today });
}

module.exports = {
  expectedReceipts, expectedReceiptsOfReservation, receiptsOfReservation, reservationBrief, platformAcompteNet, saleReceipts,
  RESERVATION_SQL, installmentsReader, settlementsReader,
};
