/**
 * AccountingOutput (specs/pricing-components.md §3 rule 63): the journal entries of a period, read from the read models only
 * — the stays' stored money, the settlements, the installments, the refunds, the compensations, the penalties and the sales
 * made outside any stay. An exporter (`exporters/`) formats them; none recomputes a price or a VAT. Moved from the
 * accounting-export plugin, which keeps its routes, account plan, settings and read models (`accountingModel.js`).
 *
 * `create({ accountPlan, entryVentilation })` — the plugin's account plan (the numbers an entry credits and debits) and the
 * CSV journal's ventilation of one entry, which the books of a split stay close on.
 */

const { taxShares } = require('../installmentPlan');
const { parseNotes } = require('../midStayExtras');
const { parseGroup } = require('../arrivalPaymentGroup');
const { storedMoneyCollected } = require('../storedMoneySplit');
const { parseComplementAllocation } = require('../complementAllocation');
const { isDirectChannel } = require('../platformNameFormat');
const { settlementFigures, targetFigures, currentCentsOf } = require('../paymentTenders');
const { netFirst } = require('../pricing/vat');
const {
  computeBucketTtcsFromContribs, computeTaxTtcForKind, soldeCaptureMatches, legacyGrossUp, parseComplementPaidSplit,
  parsePaidSplit, bucketFromTtc, netOfTtc, nz, round2, CONTRIB_RESIDUE_TOLERANCE_TTC,
} = require('./legacyBucketSplit');

function buildStandaloneEntry(sale) {
  return {
    reservationId: null,
    kind: 'standalone',
    direction: 'standalone',
    standaloneKey: sale.key,
    standaloneLabel: sale.label,
    paidDate: sale.date,
    client: sale.client || { firstName: '', lastName: '' },
    encaissementTtc: Math.round(sale.booksCents) / 100,
    vatRatePercent: sale.vatRate === null || sale.vatRate === undefined ? null : Number(sale.vatRate),
    piece: sale.invoiceNumber || '',
  };
}

// One penalty → its own entry: debit the penalty account, credit the client's account, no VAT. The
// client account nets to the money the platform really paid; the balance entry is untouched.
function buildPenaltyEntry(penalty, stay, account) {
  if (!stay) return null;
  const ttc = round2(penalty.amount);
  if (!(ttc > 0)) return null;
  return {
    reservationId: stay.id,
    penaltyId: penalty.id,
    kind: 'penalty',
    direction: 'penalty',
    paidDate: penalty.date,
    client: { firstName: stay.firstName || '', lastName: stay.lastName || '' },
    propertyName: stay.propertyName || '',
    platform: stay.platform || '',
    finalPrice: round2(stay.finalPrice),
    encaissementTtc: ttc,
    encaissementNetTtc: ttc,
    commission: null,
    taxTtc: 0,
    fraction: 1,
    buckets: [],
    reason: penalty.reason,
    penaltyAccount: account,
    accountLabels: { [account]: 'Pénalité plateforme' },
  };
}

// One received compensation → one sale-shaped entry: the platform pays us, so the money moves in
// the same direction as an encaissement. No commission (the amount saved IS the net wired), no
// tourist tax (a cancelled stay generates none), no buckets (there is no séjour to split).
function buildCompensationEntry(compensation, { account, vatRatePercent }) {
  const ttc = round2(compensation.receivedAmount);
  if (ttc <= 0) return null;
  const rate = Number(vatRatePercent) || 0;
  // At 0 % (the default: an indemnity is outside the scope of VAT) HT === TTC and the export emits
  // a single credit line.
  const ht = netOfTtc(ttc, rate);
  return {
    compensationId: compensation.id,
    reservationId: compensation.reservationId,
    kind: 'compensation',
    direction: 'compensation',
    paidDate: compensation.receivedDate,
    client: { firstName: compensation.clientFirstName || '', lastName: compensation.clientLastName || '' },
    propertyName: compensation.propertyName || '',
    platform: compensation.platform || '',
    clientGrossAmount: null,
    finalPrice: ttc,
    encaissementTtc: ttc,
    encaissementNetTtc: ttc,
    commission: null,
    taxTtc: 0,
    fraction: 1,
    buckets: [],
    compensation: {
      account,
      ht,
      vat: round2(ttc - ht),
      ratePercent: rate,
      expectedAmount: compensation.expectedAmount,
      startDate: compensation.startDate || '',
      endDate: compensation.endDate || '',
    },
  };
}

// Resolve the commission config for one reservation. Returns null for direct bookings (no
// platform → no commission line). Returns `{ account, hasVat }` otherwise.
function resolveCommissionConfig(row, commissionContext) {
  if (!commissionContext) return null;
  const platform = String(row.platform || 'direct').toLowerCase();
  if (platform === 'direct') return null;
  const platformRow = commissionContext.platformByName.get(platform);
  const account = (platformRow && platformRow.commissionAccountNumber) || commissionContext.defaultAccount;
  // Under « Sans TVA » the platform's VAT on its commission is not deductible: it is a cost, booked TTC
  // on the commission account (vat-optional-mode rule 12g), whatever the platform row says.
  const deductible = commissionContext.salesRegime !== 'not_subject';
  const hasVat = platformRow ? Boolean(Number(platformRow.hasVatOnCommission)) && deductible : false;
  return { account, hasVat };
}

// Sales + refunds + cancellation compensations of the month, in one chronological stream. Neither a
// refund nor a compensation is an encaissement, but both belong to the same journal at their own
// date (specs/reservation-refunds.md §3.4 rule 21, specs/cancellation-compensation.md §3.3 rule 15).
// Building the stream here means the CSV and the JSON preview can never drift apart.
function journalEntries(params, accountingModel) {
  const sales = accountingModel.encaissementsByMonth(params);
  const refunds = accountingModel.refundsByMonth ? accountingModel.refundsByMonth(params) : [];
  const compensations = accountingModel.compensationsByMonth ? accountingModel.compensationsByMonth(params) : [];
  const penalties = accountingModel.platformPenaltiesByMonth ? accountingModel.platformPenaltiesByMonth(params) : [];
  // specs/resource-booking-pricing-and-invoicing.md rule 21 — the sales made outside any stay.
  const standalone = accountingModel.standaloneSalesByMonth ? accountingModel.standaloneSalesByMonth(params) : [];
  return [...sales, ...refunds, ...compensations, ...penalties, ...standalone]
    .sort((a, b) => String(a.paidDate || '').localeCompare(String(b.paidDate || '')));
}

function createAccountingOutput({ accountPlan, entryVentilation }) {
  const {
    VAT_DEDUCTIBLE_COMMISSION_ACCOUNT, DISCOUNT_ACCOUNT, TIP_ACCOUNT, BUCKET_TO_ACCOUNT, vatAccountForRate,
  } = accountPlan;


  // Shape an entry the export engine consumes.
  //
  // Two bucket paths (spec force-item-to-complement.md §5):
  //   1. **Contrib-driven (preferred)**: when ANY per-line `acompteContribTtc` / `soldeContribTtc`
  //      is non-NULL on the reservation, we trust those snapshots and the reservation-level
  //      `accommodation*ContribTtc` / `touristTax*ContribTtc`. The bucket TTC for `deposit` is
  //      `sum(option/resource/custom.acompteContribTtc) + accommodationAcompteContribTtc`. For
  //      `balance` we use `soldeContribTtc`. For `complement` we compute `currentTotal − acompte −
  //      solde` per line (= the post-payment growth) plus the forced lines at 100 % plus the
  //      forced tax portion. Zero cross-contamination across kinds; `fraction = 1` (the export
  //      multiplies by 1 and writes the values as-is).
  //   2. **Stored-money fallback**: when all per-line contribs are NULL, full-reservation buckets
  //      from the persisted line totals, multiplied export-side by `fraction` = the échéance's
  //      effective share of the séjour.
  //
  // Tourist tax never hits a revenue account. When the reservation routes the tax to complement
  // (`collectedOnArrival` OR `touristTaxInComplement = 1`) the complement carries it on the
  // 46710000 pass-through; otherwise it rides entirely on the solde (specs/tourist-tax-on-solde.md).
  //
  // Returns `null` when there is nothing to book (zero stored amount, or a contrib entry whose
  // buckets and tax are all zero).
  //
  // specs/accounting-encaissement-effective-percent.md — money resolution:
  //   - CA (`encaissementTtc`) = the STORED échéance amount × gross-up ratio. The ratio is 1 for
  //     every reservation written by the current engine (schedule sums to finalPrice + tax), so
  //     stored amounts pass through unscaled; it only grosses up the two historical shapes
  //     (« solde = net » era, `clientGrossAmount` era) to what the guest actually paid.
  //   - Net perçu = CA − this échéance's commission → the CCLIENT debit (= bank movement). The
  //     commission HT debit + optional VAT debit absorb the gap so Σ debits = Σ credits = CA.
  //   - Revenue buckets derive from the STORED row money (finalPrice + persisted line totals),
  //     never from a recomputed quote (pricing-rule drift corrupted the credit lines otherwise).
  //
  // `taxContext.collectedOnArrival` is resolved by the caller (no quote recompute); pure-function
  // callers (unit tests) inject it directly.
  // One installment collected → one encaissement, booked like the solde it stands for: the stored-money
  // split (a plan never captured per-line contribs), with the tourist tax shared out in proportion to the
  // plan's scheduled total (the solde used to carry all of it). specs/direct-installments.md.
  function buildInstallmentEntry(row, installment, count, taxShare, perLineData, commissionContext, taxContext) {
    const amount = round2(Number(installment.amountCents) / 100);
    const standIn = {
      ...row,
      depositAmount: 0,
      balanceAmount: amount,
      balancePaidDate: installment.paidDate,
      touristTaxTotal: taxShare,
      // specs/platform-added-guests-tourist-tax.md rule 27 — the share already leaves the addition out: never taken off twice.
      touristTaxAddedGuestsAmount: 0,
    };
    const entry = buildEntry(standIn, 'balance', { ...perLineData, hasContribs: false }, commissionContext, taxContext);
    if (!entry) return null;
    const frozen = parsePaidSplit(installment.paidSplit);
    if (!frozen) return { ...entry, kind: 'installment', installment: { number: installment.number, count } };
    // specs/accounting-books-the-money-collected.md rule 14 — collected, so frozen: the split stored at
    // payment time is booked verbatim, whatever the fiche became since (rule 33 of the export spec).
    const vatRate = commissionContext && Number.isFinite(Number(commissionContext.vatRate)) ? Number(commissionContext.vatRate) : 10;
    return {
      ...entry,
      kind: 'installment',
      installment: { number: installment.number, count },
      taxTtc: frozen.taxCents / 100,
      fraction: 1,
      buckets: [
        bucketFromTtc('accommodation', frozen.accommodationCents / 100, vatRate),
        bucketFromTtc('options',       frozen.optionsCents / 100,       vatRate),
        bucketFromTtc('resources',     frozen.resourcesCents / 100,     vatRate),
      ].filter((b) => b.ht > 0 || b.vat > 0),
    };
  }

  /**
   * specs/mixed-method-payments.md rule 26 — what the split payments of a stay paid, so the ordinary emission
   * leaves those buckets, notes and installments to their settlements.
   */
  function splitTargetsOf(settlements) {
    const out = { buckets: new Set(), notes: new Set(), installments: new Set() };
    for (const s of settlements || []) {
      for (const p of s.parts || []) {
        if (p.kind === 'note') out.notes.add(String(p.key));
        else if (p.kind === 'installment') out.installments.add(String(p.key));
        else out.buckets.add(p.kind);
      }
    }
    return out;
  }

  // Rule 39 — each settlement's target, read at what it is worth now (`paymentTenders.targetFigures`).
  function targetReader(settlements, row) {
    const byTarget = new Map();
    for (const s of settlements || []) {
      const key = `${s.targetKind}:${s.targetKey}`;
      if (!byTarget.has(key)) byTarget.set(key, []);
      byTarget.get(key).push(s);
    }
    const figures = new Map();
    return (settlement) => {
      const key = `${settlement.targetKind}:${settlement.targetKey}`;
      if (!figures.has(key)) {
        const list = byTarget.get(key) || [settlement];
        figures.set(key, targetFigures(list, { currentCents: currentCentsOf(list[0].parts, row) }));
      }
      return figures.get(key);
    };
  }

  /**
   * What one settlement puts on the books (rules 18, 26, 39): its lines on the books and its booked geste, both
   * scaled by what still stands of them once the target's amount moved, and the share of the target's entries
   * that carries them. The entries are built at the target's current amount, so the share is taken over it: a
   * rise not yet collected books nothing, a fall books what is still owed of the money received.
   */
  function bookedFigures(settlement, target) {
    const f = settlementFigures(settlement);
    const booksCents = f.booksCents * target.receivedFactor;
    const bookedWaivedCents = f.bookedWaivedCents * target.waivedFactor;
    const base = target.currentCents;
    return { booksCents, bookedWaivedCents, share: base > 0 ? (booksCents + bookedWaivedCents) / base : 0 };
  }

  // The share of a bucket the books carry, all its settlements together; 1 when it was not split.
  function bookedShareOf(settlements, bucket, row) {
    const mine = (settlements || []).filter((s) => (s.parts || []).some((p) => p.kind === bucket));
    if (mine.length === 0) return 1;
    const targetOf = targetReader(settlements, row);
    return mine.reduce((sum, s) => sum + bookedFigures(s, targetOf(s)).share, 0);
  }

  // Rule 56 — what an entry left on the stay's sale accounts (credit − debit, in cents): the sale revenue (706, 706010,
  // the activities, the rabais 709), the VAT collected and the tourist tax. An avoir's indemnity share is not a sale: its
  // 7588 line is left out, and so is the VAT it debited on the shared VAT account.
  const SALE_REVENUE_ACCOUNTS = new Set([...Object.values(BUCKET_TO_ACCOUNT), DISCOUNT_ACCOUNT]);
  function addSaleLegs(legs, entry) {
    const add = (account, role, ratePercent, cents) => {
      const leg = legs.get(account) || { cents: 0, role, ratePercent };
      leg.cents += cents;
      legs.set(account, leg);
    };
    for (const line of entryVentilation(entry)) {
      const sale = (line.role === 'revenue' && SALE_REVENUE_ACCOUNTS.has(line.account)) || line.role === 'vat' || line.role === 'touristTax';
      if (sale) add(line.account, line.role, line.ratePercent, Math.round((line.credit - line.debit) * 100));
    }
    const indemnityVat = entry.indemnity ? Math.round(Number(entry.indemnity.vat || 0) * 100) : 0;
    if (indemnityVat > 0) add(vatAccountForRate(entry.indemnity.ratePercent), 'vat', Number(entry.indemnity.ratePercent) || 0, indemnityVat);
    return legs;
  }

  // One entry scaled to a settlement's share: the export prorates every credit by `fraction` and absorbs the
  // rounding cent on the last one, so scaling the gross, the net, the tax and the fraction keeps it balanced.
  function scaleEntry(entry, share, settlement) {
    const scaled = {
      ...entry,
      fraction: Number(entry.fraction == null ? 1 : entry.fraction) * share,
      encaissementTtc: round2(Number(entry.encaissementTtc || 0) * share),
      encaissementNetTtc: round2(Number(entry.encaissementNetTtc == null ? entry.encaissementTtc : entry.encaissementNetTtc) * share),
      taxTtc: round2(Number(entry.taxTtc || 0) * share),
      commission: entry.commission ? {
        ...entry.commission,
        ttc: round2(Number(entry.commission.ttc || 0) * share),
        ht: round2(Number(entry.commission.ht || 0) * share),
        vat: round2(Number(entry.commission.vat || 0) * share),
      } : entry.commission,
    };
    if (settlement) {
      scaled.paidDate = settlement.paidDate;
      scaled.settlementId = settlement.id;
    }
    return scaled;
  }

  // specs/mixed-method-payments.md rule 18 — the geste commercial of a settlement, booked like the single arrival
  // payment's réduction accordée (rabais on 70900000 at the stay's rate), at the settlement's date.
  function buildSettlementDiscountEntry(row, settlement, ttc, vatRate) {
    const rate = Number.isFinite(Number(vatRate)) ? Number(vatRate) : 10;
    const ht = netFirst(ttc, rate).net;
    return {
      reservationId: row.id,
      kind: 'discount',
      direction: 'discount',
      paidDate: settlement.paidDate,
      settlementId: settlement.id,
      client: { firstName: row.firstName || '', lastName: row.lastName || '' },
      propertyName: row.propertyName || '',
      platform: row.platform || 'direct',
      finalPrice: round2(row.finalPrice),
      taxTtc: 0,
      commission: null,
      buckets: [],
      fraction: 1,
      encaissementTtc: round2(ttc),
      encaissementNetTtc: round2(ttc),
      discount: { account: DISCOUNT_ACCOUNT, ttc: round2(ttc), ht, vat: round2(ttc - ht), ratePercent: rate },
    };
  }

  /**
   * The two entries a single arrival payment can carry beyond its buckets
   * (specs/arrival-payment-detail-and-adjustment.md §3.4).
   *
   * A **réduction accordée** is the operator giving up part of the accommodation at the door. The sale
   * entries keep their gross credits — the accommodation IS worth what it is worth — and the rebate
   * carries its own debit on `70900000`, the PCG account for exactly that. Reading the journal, the
   * operator sees the price AND the gesture, instead of a smaller price with no explanation.
   *
   * A **pourboire** is money with no prestation in front of it: produit divers de gestion courante,
   * hors TVA.
   *
   * Both are dated on the GROUP's date — they belong to the collection, not to the day the operator got
   * round to recording them.
   */
  function buildArrivalAdjustmentEntries(row, group, vatRate) {
    const out = [];
    const common = {
      reservationId: row.id,
      paidDate: group.at,
      client: { firstName: row.firstName || '', lastName: row.lastName || '' },
      propertyName: row.propertyName || '',
      platform: row.platform || 'direct',
      finalPrice: round2(row.finalPrice),
      taxTtc: 0,
      commission: null,
      buckets: [],
      fraction: 1,
    };
    const reduction = round2(row.arrivalPaymentReduction);
    if (reduction > 0) {
      const rate = Number.isFinite(Number(vatRate)) ? Number(vatRate) : 10;
      const ht = netFirst(reduction, rate).net;
      out.push({
        ...common,
        kind: 'discount',
        direction: 'discount',
        encaissementTtc: reduction,
        encaissementNetTtc: reduction,
        discount: { account: DISCOUNT_ACCOUNT, ttc: reduction, ht, vat: round2(reduction - ht), ratePercent: rate },
      });
    }
    const tip = round2(row.arrivalPaymentTip);
    if (tip > 0) {
      out.push({
        ...common,
        kind: 'tip',
        direction: 'tip',
        encaissementTtc: tip,
        encaissementNetTtc: tip,
        tipAccount: TIP_ACCOUNT,
        // The account is shared with the indemnité d'annulation, so this entry names its own use of it.
        accountLabels: { [TIP_ACCOUNT]: 'Pourboire' },
      });
    }
    return out;
  }

  // specs/accounting-books-the-money-collected.md rule 12 (reading of 2026-11-11, Adrien) — the « Brut » of Comptabilité ›
  // Plateformes is the PLATFORM's gross: what the platform billed the guest, as recorded on the fiche (`platformGrossAmount`,
  // else the older `clientGrossAmount`). Only when nothing is recorded does it fall back to the stay price WITHOUT the
  // complements paid on site (the tourist tax a complement carries is not part of that price). An own-channel stay (`direct`, or a platform counted as a direct sale) with nothing recorded has
  // none to show. It is a display figure: the books read `effectiveGross`, never this.
  const recordedAmount = (value) => {
    const n = value === '' || value == null ? NaN : Number(value);
    return Number.isFinite(n) && n > 0 ? round2(n) : null;
  };
  function platformBrut(row) {
    const recorded = recordedAmount(row.platformGrossAmount) ?? recordedAmount(row.clientGrossAmount);
    if (recorded != null) return recorded;
    if (isDirectChannel(row.platform)) return null;
    // `finalPrice` excludes the tourist tax: when the complement carries it, that part is not a price to subtract.
    const taxInComplement = Number(row.touristTaxInComplement || 0) === 1 ? Math.min(nz(row.touristTaxTotal), nz(row.complementAmount)) : 0;
    return round2(Math.max(0, nz(row.finalPrice) - (nz(row.complementAmount) - taxInComplement)));
  }

  function buildEntry(row, kind, perLineData, commissionContext, taxContext) {
    const finalPriceTtc = Number(row.finalPrice || 0);
    const touristTaxTotal = Number(row.touristTaxTotal || 0);
    const collectedOnArrival = Boolean(taxContext && taxContext.collectedOnArrival);
    const taxRoutedToComplement = collectedOnArrival || Number(row.touristTaxInComplement || 0) === 1;
    // specs/per-platform-tourist-tax-three-way.md — case 1 "platform reverses the tax to us" is now a
    // REAL charge stored in `row.touristTaxTotal` and scheduled in the balance (the platform pays it
    // with the settlement). So the standard tax-in-balance path books it on 46710000 with no special
    // casing: the offered case (platform remits to the commune itself) is the only one with tax = 0.

    const amountByKind = {
      deposit:    Number(row.depositAmount)    || 0,
      balance:    Number(row.balanceAmount)    || 0,
      complement: Number(row.complementAmount) || 0,
    };
    const dateByKind = {
      deposit:    row.depositPaidDate,
      balance:    row.balancePaidDate,
      complement: row.complementPaidDate,
    };

    const storedAmountTtc = amountByKind[kind] || 0;

    // Defensive null-return for the (rare) case of a `*Paid = 1 + *PaidDate in month` but
    // `*Amount = 0`. Real-world cause: a reservation toggled `depositDisabled = ON` after the
    // user had already clicked "Marquer acompte payé" — depositPaid stays 1 but depositAmount
    // collapses to 0. Same idea for an accidentally-flipped complementPaid on a reservation
    // with no actual complement to perceive. Without this guard the entry was still emitted
    // (the legacy fallback path had no `null`-return for zero-revenue entries — only the
    // contrib-driven path did), producing a phantom "tout à zéro" row in the platforms table
    // + a balanced-but-empty card in the journal preview. See spec accountant-accounting-
    // export.md §3.4 rule 12bis.
    if (storedAmountTtc === 0) return null;

    // Gross/net resolution + commission for this entry (§3.5, revised 2026-06-21).
    // The platform commission is now operator-entered (`platformCommissionAmount`); « Prix payé par le
    // client » was retired. Two modes:
    //   - NEW (commission entered): the client pays the **total séjour** (= finalPrice), so CA is
    //     recognised on finalPrice (grossRatio = 1), the commission rides on the balance debit, and the
    //     net = finalPrice − commission (= the solde the engine now stores, spec platform-commission-line.md).
    //   - LEGACY fallback (no entered commission but a stored `clientGrossAmount` > net): keep the old
    //     gross-based recognition so already-booked platform reservations are unchanged.
    // Direct → gross === net (= finalPrice), no commission.
    // specs/adjustable-complement-amounts.md §3.6 — the ventilation the fiche stored for an adjusted
    // arrival complement, read (never re-derived) further down, and used right below to keep the
    // gross-up ratio from reacting to the adjustment.
    const storedAllocation = parseComplementAllocation(row.complementAllocation);
    const adjustedComplementAuto = storedAllocation ? storedAllocation.auto : null;

    const platformIsNonDirect = String(row.platform || 'direct').toLowerCase() !== 'direct';
    // specs/platform-per-echeance-commission.md — per-échéance platform commission: the acompte commission
    // books on the deposit entry, the solde commission (`platformCommissionAmount`) on the balance entry.
    const acompteCommissionTtc = platformIsNonDirect ? round2(Math.max(0, Number(row.acompteCommissionAmount || 0))) : 0;
    const soldeCommissionTtc = platformIsNonDirect ? round2(Math.max(0, Number(row.platformCommissionAmount || 0))) : 0;
    const enteredCommissionTtc = round2(acompteCommissionTtc + soldeCommissionTtc);
    const gross = legacyGrossUp(row, { finalPriceTtc, touristTaxTotal, enteredCommissionTtc, adjustedComplementAuto });
    const { commissionTtcTotal } = gross;
    let { grossRatio } = gross;
    // specs/platform-per-echeance-commission.md — explicit per-échéance allocation: the operator-entered
    // acompte commission rides on the deposit entry, the solde commission on the balance entry; the
    // complement carries none (on-site / host-billed). For a no-acompte platform the acompte commission is
    // 0 → the whole `platformCommissionAmount` lands on the solde (backward-compatible with the prior model).
    // The balance carries `commissionTtcTotal − acompteCommission`: in the entered-commission path that's
    // exactly the solde commission; in the LEGACY path (commission derived from `clientGrossAmount`, no
    // acompte commission) it's the whole derived commission — both correct, both backward-compatible.
    const platformCommissionByKind = {
      deposit:    acompteCommissionTtc,
      balance:    round2(commissionTtcTotal - acompteCommissionTtc),
      complement: 0,
    };
    // §3.6 rule 37 — on the adjusted complement itself the announced amount IS the money: it is booked
    // verbatim, never scaled. The acompte and the solde keep the ratio computed above (on the
    // un-adjusted schedule), so their entries are strictly unchanged by an adjustment.
    const complementIsAdjusted = kind === 'complement' && Boolean(storedAllocation);
    if (complementIsAdjusted) grossRatio = 1;

    const commissionTtcEntry = platformIsNonDirect ? (platformCommissionByKind[kind] || 0) : 0;
    // Resolve compte commission + hasVat from the global config snapshot.
    const commissionResolved = commissionTtcEntry > 0
      ? resolveCommissionConfig(row, commissionContext)
      : null;
    const vatRateCommission = commissionContext && Number.isFinite(Number(commissionContext.vatRateCommission))
      ? Number(commissionContext.vatRateCommission)
      : 20;
    let commissionLine = null;
    if (commissionResolved && commissionTtcEntry > 0) {
      const hasVat = commissionResolved.hasVat;
      const ht = hasVat
        ? netFirst(commissionTtcEntry, vatRateCommission).net
        : round2(commissionTtcEntry);
      const vat = hasVat ? round2(commissionTtcEntry - ht) : 0;
      commissionLine = {
        account: commissionResolved.account,
        hasVat,
        ttc: round2(commissionTtcEntry),
        ht,
        vat,
        vatAccount: VAT_DEDUCTIBLE_COMMISSION_ACCOUNT,
        vatRate: vatRateCommission,
      };
    }

    // ── Shared money resolution (spec rules 2–5) ────────────────────────────
    // CA = stored échéance × ratio (ratio = 1 for current-model rows). Net = CA − commission.
    const encaissementTtc = round2(storedAmountTtc * grossRatio);
    // Tourist tax carried by this échéance — part of the CA (the guest paid it) but credited to
    // the 46710000 pass-through, never a 70xxx revenue line.
    // The tourist-tax share of an adjusted complement is the one the FICHE ventilated against — the
    // floor guarantees the complement covers it, so the credits close on the announced amount.
    // specs/accounting-books-the-money-collected.md rule 16 — the split a collected complement was stamped with, read as long
    // as it adds up to the entry; the ratio's historical shapes and an operator's adjustment keep their own paths.
    const paidSplit = kind === 'complement' && !complementIsAdjusted && Math.abs(grossRatio - 1) < 1e-9 ? parseComplementPaidSplit(row, encaissementTtc) : null;
    const taxTtc = paidSplit
      ? paidSplit.tax
      : complementIsAdjusted && storedAllocation.tax != null
        ? round2(storedAllocation.tax)
        : computeTaxTtcForKind(row, kind, taxRoutedToComplement, encaissementTtc, soldeCaptureMatches(row, perLineData));
    const encaissementNetTtc = round2(encaissementTtc - (commissionLine ? commissionLine.ttc : 0));
    // Single global sales VAT rate (specs/single-vat-rate.md) — same one the quote carried.
    const vatRate = commissionContext && Number.isFinite(Number(commissionContext.vatRate))
      ? Number(commissionContext.vatRate)
      : 10;

    const common = {
      reservationId: row.id,
      kind,
      paidDate: dateByKind[kind] || null,
      client: { firstName: row.firstName || '', lastName: row.lastName || '' },
      propertyName: row.propertyName || '',
      platform: row.platform || 'direct',
      finalPrice: finalPriceTtc,
      encaissementTtc,
      encaissementNetTtc,
      commission: commissionLine,
      taxTtc: round2(taxTtc),
    };

    // specs/adjustable-complement-amounts.md §3.6 rules 31 + 36 — an ADJUSTED arrival complement carries
    // the ventilation the FICHE decided and stored. The export reads it verbatim: it never re-derives
    // the postes, and the only arithmetic left here is the TTC → HT + VAT split. That is what keeps
    // Σ credits equal to the adjusted debit by construction, instead of letting the difference fall on
    // the last credit line — which happens to be the 46710000 tourist tax (rule 37).
    if (complementIsAdjusted) {
      const allocated = [
        bucketFromTtc('accommodation', storedAllocation.accommodation, vatRate),
        bucketFromTtc('options',       storedAllocation.options,       vatRate),
        bucketFromTtc('resources',     storedAllocation.resources,     vatRate),
      ].filter((b) => b.ht > 0 || b.vat > 0);
      // Nothing to credit at all (an adjustment to 0 with no tax) → no entry, like every other bucket.
      if (allocated.length === 0 && round2(taxTtc) === 0) return null;
      return {
        ...common,
        clientGrossAmount: platformBrut(row),
        fraction: 1,
        buckets: allocated,
      };
    }

    if (paidSplit) {
      return {
        ...common,
        clientGrossAmount: platformBrut(row),
        fraction: 1,
        buckets: [
          bucketFromTtc('accommodation', paidSplit.accommodation, vatRate),
          bucketFromTtc('options',       paidSplit.options,       vatRate),
          bucketFromTtc('resources',     paidSplit.resources,     vatRate),
        ].filter((b) => b.ht > 0 || b.vat > 0),
      };
    }

    // `perLineData` is optional: when omitted (legacy callers / unit tests that don't model the
    // contrib columns) the fallback path runs with empty line totals.
    const hasContribs = Boolean(perLineData && perLineData.hasContribs);

    // ── Contrib-driven path ─────────────────────────────────────────────────
    // Bucket TTCs are the per-line snapshots captured at flip time from the money actually paid —
    // used AS-IS (the former × grossRatio scaling distorted them; spec rule 10). `fraction = 1`:
    // the export engine multiplies by 1 and writes the values verbatim, the ≤ 2-cent residue
    // being absorbed on the last credit so Σ credits = CA.
    const ttcByBucket = hasContribs ? computeBucketTtcsFromContribs(row, perLineData, kind, taxRoutedToComplement) : null;
    // specs/accounting-books-the-money-collected.md rule 11 — contribs frozen at payment time that no
    // longer fit in the entry (the stay was reduced after it was paid: one guest fewer, breakfast cut)
    // would push the residue onto the last credit, the 46710000 tourist tax, as a negative line. Such an
    // entry is booked like one that never captured contribs: pro-rata of the lines as they stand now.
    // The same goes the other way (audit 2026-10-28): contribs captured when the échéance was smaller,
    // or a line that never captured one (a custom option added after the capture), leave a gap that the
    // export would absorb on the last credit, the VAT line (#13: +182,91 € of VAT; #22298: +17,66 €).
    // Contribs describe the entry only when they add up to it within the rounding tolerance.
    const contribsOverflow = Boolean(ttcByBucket)
      && Math.abs(round2(ttcByBucket.accommodation + ttcByBucket.options + ttcByBucket.resources + taxTtc)
        - round2(encaissementTtc)) > CONTRIB_RESIDUE_TOLERANCE_TTC;
    // specs/accounting-books-the-money-collected.md rule 12 — contribs only describe an entry whose CA is
    // the stored échéance (ratio 1, rule 10's premise). A historical shape grossed up to what the guest
    // paid (the `clientGrossAmount` era, réservation #13) captures its contribs from the stored NET solde
    // when it is ticked today: used as-is, the commission they leave out lands on the last credit, the
    // VAT line (Gîtes de France 706 € net / 907,20 € brut → 44571100 C265,38 on 641,82 of revenue). Such
    // an entry is booked on the stored-money path, which pro-rates the gross-up over its postes.
    const contribsDescribeEntry = Math.abs(grossRatio - 1) < 1e-9;
    if (hasContribs && !contribsOverflow && contribsDescribeEntry) {
      const totalBucketsTtc = round2(ttcByBucket.accommodation + ttcByBucket.options + ttcByBucket.resources + taxTtc);
      // Nothing to credit (e.g. a complement whose lines all contributed 0) → drop the entry,
      // a debit-only card can never balance.
      if (totalBucketsTtc === 0) return null;

      const buckets = [
        bucketFromTtc('accommodation', ttcByBucket.accommodation, vatRate),
        bucketFromTtc('options',       ttcByBucket.options,       vatRate),
        bucketFromTtc('resources',     ttcByBucket.resources,     vatRate),
      ].filter((b) => b.ht > 0 || b.vat > 0);

      return {
        ...common,
        clientGrossAmount: platformBrut(row),
        fraction: 1,
        buckets,
      };
    }

    // ── Stored-money fallback (no per-line contribs) ────────────────────────
    // specs/accounting-books-the-money-collected.md rules 5-7 — each encaissement credits ONLY the postes
    // it actually covers, pro-rated within that destination. The former model scaled the WHOLE
    // reservation's buckets by `revenue / finalPrice`, so a solde that collected pure accommodation still
    // credited a slice of every option and resource on the fiche — including extras collected at arrival,
    // at checkout, or settled in caisse interne.
    // The split lives in the core (utils/storedMoneySplit): the cancellation reverses a legacy acompte on the very
    // same postes (specs/payment-schedule-and-cancellation.md rule 55).
    const revenueTtc = Math.max(0, round2(encaissementTtc - taxTtc));
    const storedHere = storedMoneyCollected(kind, finalPriceTtc, perLineData);
    // specs/platform-extra-guest-complement.md rule 10, reading of 2026-11-05 (audit R22-5) — the added guests' supplement is
    // stay revenue from its first entry, whatever was paid before it.
    const collectedHere = kind === 'complement'
      ? { ...storedHere, accommodation: round2(nz(row.extraGuestComplementSurcharge)) }
      : storedHere;
    const collectedTotal = round2(collectedHere.accommodation + collectedHere.options + collectedHere.resources);

    let fraction;
    let buckets;
    if (collectedTotal > 0) {
      // Effective percent WITHIN the destination: an acompte of 30 % of the pre-arrival credits 30 % of
      // the accommodation and of the pre-arrival extras, and nothing else.
      fraction = revenueTtc / collectedTotal;
      buckets = [
        bucketFromTtc('accommodation', collectedHere.accommodation, vatRate),
        bucketFromTtc('options',       collectedHere.options,       vatRate),
        bucketFromTtc('resources',     collectedHere.resources,     vatRate),
      ].filter((b) => b.ht > 0 || b.vat > 0);
    } else if (revenueTtc > 0) {
      // Money collected with nothing to attach it to: a blank-price row (iCal import never priced) books
      // it as accommodation; an arrival complement beyond its tourist tax books it as a prestation
      // (rule 10) rather than letting the residue swell the 46710000 pass-through.
      fraction = 1;
      buckets = [kind === 'complement'
        ? bucketFromTtc('options', revenueTtc, vatRate)
        : bucketFromTtc('accommodation', revenueTtc, vatRate)].filter((b) => b.ht > 0 || b.vat > 0);
    } else {
      // Nothing but tourist tax (an owner-collect complement that carries only the tax).
      fraction = 1;
      buckets = [];
    }

    return {
      ...common,
      // The platform's gross, like the three paths above: a stay never loses it to a NULL column.
      clientGrossAmount: platformBrut(row),
      fraction,
      buckets,
    };
  }

  // End-of-stay complement (departure SAS): a flat TTC amount outside the pricing engine — the SAS's own
  // lines (ménage, linge manquant) plus whatever was sold DURING the stay. Booked at the app general VAT
  // rate, collected on-site by the owner: no platform commission, no tourist tax
  // (specs/cash-complement-and-endofstay-finance.md §3.1 + Q1). Returns null when there's nothing to book.
  //
  // specs/accounting-books-the-money-collected.md rule 8 — ventilated by stored detail line: a `res:*` key
  // is a resource (70601000), everything else a prestation (70600010). Marchand's bain nordique, sold
  // mid-stay, was landing on the prestations account.
  function buildEndOfStayEntry(row, vatRate) {
    const ttc = round2(Number(row.endOfStayComplementAmount || 0));
    if (ttc <= 0) return null;
    const { options, resources } = splitEndOfStayDetail(row.endOfStayComplementDetail, ttc);
    const buckets = [
      bucketFromTtc('options',   options,   Number(vatRate || 0)),
      bucketFromTtc('resources', resources, Number(vatRate || 0)),
    ];
    return {
      reservationId: row.id,
      kind: 'endOfStayComplement',
      paidDate: row.endOfStayComplementPaidDate || null,
      client: { firstName: row.firstName || '', lastName: row.lastName || '' },
      propertyName: row.propertyName || '',
      platform: row.platform || 'direct',
      clientGrossAmount: null,
      finalPrice: ttc,
      encaissementTtc: ttc,
      encaissementNetTtc: ttc,
      commission: null,
      taxTtc: 0,
      fraction: 1,
      buckets: buckets.filter((x) => x.ht > 0 || x.vat > 0),
    };
  }

  // Split an end-of-stay complement between the two revenue natures, from its stored detail lines. The
  // amount is authoritative: when the detail is missing, unparsable, or doesn't add up to it (an operator
  // override, a legacy row), the unattributed remainder stays on the prestations account — the historical
  // behaviour, so no entry can lose money to a detail mismatch.
  function splitEndOfStayDetail(detailRaw, ttc) {
    let lines = [];
    if (Array.isArray(detailRaw)) lines = detailRaw;
    else if (detailRaw) { try { const p = JSON.parse(detailRaw); if (Array.isArray(p)) lines = p; } catch { lines = []; } }
    let resources = 0;
    for (const line of lines) {
      if (!line || !String(line.key || '').startsWith('res:')) continue;
      resources = round2(resources + Math.max(0, nz(line.amount)));
    }
    resources = Math.min(resources, ttc);
    return { options: round2(ttc - resources), resources };
  }

  // « Note en séjour » (specs/mid-stay-notes.md §3.4 rule 14): one punctual collection during the
  // stay, booked exactly like the end-of-stay complement — flat TTC split at the app general VAT rate
  // on the « prestation complémentaire » revenue account, collected on site (no platform commission,
  // no tourist tax). One entry per note, at the note's own payment date.
  function buildMidStayNoteEntry(row, note, vatRate) {
    const ttc = round2(Number(note && note.total) || 0);
    if (ttc <= 0) return null;
    const b = bucketFromTtc('options', ttc, Number(vatRate || 0));
    return {
      reservationId: row.id,
      kind: 'midStayComplement',
      paidDate: note.paidDate || null,
      client: { firstName: row.firstName || '', lastName: row.lastName || '' },
      propertyName: row.propertyName || '',
      platform: row.platform || 'direct',
      clientGrossAmount: null,
      finalPrice: ttc,
      encaissementTtc: ttc,
      encaissementNetTtc: ttc,
      commission: null,
      taxTtc: 0,
      fraction: 1,
      buckets: [b].filter((x) => x.ht > 0 || x.vat > 0),
    };
  }

  // Every encaissement of [from, nextMonth) — or of one stay over any window — as journal entries. `readModels` hands over what
  // the stored data says (the reservation rows, the commission and VAT settings, the per-line money, the settlements and the
  // installments); nothing here reads a table.
  function saleEntries({ from, nextMonth }, readModels) {
    const reservations = readModels.reservations();
    // Read the global commission config once per export run (settings + platforms).
    // accounting-platform-commission-and-no-deposit.md §3.5 rule 11.
    const commissionContext = readModels.commissionContext();
    // A tip lands on the plan's tip account (specs/plugins-phase-p-productisation.md rule 27): its
    // default is shared with the compensation account, so the entry names it.
    const tipAccount = String(readModels.tipAccount() || TIP_ACCOUNT);
    const inTipAccount = (entry) => (entry.kind === 'tip'
      ? { ...entry, tipAccount, accountLabels: { [tipAccount]: 'Pourboire' } }
      : entry);

    return reservations.flatMap((row) => {
      const salesRegime = readModels.regimeOf(row);
      const rowContext = { ...commissionContext, vatRate: salesRegime.rate, salesRegime: salesRegime.regime };
      const perLineData = readModels.perLineData(row);
      const taxContext = readModels.taxContextOf(row);
      const entries = [];
      const inMonth = (paid, date) => paid && date && date >= from && date < nextMonth;
      // specs/mixed-method-payments.md rule 26 — what a split payment paid is booked by its settlements below,
      // never a second time as a whole bucket, note or installment.
      const settlements = readModels.settlementsOf(row.id);
      const split = splitTargetsOf(settlements);
      // Cash-collected stay buckets are settled off the books → never emitted as an encaissement
      // (specs/collect-stay-payment-at-check-in.md §3.4).
      if (inMonth(row.depositPaid, row.depositPaidDate) && Number(row.depositPaidCash || 0) === 0 && !split.buckets.has('deposit')) {
        entries.push(buildEntry(row, 'deposit', perLineData, rowContext, taxContext));
      }
      if (inMonth(row.balancePaid, row.balancePaidDate) && Number(row.balancePaidCash || 0) === 0 && !split.buckets.has('balance')) {
        entries.push(buildEntry(row, 'balance', perLineData, rowContext, taxContext));
      }
      // One encaissement per installment collected in the month (specs/direct-installments.md): the plan
      // replaces the acompte and the solde, so these are the pre-arrival money of such a stay.
      const plan = readModels.installmentsOf(row.id);
      // The tax shares are those of the whole plan, so they add up to the tax once every installment is in.
      // specs/platform-added-guests-tourist-tax.md rule 27 — without the added guests' share: it rides the complement.
      const shares = plan.length
        ? taxShares(Math.round((Number(row.touristTaxTotal || 0) - Number(row.touristTaxAddedGuestsAmount || 0)) * 100), plan.map((i) => Number(i.amountCents)))
        : [];
      const installmentEntry = (installment) => {
        const index = plan.indexOf(installment);
        return buildInstallmentEntry(row, installment, plan.length, shares[index] / 100, perLineData, rowContext, taxContext);
      };
      plan.forEach((installment) => {
        if (Number(installment.paid) === 1 && inMonth(1, installment.paidDate) && !split.installments.has(String(installment.id))) {
          entries.push(installmentEntry(installment));
        }
      });
      // Cash complements are settled off the books → never emitted as an encaissement.
      if (inMonth(row.complementPaid, row.complementPaidDate) && Number(row.complementPaidCash || 0) === 0 && !split.buckets.has('complement')) {
        entries.push(buildEntry(row, 'complement', perLineData, rowContext, taxContext));
      }
      // End-of-stay complement (SAS): a flat TTC amount booked as a « prestation complémentaire »
      // at the app general VAT rate (specs/cash-complement-and-endofstay-finance.md §3.1). Excluded
      // when paid in cash.
      if (inMonth(row.endOfStayComplementPaid, row.endOfStayComplementPaidDate) && Number(row.endOfStayComplementPaidCash || 0) === 0 && !split.buckets.has('endOfStayComplement')) {
        entries.push(buildEndOfStayEntry(row, rowContext.vatRate));
      }
      // « Notes en séjour » (specs/mid-stay-notes.md §3.4 rule 14): one entry per SETTLED note, at
      // its own payment date — the note IS the real-world collection. Same flat-TTC shape as the
      // end-of-stay complement; caisse-interne notes stay off the books like the cash complements.
      for (const note of parseNotes(row.midStaySettledNotes)) {
        if (Number(note.paidCash || 0) === 1) continue;
        if (!inMonth(1, note.paidDate)) continue;
        if (split.notes.has(String(note.id))) continue;
        entries.push(buildMidStayNoteEntry(row, note, rowContext.vatRate));
      }
      // specs/mixed-method-payments.md rules 18, 26 — each settlement of the month: the entries of what it paid,
      // at its date, scaled to its share on the books (gross of its réduction), then the réduction itself.
      const partEntry = (part) => {
        if (part.kind === 'deposit' || part.kind === 'balance' || part.kind === 'complement') {
          return buildEntry(row, part.kind, perLineData, rowContext, taxContext);
        }
        if (part.kind === 'endOfStayComplement') return buildEndOfStayEntry(row, rowContext.vatRate);
        if (part.kind === 'note') {
          const note = parseNotes(row.midStaySettledNotes).find((n) => String(n.id) === String(part.key));
          return note ? buildMidStayNoteEntry(row, note, rowContext.vatRate) : null;
        }
        if (part.kind === 'installment') {
          const installment = plan.find((i) => String(i.id) === String(part.key));
          return installment ? installmentEntry(installment) : null;
        }
        return null;
      };
      const targetOf = targetReader(settlements, row);
      for (const settlement of settlements) {
        if (!inMonth(1, settlement.paidDate)) continue;
        const { booksCents, bookedWaivedCents, share } = bookedFigures(settlement, targetOf(settlement));
        if (share > 0) {
          for (const part of settlement.parts) {
            const entry = partEntry(part);
            if (entry) entries.push(scaleEntry(entry, share, settlement));
          }
        }
        if (bookedWaivedCents > 0) entries.push(buildSettlementDiscountEntry(row, settlement, bookedWaivedCents / 100, rowContext.vatRate));
      }
      // Stamp the group on the entries it named, so the Comptabilité can render one card for one
      // collection. A cash group emits no entry at all (its buckets are off the books), so there is
      // nothing to stamp there.
      const group = parseGroup(row.arrivalPaymentGroup);
      if (group) {
        const id = `${row.id}:${group.at}`;
        for (const entry of entries) {
          if (entry && group.buckets.includes(entry.kind)) {
            entry.paymentGroup = { id, at: group.at, cash: group.cash === 1, total: group.total };
          }
        }
        // specs/arrival-payment-detail-and-adjustment.md rules 24-27 — the adjustment of that
        // payment, at ITS date. A caisse-interne group is off the books whole: its buckets emit
        // nothing, so neither may its réduction (it would credit back money the journal never
        // booked).
        if (group.cash === 0 && group.at >= from && group.at < nextMonth) {
          const stamp = { id, at: group.at, cash: false, total: group.total };
          const adjustments = buildArrivalAdjustmentEntries(row, group, rowContext.vatRate);
          for (const entry of adjustments) entries.push({ ...inTipAccount(entry), paymentGroup: stamp });
        }
      }
      // Pure-tax entries are dropped (see `buildEntry`).
      return entries.filter(Boolean);
    });
  }

  return {
    buildEntry,
    buildInstallmentEntry,
    buildEndOfStayEntry,
    buildMidStayNoteEntry,
    buildSettlementDiscountEntry,
    buildArrivalAdjustmentEntries,
    splitTargetsOf,
    targetReader,
    bookedFigures,
    bookedShareOf,
    addSaleLegs,
    scaleEntry,
    saleEntries,
  };
}

module.exports = {
  create: createAccountingOutput,
  journalEntries,
  buildStandaloneEntry,
  buildPenaltyEntry,
  buildCompensationEntry,
  resolveCommissionConfig,
};
