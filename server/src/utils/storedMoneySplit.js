/**
 * The stored-money split of an encaissement (specs/accounting-books-the-money-collected.md rules 5-7), shared by
 * the accounting export and the cancellation (specs/payment-schedule-and-cancellation.md rule 55).
 *
 * An acompte or a solde paid before the per-line contribs existed (or whose contribs do not describe it) is booked
 * on the postes it covers, pro rata within its destination: the accommodation and the extras collected before
 * arrival. The export reads that split to credit 706; the cancellation reads the very same split to reverse it, so
 * the avoir of a legacy acompte lands on the sub-accounts the acompte was credited on.
 */

const { resolveMidStaySplit, storedMidStayLines, extraLineKey } = require('./midStayExtras');
const { parseRemovedLineContribs } = require('./removedLineContribs');

function nz(value) { return value == null ? 0 : Number(value); }
function round2(value) { return Math.round(Number(value || 0) * 100) / 100; }

// Read the per-line contribs + current totals for one reservation. Used by `buildEntry` to
// drive the contrib-based per-bucket attribution (spec force-item-to-complement.md §5).
function buildPerLineData(database, row) {
  const optionLines = database.prepare(`
    SELECT optionId, totalPrice, COALESCE(offered, 0) AS offered,
      COALESCE(inComplement, 0) AS inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_options WHERE reservationId = ?
  `).all(row.id);
  const customOptionLines = database.prepare(`
    SELECT id AS customOptionId, description AS title,
      CASE WHEN COALESCE(offered, 0) = 1 THEN 0 ELSE amount END AS totalPrice,
      COALESCE(offered, 0) AS offered,
      COALESCE(inComplement, 0) AS inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_custom_options WHERE reservationId = ?
  `).all(row.id);
  const resourceLines = database.prepare(`
    SELECT resourceId, totalPrice, COALESCE(offered, 0) AS offered,
      COALESCE(inComplement, 0) AS inComplement, acompteContribTtc, soldeContribTtc
    FROM reservation_resources WHERE reservationId = ?
  `).all(row.id);

  // specs/accounting-books-the-money-collected.md rule 17 (D11) — a paid line since removed still holds what its entries
  // booked: it reads as a line billed 0 €, so it weighs on no total and no destination.
  const removed = parseRemovedLineContribs(row.removedLineContribs).map((entry) => ({
    totalPrice: 0, offered: 0, inComplement: 0, acompteContribTtc: entry.acompteContribTtc, soldeContribTtc: entry.soldeContribTtc, bucket: entry.bucket,
  }));
  const removedOptions = removed.filter((entry) => entry.bucket !== 'resources');
  const removedResources = removed.filter((entry) => entry.bucket === 'resources');

  // Any non-NULL contrib anywhere on the reservation → use the contrib path; else legacy.
  const hasContribs = [
    row.accommodationAcompteContribTtc, row.accommodationSoldeContribTtc,
    row.touristTaxAcompteContribTtc, row.touristTaxSoldeContribTtc,
    ...optionLines.flatMap((l) => [l.acompteContribTtc, l.soldeContribTtc]),
    ...customOptionLines.flatMap((l) => [l.acompteContribTtc, l.soldeContribTtc]),
    ...resourceLines.flatMap((l) => [l.acompteContribTtc, l.soldeContribTtc]),
    ...removed.flatMap((l) => [l.acompteContribTtc, l.soldeContribTtc]),
  ].some((v) => v != null);

  // Current accommodation TTC = finalPrice − options − resources. Same shape as
  // `forceItemContribsCapture.js → computeAccommodationTtc`.
  const optionsCurrentTotal = (optionLines.reduce((s, l) => s + nz(l.totalPrice), 0))
    + (customOptionLines.reduce((s, l) => s + nz(l.totalPrice), 0));
  const resourcesCurrentTotal = resourceLines.reduce((s, l) => s + nz(l.totalPrice), 0);
  const accommodationTtcCurrent = Math.max(0, round2(Number(row.finalPrice || 0) - optionsCurrentTotal - resourcesCurrentTotal));

  // specs/mid-stay-extras-to-end-of-stay-complement.md §3.4 rule 16 — the part of a line sold DURING
  // the stay is billed by the flat `endOfStayComplement` entry, so it must leave the `complement`
  // entry: otherwise that entry credits option revenue its (frozen) debit doesn't carry.
  const midStay = resolveMidStaySplit(
    [...optionLines, ...customOptionLines.map((l) => ({ ...l, isCustom: true })), ...resourceLines],
    {
      baseline: row.arrivalExtrasBaseline,
      settled: Number(row.endOfStayComplementPaid || 0) === 1 || Number(row.endOfStayComplementPaidCash || 0) === 1,
      storedLines: storedMidStayLines(row.endOfStayComplementDetail),
    },
  );

  return {
    optionLines: [...optionLines, ...removedOptions],
    customOptionLines,
    resourceLines: [...resourceLines, ...removedResources],
    hasContribs,
    accommodationTtcCurrent,
    midStayByKey: midStay.byKey,
    optionsTtc: round2(optionsCurrentTotal),
    resourcesTtc: round2(resourcesCurrentTotal),
    destinations: splitByDestination({ optionLines, customOptionLines, resourceLines }, midStay.byKey),
  };
}

// Where each billed line is COLLECTED (specs/accounting-books-the-money-collected.md rule 5). One line
// belongs to exactly one encaissement: pre-arrival (acompte + solde), arrival complement, or — for the
// share sold during the stay — the flat end-of-stay complement, which bills it separately.
//
// This is what lets an entry credit the extras it actually carries instead of a pro-rata slice of every
// line on the reservation. Offered lines (0 €) are skipped: they can never be billed anywhere.
function splitByDestination({ optionLines, customOptionLines, resourceLines }, midStayByKey) {
  const remainingMidStay = { ...(midStayByKey || {}) };
  const totals = { preArrivalOptions: 0, preArrivalResources: 0, complementOptions: 0, complementResources: 0 };

  const classify = (lines, { isCustom = false, isResource = false } = {}) => {
    for (const line of (lines || [])) {
      if (Number(line.offered || 0) === 1) continue;
      const lineTotal = Math.max(0, nz(line.totalPrice));
      if (lineTotal === 0) continue;
      // The mid-stay share is consumed as it is deducted, so two lines sharing a key split it.
      const key = extraLineKey(isCustom ? { ...line, isCustom: true } : line);
      const midStay = key ? Math.min(nz(remainingMidStay[key]), lineTotal) : 0;
      if (key && midStay > 0) remainingMidStay[key] = round2(nz(remainingMidStay[key]) - midStay);
      const collectedHere = round2(lineTotal - midStay);
      if (collectedHere <= 0) continue; // sold entirely mid-stay → billed by the end-of-stay entry
      const inComplement = Number(line.inComplement || 0) === 1;
      const bucket = inComplement
        ? (isResource ? 'complementResources' : 'complementOptions')
        : (isResource ? 'preArrivalResources' : 'preArrivalOptions');
      totals[bucket] = round2(totals[bucket] + collectedHere);
    }
  };

  classify(optionLines);
  classify(customOptionLines, { isCustom: true });
  classify(resourceLines, { isResource: true });
  return totals;
}
// The postes an entry of `kind` collects on the stored-money path, TTC, whole (the export pro-rates them by
// `revenue / Σ`): the accommodation and the pre-arrival extras for an acompte or a solde, the forced extras for an
// arrival complement.
function storedMoneyCollected(kind, finalPrice, perLineData) {
  const optionsTtc = perLineData ? Number(perLineData.optionsTtc || 0) : 0;
  const resourcesTtc = perLineData ? Number(perLineData.resourcesTtc || 0) : 0;
  const accommodationTtc = Math.max(0, round2(Number(finalPrice || 0) - optionsTtc - resourcesTtc));
  const destinations = (perLineData && perLineData.destinations) || null;
  // Callers that don't model the line destinations (legacy unit tests): the whole reservation is one destination.
  return kind === 'complement'
    ? {
      accommodation: 0,
      options:   destinations ? destinations.complementOptions   : optionsTtc,
      resources: destinations ? destinations.complementResources : resourcesTtc,
    }
    : {
      accommodation: accommodationTtc,
      options:   destinations ? destinations.preArrivalOptions   : optionsTtc,
      resources: destinations ? destinations.preArrivalResources : resourcesTtc,
    };
}

const BUCKETS = ['accommodation', 'options', 'resources'];

// The TTC each bucket of a stored-money entry carries, with the export's own rounding (accountingExport
// `rowsAtDefaults`: the bucket split at its rate, then `round2((HT + VAT) × fraction)`). The cents those roundings
// leave — the export puts them on its last credit — go to the largest bucket, so the buckets add up to `revenueTtc`.
function storedMoneyBucketTtcs(collected, revenueTtc, ratePercent) {
  const revenueCents = Math.round(Math.max(0, Number(revenueTtc) || 0) * 100);
  const total = round2(BUCKETS.reduce((sum, bucket) => sum + nz(collected && collected[bucket]), 0));
  const out = { accommodation: 0, options: 0, resources: 0 };
  if (revenueCents <= 0) return out;
  if (total <= 0) return { ...out, accommodation: revenueCents / 100 };
  const fraction = (revenueCents / 100) / total;
  const rate = Number(ratePercent || 0);
  const cents = BUCKETS.map((bucket) => {
    const ttc = nz(collected[bucket]);
    if (ttc <= 0) return 0;
    const vat = round2(ttc * (rate / (100 + rate)));
    return Math.round(round2((round2(ttc - vat) + vat) * fraction) * 100);
  });
  const largest = cents.indexOf(Math.max(...cents));
  cents[largest] += revenueCents - cents.reduce((sum, c) => sum + c, 0);
  BUCKETS.forEach((bucket, index) => { out[bucket] = cents[index] / 100; });
  return out;
}

/** The buckets a stored-money acompte or solde of `revenueTtc` (tax excluded) was booked on, read from the stay. */
function storedMoneyBuckets(database, row, { kind, revenueTtc, vatRate }) {
  return storedMoneyBucketTtcs(storedMoneyCollected(kind, row.finalPrice, buildPerLineData(database, row)), revenueTtc, vatRate);
}

module.exports = { buildPerLineData, splitByDestination, storedMoneyCollected, storedMoneyBucketTtcs, storedMoneyBuckets };
