/**
 * The accounting split of the arrival complement, frozen the moment it is collected
 * (specs/accounting-books-the-money-collected.md rule 16, audit R22-6a, 2026-11-05).
 *
 * A complement's entry was derived live from the lines and the tax, so any later save rewrote it, possibly in a month
 * the accountant already imported: the tax that rose ate its revenue, a party change sent it from the accommodation to
 * the prestations. What it collected is therefore computed once, here, with the export's own rules as they read at the
 * flip, and stored on the stay (`reservations.complementPaidSplit`, JSON, the same shape as an installment's `paidSplit`):
 *
 *   { taxCents, accommodationCents, optionsCents, resourcesCents, lines: [{ key, label, bucket, cents }] }
 *
 * They add up to the complement. `lines` names what each line collected. What rises afterwards is
 * claimed at the end of stay (mid-stay-extras rule 20). NULL on a complement collected before the column, or adjusted by
 * the operator (his stored allocation decides, specs/adjustable-complement-amounts.md §3.6): those read as they did.
 */

const { buildPerLineData } = require('./storedMoneySplit');
const { parseComplementAllocation } = require('./complementAllocation');
const { extraLineKey } = require('./midStayExtras');
const { taxRidesTheComplement } = require('./touristTaxFreeze');

// The rounding the export absorbs on the last credit of a contrib-driven entry.
const RESIDUE_TOLERANCE_CENTS = 2;

const { toCents: cents } = require('./pricing/money');
const nz = (value) => (value == null ? 0 : Number(value));

function allLines(db, perLine) {
  const titleOf = (sql, id) => (id == null ? '' : (db.prepare(sql).get(id) || {}).label || '');
  return [
    ...perLine.optionLines.map((line) => ({ ...line, bucket: 'options', label: titleOf('SELECT title AS label FROM options WHERE id = ?', line.optionId) })),
    ...perLine.customOptionLines.map((line) => ({ ...line, bucket: 'options', isCustom: true, label: line.title })),
    ...perLine.resourceLines.map((line) => ({ ...line, bucket: 'resources', label: titleOf('SELECT name AS label FROM resources WHERE id = ?', line.resourceId) })),
  ];
}

// The solde's contribs add up to it: its tax is known (accountingModel `soldeCaptureMatches`).
function soldeFrozenTax(row, lines) {
  if (Number(row.balancePaid || 0) !== 1 || row.touristTaxSoldeContribTtc == null || row.accommodationSoldeContribTtc == null) return null;
  const captured = nz(row.accommodationSoldeContribTtc) + nz(row.touristTaxSoldeContribTtc) + lines.reduce((sum, line) => sum + nz(line.soldeContribTtc), 0);
  if (Math.abs(cents(captured) - cents(row.balanceAmount)) > RESIDUE_TOLERANCE_CENTS) return null;
  return cents(nz(row.touristTaxAcompteContribTtc) + nz(row.touristTaxSoldeContribTtc));
}

function complementTaxCents(db, row, lines, amountCents) {
  const total = cents(row.touristTaxTotal);
  if (taxRidesTheComplement(db, row)) {
    return Math.min(Math.max(0, total - cents(row.touristTaxAcompteContribTtc) - cents(row.touristTaxSoldeContribTtc)), amountCents);
  }
  const frozen = soldeFrozenTax(row, lines);
  return Math.min(frozen != null ? Math.max(0, total - frozen) : cents(row.touristTaxAddedGuestsAmount), amountCents);
}

// What the entry reads per line when the contribs describe it: the forced lines whole (their share sold during the stay
// apart), the others' growth since the acompte and the solde, the accommodation's too.
function contribSplit(row, perLine, lines, revenueCents) {
  if (!perLine.hasContribs) return null;
  const midStayLeft = { ...(perLine.midStayByKey || {}) };
  const collected = [];
  for (const line of lines) {
    if (Number(line.offered || 0) === 1) continue;
    const key = extraLineKey(line);
    if (!key) continue;
    const total = nz(line.totalPrice);
    const midStay = Math.min(nz(midStayLeft[key]), Math.max(0, total));
    if (midStay > 0) midStayLeft[key] = nz(midStayLeft[key]) - midStay;
    const net = Math.max(0, total - midStay);
    const amount = cents(Number(line.inComplement || 0) === 1 ? net : Math.max(0, net - nz(line.acompteContribTtc) - nz(line.soldeContribTtc)));
    if (amount > 0) collected.push({ key, label: String(line.label || ''), bucket: line.bucket, cents: amount });
  }
  const accommodationCents = cents(Math.max(0, perLine.accommodationTtcCurrent - nz(row.accommodationAcompteContribTtc) - nz(row.accommodationSoldeContribTtc)));
  const linesCents = collected.reduce((sum, line) => sum + line.cents, 0);
  if (Math.abs(accommodationCents + linesCents - revenueCents) > RESIDUE_TOLERANCE_CENTS) return null;
  return { accommodationCents, collected };
}

// The stored-money path: the added guests' supplement and the lines forced here, pro rata of the revenue. Money with
// nothing to attach it to is what the accommodation gained when it did (a solde paid before its acompte), else a
// prestation (rule 10).
function storedSplit(row, perLine, lines, revenueCents) {
  const surcharge = cents(row.extraGuestComplementSurcharge);
  const options = cents(perLine.destinations.complementOptions);
  const resources = cents(perLine.destinations.complementResources);
  const base = surcharge + options + resources;
  if (base <= 0) {
    const accommodationGrowth = cents(Math.max(0, perLine.accommodationTtcCurrent - nz(row.accommodationAcompteContribTtc) - nz(row.accommodationSoldeContribTtc)));
    return accommodationGrowth >= revenueCents
      ? { accommodationCents: revenueCents, optionsCents: 0, resourcesCents: 0, collected: [] }
      : { accommodationCents: 0, optionsCents: revenueCents, resourcesCents: 0, collected: [] };
  }
  const optionsCents = Math.round((revenueCents * options) / base);
  const resourcesCents = Math.round((revenueCents * resources) / base);
  // Each bucket's money over its forced lines, the first taking the rounding: the split always names its lines.
  const forcedOf = (bucket) => lines.filter((line) => line.bucket === bucket && Number(line.inComplement || 0) === 1
    && Number(line.offered || 0) !== 1 && nz(line.totalPrice) > 0 && extraLineKey(line));
  const shareOut = (bucket, bucketCents, bucketBase) => {
    const forced = forcedOf(bucket);
    const shares = forced.map((line) => ({ key: extraLineKey(line), label: String(line.label || ''), bucket, cents: bucketBase > 0 ? Math.round((bucketCents * cents(line.totalPrice)) / bucketBase) : 0 }));
    if (shares.length) shares[0].cents += bucketCents - shares.reduce((sum, line) => sum + line.cents, 0);
    return shares.filter((line) => line.cents > 0);
  };
  return {
    accommodationCents: revenueCents - optionsCents - resourcesCents,
    optionsCents,
    resourcesCents,
    collected: [...shareOut('options', optionsCents, options), ...shareOut('resources', resourcesCents, resources)],
  };
}

function computeComplementPaidSplit(db, reservationId) {
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(reservationId));
  if (!row) return null;
  const amountCents = cents(row.complementAmount);
  if (amountCents <= 0 || parseComplementAllocation(row.complementAllocation)) return null;
  const perLine = buildPerLineData(db, row);
  const lines = allLines(db, perLine);
  const taxCents = complementTaxCents(db, row, lines, amountCents);
  const revenueCents = amountCents - taxCents;
  const fromContribs = contribSplit(row, perLine, lines, revenueCents);
  if (fromContribs) {
    const inBucket = (bucket) => fromContribs.collected.filter((line) => line.bucket === bucket).reduce((sum, line) => sum + line.cents, 0);
    const optionsCents = inBucket('options');
    const resourcesCents = inBucket('resources');
    return {
      taxCents,
      // The rounding cents the export would put on its last credit: on the accommodation, the largest.
      accommodationCents: revenueCents - optionsCents - resourcesCents,
      optionsCents,
      resourcesCents,
      lines: fromContribs.collected,
    };
  }
  const stored = storedSplit(row, perLine, lines, revenueCents);
  return {
    taxCents,
    accommodationCents: stored.accommodationCents,
    optionsCents: stored.optionsCents,
    resourcesCents: stored.resourcesCents,
    lines: stored.collected,
  };
}

const hasColumn = (db) => {
  try {
    return db.prepare('PRAGMA table_info(reservations)').all().some((column) => column.name === 'complementPaidSplit');
  } catch {
    return false;
  }
};

/**
 * Called at every flip of `complementPaid` to 1, in its transaction, once the flip is written. A complement already
 * stamped keeps its split (a switch between the books and the caisse interne moves no money). The clear is the trigger of
 * schema.sql, whatever the path that un-ticks it.
 */
function stampComplementPaidSplit(db, reservationId) {
  if (!hasColumn(db)) return;
  const row = db.prepare('SELECT complementPaid, complementPaidSplit FROM reservations WHERE id = ?').get(Number(reservationId));
  if (!row || Number(row.complementPaid || 0) !== 1 || row.complementPaidSplit) return;
  const split = computeComplementPaidSplit(db, reservationId);
  if (split) db.prepare('UPDATE reservations SET complementPaidSplit = ? WHERE id = ?').run(JSON.stringify(split), Number(reservationId));
}

/**
 * The stored split, when it still describes the complement. An amount the operator adjusted since no longer adds up:
 * it is then not read.
 */
function readComplementPaidSplit(row) {
  if (!row || !row.complementPaidSplit) return null;
  let split;
  try { split = JSON.parse(row.complementPaidSplit); } catch { return null; }
  const keys = ['taxCents', 'accommodationCents', 'optionsCents', 'resourcesCents'];
  if (!split || !keys.every((key) => Number.isInteger(split[key]))) return null;
  if (keys.reduce((sum, key) => sum + split[key], 0) !== cents(row.complementAmount)) return null;
  return split;
}

module.exports = { computeComplementPaidSplit, stampComplementPaidSplit, readComplementPaidSplit };
