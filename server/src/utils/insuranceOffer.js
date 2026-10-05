/**
 * The cancellation insurance is offered only while a live plugin prices it (specs/plugins-phase-3b-neat.md
 * rules 5, 21, 22 — decision P13). Without one:
 *   - the option lists hide it;
 *   - nothing new gets it: a payload that adds it is refused;
 *   - a line a stay or a devis already carries is kept exactly as stored, read-only, even where the
 *     devis price lock has expired.
 */

const { insuranceOffered } = require('./quotePostProcessors');
const bookingLinesModel = require('../models/bookingLinesModel');

const NOT_OFFERED = Object.freeze({
  status: 422,
  code: 'INSURANCE_NOT_OFFERED',
  error: 'L’assurance annulation n’est pas proposée sans le plugin Neat.',
});
const READ_ONLY_REASON = 'Lecture seule : plugin Neat inactif';

// A partial schema (test databases, a database older than the insurance) has no insurance to gate.
function insuranceOptionId(db) {
  try {
    const row = db.prepare('SELECT id FROM options WHERE isCancellationInsurance = 1 ORDER BY id LIMIT 1').get();
    return row ? Number(row.id) : null;
  } catch {
    return null;
  }
}

const isInsurance = (option) => Number(option && option.isCancellationInsurance ? 1 : 0) === 1;

/** Rule 21 — an option list without the insurance while it is not offered. */
function hideInsurance(options, offered = insuranceOffered()) {
  if (offered || !Array.isArray(options)) return options;
  return options.filter((o) => !isInsurance(o));
}

function storedLine(db, bookingId, optionId) {
  if (!bookingId || !optionId) return null;
  return db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(Number(bookingId), optionId) || null;
}

/**
 * Rule 5 — the engine input of a quote or a save while the insurance is not offered.
 * `bookingId` is the stored reservation or devis being priced (0/undefined for a new one).
 * Returns `{ selectedOptions, lockedOptionLines }`, or `{ error }` (422) when the payload adds the
 * insurance to a booking that does not carry it. On a booking that carries it, everything about the
 * line is the stored one — quantity, complement, price lock and « offert » (`optionId`,
 * `offeredStored`), whatever the payload says.
 */
function gateSelection({ db, bookingId, selectedOptions, lockedOptionLines, offered = insuranceOffered() }) {
  const unchanged = { selectedOptions, lockedOptionLines };
  if (offered) return unchanged;
  const optionId = insuranceOptionId(db);
  if (!optionId) return unchanged;
  const list = Array.isArray(selectedOptions) ? selectedOptions : [];
  const incoming = list.find((o) => Number(o.optionId) === optionId);
  const stored = storedLine(db, bookingId, optionId);
  if (!stored) return incoming ? { error: NOT_OFFERED } : unchanged;

  const kept = {
    ...(incoming || {}),
    optionId,
    quantity: Number(stored.quantity || 1),
    inComplement: Number(stored.inComplement || 0) === 1,
  };
  // The lock is always the stored one: a preview's body cannot price the line differently from the save.
  const otherLocks = (Array.isArray(lockedOptionLines) ? lockedOptionLines : []).filter((l) => Number(l.optionId) !== optionId);
  const storedLock = (bookingLinesModel.buildModel(db).getPricingSnapshot(Number(bookingId)).lockedOptionLines || [])
    .find((l) => Number(l.optionId) === optionId);
  const locks = storedLock ? [...otherLocks, storedLock] : otherLocks;
  return {
    selectedOptions: [...list.filter((o) => Number(o.optionId) !== optionId), kept],
    lockedOptionLines: Array.isArray(lockedOptionLines) || storedLock ? locks : lockedOptionLines,
    optionId,
    offeredStored: Number(stored.offered || 0) === 1,
  };
}

/** The engine's `offeredOptionIds` with the stored line's « offert » in place of the payload's. */
function freezeOffered(offeredOptionIds, gate) {
  if (!gate || !gate.optionId) return offeredOptionIds;
  const others = (offeredOptionIds || []).map(Number).filter((n) => n !== gate.optionId);
  return gate.offeredStored ? [...others, gate.optionId] : others;
}

/** Option lists of a create path: a default the property would add is simply not added. */
function dropInsurance(db, selectedOptions, offered = insuranceOffered()) {
  if (offered || !Array.isArray(selectedOptions)) return selectedOptions;
  const optionId = insuranceOptionId(db);
  return optionId ? selectedOptions.filter((o) => Number(o.optionId) !== optionId) : selectedOptions;
}

/**
 * Rule 22 — the catalogue entries of the options a stored booking carries but the catalogue now hides,
 * marked read-only so the fiche draws the tile without its switch.
 */
function frozenOptions(db, bookingId, offered = insuranceOffered()) {
  if (offered || !bookingId) return [];
  const optionId = insuranceOptionId(db);
  if (!optionId || !storedLine(db, bookingId, optionId)) return [];
  const option = db.prepare('SELECT * FROM options WHERE id = ?').get(optionId);
  return option ? [{ ...option, readOnly: true, readOnlyReason: READ_ONLY_REASON }] : [];
}

module.exports = {
  NOT_OFFERED, READ_ONLY_REASON, insuranceOptionId, hideInsurance, gateSelection, freezeOffered, dropInsurance, frozenOptions,
};
