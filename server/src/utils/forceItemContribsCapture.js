/**
 * Per-line per-bucket contribution capture (spec force-item-to-complement.md).
 *
 * Captures `acompteContribTtc` / `soldeContribTtc` snapshots on a reservation's child lines +
 * reservation-level `accommodation*ContribTtc` / `touristTax*ContribTtc` at each
 * `depositPaid` / `balancePaid` 0→1 flip. The snapshot freezes the per-bucket attribution at
 * the moment the encaissement is recorded, so the accounting export keeps reading the original
 * numbers even if a line's price grows afterwards (= no cross-contamination).
 *
 * Distribution rules:
 *   - Forced lines (`inComplement = 1`) keep their contribs NULL — they live 100 % in the
 *     Complément entry, never in Acompte / Solde.
 *   - Offered lines (`totalPrice = 0`) contribute 0 — captured as 0, not NULL, so the
 *     conservation invariant still sums cleanly.
 *   - Non-forced, non-offered lines on the deposit flip: `totalPrice × depositPercent`, where
 *     `depositPercent = depositAmount / preArrivalAmount`.
 *   - On the balance flip: `totalPrice - acompteContribTtc` if the line already had an acompte
 *     snapshot (pre-deposit item), else `totalPrice` (item added between deposit and balance).
 *   - Conservation: SUM of captured contribs must equal the encaissement amount (depositAmount
 *     on the deposit flip, balanceAmount on the balance flip) within ±0.01 € tolerance.
 *
 * Un-flip (1→0) clears all contribs for that bucket back to NULL.
 *
 * Caller MUST wrap this together with the payment-field UPDATE in a single transaction so
 * capture + flip succeed or fail atomically.
 */

const { calculateReservationQuote } = require('./pricing');
const { buildReservationEngineInput } = require('./reservationEngineInput');

const CONSERVATION_TOLERANCE_EUR = 0.01;

function roundCents(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function computeAccommodationTtc(quote) {
  // Accommodation portion of finalPrice = finalPrice - options - resources (TTC, before tax).
  // optionsTotal already includes the offered=0 customs; resourcesTotal idem.
  const accommodation = Number(quote.finalPrice || 0) - Number(quote.optionsTotal || 0) - Number(quote.resourcesTotal || 0);
  return roundCents(Math.max(0, accommodation));
}

function isLineForced(line) {
  return Number(line?.inComplement || 0) === 1;
}

/**
 * Capture per-bucket contribs at a `depositPaid` / `balancePaid` 0→1 flip.
 * Throws if the conservation invariant is violated (caller's transaction rolls back).
 *
 * @param {object} args
 * @param {Database} args.db        better-sqlite3 connection
 * @param {object}   args.reservation Full reservation row (incl. new force-item fields)
 * @param {'deposit'|'balance'} args.bucket
 */
function captureContribsOnFlip({ db, reservation, bucket }) {
  if (bucket !== 'deposit' && bucket !== 'balance') {
    throw new Error(`Unknown bucket: ${bucket}`);
  }

  const input = buildReservationEngineInput(db, reservation);
  const quote = calculateReservationQuote(input);
  if (quote.error) {
    throw new Error(`Engine error during contrib capture: ${quote.error}`);
  }

  const encaissementAmount = bucket === 'deposit'
    ? roundCents(reservation.depositAmount || 0)
    : roundCents(reservation.balanceAmount || 0);
  const preArrivalAmount = roundCents(quote.preArrivalAmount || 0);
  // specs/tourist-tax-on-solde.md — the acompte covers the ACCOMMODATION only (no tourist tax); the whole
  // pre-arrival tax rides on the solde. So the deposit fraction is computed on `accommodationPreArrival`
  // (accommodation/options/resources, no tax) and the deposit's tax contrib is 0. Fallback to
  // preArrivalAmount for safety on quotes that predate the field.
  const accommodationPreArrival = roundCents(quote.accommodationPreArrival != null ? quote.accommodationPreArrival : (quote.preArrivalAmount || 0));

  // Bucket fraction of the non-forced pre-arrival amount. On the deposit flip this is the
  // depositPercent applied at quote time; on the balance flip it's the remainder. Both are
  // derived from the engine's `preArrivalAmount`, which already excludes forced items + the
  // complement-routed tax — so the fraction can only be > 0 for non-forced contributors.
  const taxRoutedToComplement = Boolean(quote.touristTaxCollectedOnArrival || quote.touristTaxInComplement);
  const taxFullTtc = roundCents(quote.touristTaxTotal || 0);
  const accommodationTtc = computeAccommodationTtc(quote);

  // ── DEPOSIT capture ─────────────────────────────────────────────────────
  if (bucket === 'deposit') {
    if (accommodationPreArrival <= 0) {
      // No pre-arrival amount → encaissement should be 0; trivially conserved.
      assertConservation(0, encaissementAmount, 'deposit (empty preArrival)');
      writeDepositContribs(db, reservation, quote, {
        optionLine: (line) => (isLineForced(line) ? null : (Number(line.offered) ? 0 : 0)),
        customLine: (line) => (isLineForced(line) ? null : 0),
        resourceLine: (line) => (isLineForced(line) ? null : 0),
        accommodation: 0,
        tax: taxRoutedToComplement ? 0 : 0,
      });
      return;
    }

    // specs/tourist-tax-on-solde.md — fraction of the ACCOMMODATION the acompte represents (tax excluded).
    const depositPercent = encaissementAmount / accommodationPreArrival;
    const optionContribsByOptionId = new Map();
    const customContribsByCustomId = new Map();
    const resourceContribsByResourceId = new Map();

    for (const line of quote.optionLines || []) {
      if (line.isCustom) continue;
      if (isLineForced(line)) {
        optionContribsByOptionId.set(Number(line.optionId), null);
        continue;
      }
      // Auto-options (line.optionId set, never in selectedOptions) still get a contrib so the
      // sum reconciles. Offered → totalPrice 0 → contrib 0.
      optionContribsByOptionId.set(Number(line.optionId), roundCents(Number(line.totalPrice || 0) * depositPercent));
    }
    for (const line of quote.optionLines || []) {
      if (!line.isCustom) continue;
      // Custom options must be keyed by `customOptionId`; the engine surfaces it when provided.
      if (line.customOptionId == null) continue;
      if (isLineForced(line)) {
        customContribsByCustomId.set(Number(line.customOptionId), null);
        continue;
      }
      customContribsByCustomId.set(Number(line.customOptionId), roundCents(Number(line.totalPrice || 0) * depositPercent));
    }
    for (const line of quote.resourceLines || []) {
      if (isLineForced(line)) {
        resourceContribsByResourceId.set(Number(line.resourceId), null);
        continue;
      }
      resourceContribsByResourceId.set(Number(line.resourceId), roundCents(Number(line.totalPrice || 0) * depositPercent));
    }

    const accommodationContrib = roundCents(accommodationTtc * depositPercent);
    // specs/tourist-tax-on-solde.md — the acompte never carries the tourist tax; it's 100 % on the solde.
    const taxContrib = 0;

    // Conservation: sum of all non-NULL contribs must equal encaissementAmount.
    const sumContribs = sumNonNull([
      ...optionContribsByOptionId.values(),
      ...customContribsByCustomId.values(),
      ...resourceContribsByResourceId.values(),
      accommodationContrib,
      taxContrib,
    ]);
    const drift = encaissementAmount - sumContribs;
    if (Math.abs(drift) > CONSERVATION_TOLERANCE_EUR) {
      throw new Error(`Conservation invariant violated on deposit capture: encaissement=${encaissementAmount}€, sum=${sumContribs}€, drift=${drift}€`);
    }
    // Absorb rounding drift on the accommodation contrib (largest single bucket → least relative skew).
    const adjustedAccommodation = roundCents(accommodationContrib + drift);

    applyDepositContribsToDb(db, reservation, {
      optionContribsByOptionId,
      customContribsByCustomId,
      resourceContribsByResourceId,
      accommodation: adjustedAccommodation,
      tax: taxContrib,
    });
    return;
  }

  // ── BALANCE capture ─────────────────────────────────────────────────────
  // For each non-forced line: balance = totalPrice − (acompteContribTtc || 0). If the line had
  // no acompte snapshot (added between deposit and balance), it goes 100 % in the balance.
  const optionContribsByOptionId = new Map();
  const customContribsByCustomId = new Map();
  const resourceContribsByResourceId = new Map();

  const optionDbRows = db.prepare('SELECT optionId, acompteContribTtc FROM reservation_options WHERE reservationId = ?').all(reservation.id);
  const optionAcompteByOptionId = new Map(optionDbRows.map((r) => [Number(r.optionId), r.acompteContribTtc]));
  const customDbRows = db.prepare('SELECT id as customOptionId, acompteContribTtc FROM reservation_custom_options WHERE reservationId = ?').all(reservation.id);
  const customAcompteByCustomId = new Map(customDbRows.map((r) => [Number(r.customOptionId), r.acompteContribTtc]));
  const resourceDbRows = db.prepare('SELECT resourceId, acompteContribTtc FROM reservation_resources WHERE reservationId = ?').all(reservation.id);
  const resourceAcompteByResourceId = new Map(resourceDbRows.map((r) => [Number(r.resourceId), r.acompteContribTtc]));

  for (const line of quote.optionLines || []) {
    if (line.isCustom) continue;
    if (isLineForced(line)) {
      optionContribsByOptionId.set(Number(line.optionId), null);
      continue;
    }
    const acompte = optionAcompteByOptionId.get(Number(line.optionId));
    const totalPrice = Number(line.totalPrice || 0);
    const solde = acompte == null ? totalPrice : Math.max(0, totalPrice - Number(acompte));
    optionContribsByOptionId.set(Number(line.optionId), roundCents(solde));
  }
  for (const line of quote.optionLines || []) {
    if (!line.isCustom || line.customOptionId == null) continue;
    if (isLineForced(line)) {
      customContribsByCustomId.set(Number(line.customOptionId), null);
      continue;
    }
    const acompte = customAcompteByCustomId.get(Number(line.customOptionId));
    const totalPrice = Number(line.totalPrice || 0);
    const solde = acompte == null ? totalPrice : Math.max(0, totalPrice - Number(acompte));
    customContribsByCustomId.set(Number(line.customOptionId), roundCents(solde));
  }
  for (const line of quote.resourceLines || []) {
    if (isLineForced(line)) {
      resourceContribsByResourceId.set(Number(line.resourceId), null);
      continue;
    }
    const acompte = resourceAcompteByResourceId.get(Number(line.resourceId));
    const totalPrice = Number(line.totalPrice || 0);
    const solde = acompte == null ? totalPrice : Math.max(0, totalPrice - Number(acompte));
    resourceContribsByResourceId.set(Number(line.resourceId), roundCents(solde));
  }

  const accommodationAcompte = Number(reservation.accommodationAcompteContribTtc != null ? reservation.accommodationAcompteContribTtc : 0);
  const accommodationContrib = roundCents(Math.max(0, accommodationTtc - accommodationAcompte));
  const taxAcompte = Number(reservation.touristTaxAcompteContribTtc != null ? reservation.touristTaxAcompteContribTtc : 0);
  // Tax routed to complement contributes 0 to the balance even if it grew.
  const taxContrib = taxRoutedToComplement ? 0 : roundCents(Math.max(0, taxFullTtc - taxAcompte));

  const sumContribs = sumNonNull([
    ...optionContribsByOptionId.values(),
    ...customContribsByCustomId.values(),
    ...resourceContribsByResourceId.values(),
    accommodationContrib,
    taxContrib,
  ]);
  const drift = encaissementAmount - sumContribs;
  if (Math.abs(drift) > CONSERVATION_TOLERANCE_EUR) {
    throw new Error(`Conservation invariant violated on balance capture: encaissement=${encaissementAmount}€, sum=${sumContribs}€, drift=${drift}€`);
  }
  const adjustedAccommodation = roundCents(accommodationContrib + drift);

  applyBalanceContribsToDb(db, reservation, {
    optionContribsByOptionId,
    customContribsByCustomId,
    resourceContribsByResourceId,
    accommodation: adjustedAccommodation,
    tax: taxContrib,
  });
}

/**
 * Clear all `acompteContribTtc` (deposit un-flip) or `soldeContribTtc` (balance un-flip)
 * across the reservation's children + reservation row.
 */
function clearContribsOnUnflip({ db, reservationId, bucket }) {
  const colName = bucket === 'deposit' ? 'acompteContribTtc' : 'soldeContribTtc';
  const reservationCol = bucket === 'deposit' ? 'accommodationAcompteContribTtc' : 'accommodationSoldeContribTtc';
  const reservationTaxCol = bucket === 'deposit' ? 'touristTaxAcompteContribTtc' : 'touristTaxSoldeContribTtc';
  db.prepare(`UPDATE reservation_options SET ${colName} = NULL WHERE reservationId = ?`).run(reservationId);
  db.prepare(`UPDATE reservation_custom_options SET ${colName} = NULL WHERE reservationId = ?`).run(reservationId);
  db.prepare(`UPDATE reservation_resources SET ${colName} = NULL WHERE reservationId = ?`).run(reservationId);
  db.prepare(`UPDATE reservations SET ${reservationCol} = NULL, ${reservationTaxCol} = NULL WHERE id = ?`).run(reservationId);
}

function sumNonNull(values) {
  return roundCents(values.reduce((sum, v) => sum + (v == null ? 0 : Number(v)), 0));
}

function assertConservation(sum, encaissement, label) {
  const drift = Math.abs(encaissement - sum);
  if (drift > CONSERVATION_TOLERANCE_EUR) {
    throw new Error(`Conservation invariant violated on ${label}: encaissement=${encaissement}€, sum=${sum}€, drift=${drift}€`);
  }
}

function applyDepositContribsToDb(db, reservation, contribs) {
  const upOpt = db.prepare('UPDATE reservation_options SET acompteContribTtc = ? WHERE reservationId = ? AND optionId = ?');
  for (const [optionId, value] of contribs.optionContribsByOptionId) {
    upOpt.run(value, reservation.id, optionId);
  }
  const upCustom = db.prepare('UPDATE reservation_custom_options SET acompteContribTtc = ? WHERE reservationId = ? AND id = ?');
  for (const [customOptionId, value] of contribs.customContribsByCustomId) {
    upCustom.run(value, reservation.id, customOptionId);
  }
  const upRes = db.prepare('UPDATE reservation_resources SET acompteContribTtc = ? WHERE reservationId = ? AND resourceId = ?');
  for (const [resourceId, value] of contribs.resourceContribsByResourceId) {
    upRes.run(value, reservation.id, resourceId);
  }
  db.prepare(`
    UPDATE reservations SET accommodationAcompteContribTtc = ?, touristTaxAcompteContribTtc = ? WHERE id = ?
  `).run(contribs.accommodation, contribs.tax, reservation.id);
}

function applyBalanceContribsToDb(db, reservation, contribs) {
  const upOpt = db.prepare('UPDATE reservation_options SET soldeContribTtc = ? WHERE reservationId = ? AND optionId = ?');
  for (const [optionId, value] of contribs.optionContribsByOptionId) {
    upOpt.run(value, reservation.id, optionId);
  }
  const upCustom = db.prepare('UPDATE reservation_custom_options SET soldeContribTtc = ? WHERE reservationId = ? AND id = ?');
  for (const [customOptionId, value] of contribs.customContribsByCustomId) {
    upCustom.run(value, reservation.id, customOptionId);
  }
  const upRes = db.prepare('UPDATE reservation_resources SET soldeContribTtc = ? WHERE reservationId = ? AND resourceId = ?');
  for (const [resourceId, value] of contribs.resourceContribsByResourceId) {
    upRes.run(value, reservation.id, resourceId);
  }
  db.prepare(`
    UPDATE reservations SET accommodationSoldeContribTtc = ?, touristTaxSoldeContribTtc = ? WHERE id = ?
  `).run(contribs.accommodation, contribs.tax, reservation.id);
}

// Stub used only by the (preArrivalAmount === 0) edge case above; the real write happens through
// applyDepositContribsToDb. Kept inline-named so the empty-stay branch is explicit.
function writeDepositContribs() { /* no-op: 0-eur stays never persist contribs */ }

module.exports = {
  captureContribsOnFlip,
  clearContribsOnUnflip,
  CONSERVATION_TOLERANCE_EUR,
};
