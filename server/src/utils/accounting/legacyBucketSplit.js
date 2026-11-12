/**
 * The legacy read model of the accounting output (specs/pricing-components.md §3 rule 63): how the money a stay stored is
 * turned into the buckets an entry books. A row without per-line truth keeps today's derivation, in this ONE place, and
 * emits the same tagged amounts, so old months export byte-identically. Moved from the accounting-export plugin.
 */

const { splitTtc, netFirst } = require('../pricing/vat');
const { extraLineKey } = require('../midStayExtras');

// specs/accountant-accounting-export.md rules 33 and 35 — the first payment day the rule 32 split applies to when the
// install recorded none.
const TTC_SPLIT_FALLBACK = '2026-11-01';

// The residue the export absorbs on the last credit of a contrib-driven entry (rounding cents).
const CONTRIB_RESIDUE_TOLERANCE_TTC = 0.02;

// Tax TTC for a given encaissement kind, read from the per-bucket capture columns. Returns 0
// when the tax was either routed to complement (and this kind isn't 'complement') or
// already-captured-as-zero (e.g. collectedOnArrival path).
// Whether the solde's captured contribs describe the solde as stored: their sum is the encaissement by
// the capture's conservation invariant. A row whose stored solde no longer matches them (an older shape
// reduced after payment, accounting-books-the-money-collected rule 11) has no trustworthy frozen tax.
function soldeCaptureMatches(row, perLineData) {
  if (row.touristTaxSoldeContribTtc == null || row.accommodationSoldeContribTtc == null) return false;
  const lines = perLineData
    ? [...(perLineData.optionLines || []), ...(perLineData.customOptionLines || []), ...(perLineData.resourceLines || [])]
    : [];
  const captured = nz(row.accommodationSoldeContribTtc) + nz(row.touristTaxSoldeContribTtc)
    + lines.reduce((sum, l) => sum + nz(l.soldeContribTtc), 0);
  return Math.abs(round2(captured) - round2(nz(row.balanceAmount))) <= CONTRIB_RESIDUE_TOLERANCE_TTC;
}

function computeTaxTtcForKind(row, kind, taxRoutedToComplement, encaissementTtc, soldeFrozen = false) {
  const total = round2(nz(row.touristTaxTotal));
  const cap = Number(encaissementTtc) > 0 ? Number(encaissementTtc) : total;
  if (taxRoutedToComplement) {
    // Collected on arrival / forced to complement: the tax is never on the acompte or the solde.
    // The complement carries whatever is left after the (always-zero) deposit + balance shares,
    // clamped to the complement's own CA as a defensive guard.
    if (kind !== 'complement') return 0;
    const inDeposit = nz(row.touristTaxAcompteContribTtc);
    const inBalance = nz(row.touristTaxSoldeContribTtc);
    return round2(Math.min(Math.max(0, total - inDeposit - inBalance), cap));
  }
  // specs/tourist-tax-on-solde.md — when the tax rides the pre-arrival schedule it is booked
  // ENTIRELY on the SOLDE, never the acompte. We force this regardless of the stored per-bucket
  // contribs: legacy reservations whose acompte flip captured a proportional tax share (before
  // this rule shipped) must still show 0 tax on the deposit and the full tax on the balance.
  // The balance CA is always ≥ the tax (balance = accommodation remainder + tax), so the
  // clamp is only a defensive guard.
  // specs/platform-added-guests-tourist-tax.md rule 13 — the added guests' share is collected with the
  // complement; the solde books what the platform reversed.
  const added = round2(nz(row.touristTaxAddedGuestsAmount));
  if (kind === 'deposit') return 0;
  // specs/accounting-books-the-money-collected.md rule 13 — once the solde is paid, the tax it
  // collected is frozen in `touristTaxSoldeContribTtc` (plus the share an older acompte captured,
  // reclassed here). A tax that rises afterwards never rewrites that entry: the growth is collected —
  // and booked — by the arrival complement. A solde paid before contribs existed, or whose contribs no
  // longer describe it, keeps the live total.
  const frozenInSolde = soldeFrozen && Number(row.balancePaid || 0) === 1
    ? round2(nz(row.touristTaxAcompteContribTtc) + nz(row.touristTaxSoldeContribTtc))
    : null;
  if (kind === 'balance') {
    return round2(Math.min(frozenInSolde != null ? frozenInSolde : Math.max(0, total - added), cap));
  }
  if (kind === 'complement') {
    return round2(Math.min(frozenInSolde != null ? Math.max(0, total - frozenInSolde) : added, cap));
  }
  return 0;
}

// Aggregate the per-line/per-portion TTCs for a single entry kind. Tax is always excluded.
function computeBucketTtcsFromContribs(row, perLineData, kind, taxRoutedToComplement) {
  const accommodationAcompte = nz(row.accommodationAcompteContribTtc);
  const accommodationSolde   = nz(row.accommodationSoldeContribTtc);
  const accommodationTtcCurrent = perLineData.accommodationTtcCurrent;

  // specs/tourist-tax-on-solde.md — the tax is booked 100 % on the solde. A legacy reservation
  // whose acompte flip captured a proportional tax share (`touristTaxAcompteContribTtc > 0`)
  // physically collected that tax with the deposit. To keep both entries bank-matched while the
  // tax line rides entirely on the balance, we reclass that share out of the tax line and into the
  // accommodation bucket of the deposit (it stays in the deposit's encaissement) and remove the
  // same amount from the balance's accommodation (so balance = remainder + the FULL tax). For
  // reservations booked under the new rule the share is 0, so this is a no-op.
  const taxAcompteReclass = taxRoutedToComplement ? 0 : nz(row.touristTaxAcompteContribTtc);

  if (kind === 'deposit') {
    return {
      accommodation: round2(accommodationAcompte + taxAcompteReclass),
      options:       round2(sumContribField(perLineData.optionLines, 'acompteContribTtc')
                          + sumContribField(perLineData.customOptionLines, 'acompteContribTtc')),
      resources:     round2(sumContribField(perLineData.resourceLines, 'acompteContribTtc')),
    };
  }
  if (kind === 'balance') {
    return {
      accommodation: round2(Math.max(0, accommodationSolde - taxAcompteReclass)),
      options:       round2(sumContribField(perLineData.optionLines, 'soldeContribTtc')
                          + sumContribField(perLineData.customOptionLines, 'soldeContribTtc')),
      resources:     round2(sumContribField(perLineData.resourceLines, 'soldeContribTtc')),
    };
  }
  // kind === 'complement':
  //   - forced lines (`inComplement = 1`): full current `totalPrice`.
  //   - non-forced lines: post-payment delta = `totalPrice - (acompte + solde)`, clamped ≥ 0.
  //   - accommodation: same delta + forced flag has no meaning here (accommodation never forced).
  //   - tax: excluded from the journal regardless of routing.
  const remainingMidStay = { ...(perLineData.midStayByKey || {}) };
  const optionsTtc = sumComplementContribution(perLineData.optionLines, remainingMidStay)
    + sumComplementContribution(perLineData.customOptionLines, remainingMidStay, true);
  const resourcesTtc = sumComplementContribution(perLineData.resourceLines, remainingMidStay);
  const accommodationDelta = Math.max(0, accommodationTtcCurrent - (accommodationAcompte + accommodationSolde));
  return {
    accommodation: round2(accommodationDelta),
    options:       round2(optionsTtc),
    resources:     round2(resourcesTtc),
  };
}

// `remainingMidStay` carries the share of each key sold DURING the stay: that money belongs to the
// end-of-stay complement entry, never to this one (specs/mid-stay-extras-to-end-of-stay-complement.md).
// It is CONSUMED as it is deducted, so two custom lines sharing a label (hence a key) split it
// instead of each deducting the whole amount.
function sumComplementContribution(lines, remainingMidStay = {}, isCustom = false) {
  return (lines || []).reduce((sum, line) => {
    const key = extraLineKey(isCustom ? { ...line, isCustom: true } : line);
    const lineTotal = Number(line.totalPrice || 0);
    const midStay = key ? Math.min(Number(remainingMidStay[key] || 0), Math.max(0, lineTotal)) : 0;
    if (key && midStay > 0) remainingMidStay[key] = round2(Number(remainingMidStay[key]) - midStay);
    const total = Math.max(0, round2(lineTotal - midStay));
    if (Number(line.inComplement || 0) === 1) return sum + total;
    if (Number(line.offered || 0) === 1) return sum;
    const acompte = nz(line.acompteContribTtc);
    const solde = nz(line.soldeContribTtc);
    const delta = Math.max(0, total - acompte - solde);
    return sum + delta;
  }, 0);
}

function sumContribField(lines, field) {
  return (lines || []).reduce((sum, line) => sum + nz(line[field]), 0);
}

// The split the core stamped on a collected complement (utils/complementPaidSplit.js), in euros; null when absent,
// unreadable, or no longer adding up to the entry. Parsed here so the export asks nothing new of an older core.
function parseComplementPaidSplit(row, encaissementTtc) {
  if (!row.complementPaidSplit) return null;
  let split;
  try { split = JSON.parse(row.complementPaidSplit); } catch { return null; }
  const keys = ['taxCents', 'accommodationCents', 'optionsCents', 'resourcesCents'];
  if (!split || !keys.every((k) => Number.isInteger(split[k]))) return null;
  if (keys.reduce((sum, k) => sum + split[k], 0) !== Math.round(Number(encaissementTtc) * 100)) return null;
  return {
    tax: split.taxCents / 100,
    accommodation: split.accommodationCents / 100,
    options: split.optionsCents / 100,
    resources: split.resourcesCents / 100,
  };
}

// The `paidSplit` JSON the core stores on a collected installment (utils/installmentPaidSplit.js);
// anything unreadable reads as « no frozen split ».
function parsePaidSplit(raw) {
  if (!raw) return null;
  try {
    const split = JSON.parse(raw);
    const keys = ['taxCents', 'accommodationCents', 'optionsCents', 'resourcesCents'];
    return split && keys.every((k) => Number.isInteger(split[k])) ? split : null;
  } catch {
    return null;
  }
}

function nz(value) { return value == null ? 0 : Number(value); }
function round2(value) { return Math.round(Number(value || 0) * 100) / 100; }

// Build a bucket from a TTC contribution: extract HT/VAT using the bucket's rate.
function bucketFromTtc(name, ttc, ratePercent) {
  if (!ttc || ttc <= 0) return { name, ht: 0, vat: 0, ratePercent: Number(ratePercent || 0) };
  const rate = Number(ratePercent || 0);
  const { vat, net: ht } = splitTtc(ttc, rate);
  return { name, ht, vat, ratePercent: rate };
}

// The gross-up of a platform stay: what the guest actually paid against what the schedule stores, and the commission that
// follows (specs/accounting-encaissement-effective-percent.md). Cut out of the entry builder, body unchanged.
function legacyGrossUp(row, { finalPriceTtc, touristTaxTotal, enteredCommissionTtc, adjustedComplementAuto }) {
  let effectiveGross;
  let commissionTtcTotal;
  let grossRatio;
  if (enteredCommissionTtc > 0) {
    // Entered-commission model: the guest pays the schedule GROSS (deposit + balance + complement =
    // finalPrice + tourist tax — what the current engine stores); the commission is operator-entered
    // per échéance. `grossRatio` grosses the stored amounts up to what the guest actually paid:
    // (finalPrice + touristTaxTotal) / storedSum. For every current-model reservation that's exactly
    // 1 → stored amounts pass through UNSCALED. Prod bug 2026-07-15 (resa #22224, Berg): the old
    // numerator was bare `finalPrice`, so a tax-in-schedule reservation had ratio 131,28/134,26 and
    // its 67,13 € acompte displayed as 65,64 €. Rows from the « solde = net » era (sum = finalPrice −
    // commission, e.g. prod #7) keep a ratio > 1 and gross up to the guest-paid total, as before.
    commissionTtcTotal = enteredCommissionTtc;
    effectiveGross = finalPriceTtc;
    // specs/adjustable-complement-amounts.md §3.6 rule 37 — the gross-up exists to repair two
    // HISTORICAL schedule shapes, not to react to an operator decision. An adjusted complement is a
    // deliberate deviation from the schedule, so the denominator keeps the complement the engine
    // produced: without this, lowering a complement would re-inflate its own entry AND the acompte
    // and solde entries of the same reservation.
    const scheduledComplement = adjustedComplementAuto != null
      ? adjustedComplementAuto
      : (Number(row.complementAmount) || 0);
    // specs/accounting-books-the-money-collected.md rules 1-2 — the end-of-stay complement is scheduled
    // money too. Leaving it out made the denominator short by whatever was sold mid-stay, so every entry
    // of such a stay was grossed up by that amount (Marchand #22275: +29,42 € of CA, +25,47 € on the
    // client's debit) and cash-settled complements leaked back into the books through the same ratio.
    const scheduledTotal = round2((Number(row.depositAmount) || 0) + (Number(row.balanceAmount) || 0)
      + scheduledComplement + (Number(row.endOfStayComplementAmount) || 0));
    const expectedTotal = round2(finalPriceTtc + touristTaxTotal);
    // The ratio grosses amounts up in ONE case only: the legacy « solde = net » shape, where the stored
    // schedule is the total minus the commission (réservation #7 books 994 € of CA against a 903 €
    // transfer). A schedule that already sums to the total is booked verbatim, and so is a DRIFTED one
    // — a fiche/total inconsistency is never resolved by inventing revenue.
    const isLegacyNetSchedule = scheduledTotal > 0
      && Math.abs(scheduledTotal - expectedTotal) > 0.02
      && Math.abs(round2(scheduledTotal + commissionTtcTotal) - expectedTotal) <= 0.02;
    grossRatio = isLegacyNetSchedule ? expectedTotal / scheduledTotal : 1;
  } else {
    // LEGACY fallback: commission derived from the stored `clientGrossAmount` (> net); the stored amounts
    // summed to finalPrice (not reduced), so the ratio grosses them up to the gross.
    effectiveGross = Math.max(
      finalPriceTtc,
      Number(row.clientGrossAmount != null ? row.clientGrossAmount : finalPriceTtc) || 0,
    );
    commissionTtcTotal = round2(Math.max(0, effectiveGross - finalPriceTtc));
    grossRatio = finalPriceTtc > 0 ? effectiveGross / finalPriceTtc : 1;
  }
  return { effectiveGross, commissionTtcTotal, grossRatio };
}

// specs/accountant-accounting-export.md rules 33 and 35 — the first payment day the rule 32 split applies
// to: the first day of the month after this version was installed (`ttcSplitFrom`, stored by the
// plugin's migration). The months before were exported with HT and VAT prorated separately;
// re-exporting them must give the accountant the same cents.
// The HT and VAT an encaissement credits on one bucket, before the residue its last credit absorbs. Also read by
// accountingModel: a cancellation netted of earlier refunds mirrors what the paid solde booked
// (specs/payment-schedule-and-cancellation.md rule 55).
function bookedBucketSplit(entry, bucket, splitFrom = TTC_SPLIT_FALLBACK) {
  const fraction = entry.fraction;
  const rate = Number(bucket.ratePercent) || 0;
  const split = String(entry.paidDate || '') >= splitFrom && fraction !== 1 && rate > 0 && (bucket.vat || 0) > 0;
  const ttc = round2(((bucket.ht || 0) + (bucket.vat || 0)) * fraction);
  const ht = split ? netFirst(ttc, rate).net : round2((bucket.ht || 0) * fraction);
  const vat = split ? round2(ttc - ht) : round2((bucket.vat || 0) * fraction);
  return { ht, vat };
}

// The net of a TTC amount at a rate, 0 % leaving it whole (an indemnity or a sale made outside any stay): the one cut the
// entries and the CSV rows of those two share.
function netOfTtc(ttc, rate) {
  return rate > 0 ? netFirst(ttc, rate).net : ttc;
}

module.exports = {
  computeBucketTtcsFromContribs,
  computeTaxTtcForKind,
  soldeCaptureMatches,
  legacyGrossUp,
  parseComplementPaidSplit,
  parsePaidSplit,
  bookedBucketSplit,
  bucketFromTtc,
  netOfTtc,
  nz,
  round2,
  TTC_SPLIT_FALLBACK,
  CONTRIB_RESIDUE_TOLERANCE_TTC,
};
