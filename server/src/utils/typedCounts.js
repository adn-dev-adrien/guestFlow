/**
 * Typed counts that no longer match the stay (specs/non-card-option-served-persons.md rules 20-23).
 *
 * A number of people or of nights typed by the operator stays frozen when the party or the dates
 * change: it is never extrapolated. The operator must then be told, so this says which lines to flag.
 * Pure — the engine's quote lines, the request's lines and the stored party come in as arguments.
 */

// The engine's head count: babies never count, and a reservation has at least one adult.
function partyOf(row) {
  return (Number(row?.adults) || 1) + (Number(row?.teens) || 0) + (Number(row?.children) || 0);
}

function nightsOf(row) {
  const span = Math.round((new Date(row?.endDate) - new Date(row?.startDate)) / 86400000);
  return Number.isFinite(span) && span > 0 ? span : 0;
}

// The count a non-card line's field shows, read from what it bills. Null for a price type with none.
function typedCountOf({ priceType, billedUnits }, stay) {
  if (priceType === 'per_person' || priceType === 'per_night') return Number(billedUnits);
  if (priceType !== 'per_person_per_night') return null;
  const nights = nightsOf(stay);
  return nights > 0 ? Number(billedUnits) / nights : null;
}

// The figure a reader prints for a line (rule 29): the count the fiche's field shows, read from what the
// line bills. A card line counts its moments and the insurance covers the stay, so both keep `quantity`,
// as does any line with no count of its own.
function displayCountOf(line, stay, { isCard = false, isInsurance = false } = {}) {
  const quantity = Number(line?.quantity || 0);
  if (isCard || isInsurance) return quantity;
  const count = typedCountOf(line, stay);
  return Number.isFinite(count) && count > 0 ? Math.round(count * 100) / 100 : quantity;
}

const unitLabel = (kind, n) => (kind === 'nights'
  ? `${n} nuit${n > 1 ? 's' : ''}`
  : `${n} personne${n > 1 ? 's' : ''}`);

function alertFor(line, kind, typed, reference, current) {
  return {
    optionId: Number(line.optionId),
    title: line.title || 'Option',
    kind,
    typed,
    reference,
    current,
    label: `Saisi pour ${unitLabel(kind, reference)}, ${kind === 'nights' ? 'séjour' : 'groupe'} : ${current}`,
    applyLabel: `Appliquer ${unitLabel(kind, current)}`,
  };
}

/**
 * @param {object} params
 *        quoteLines   — the engine's `optionLines`, carrying what it decided to store;
 *        requestLines — the submitted lines, with the form-local `typedAtParty` / `typedAtNights`
 *                       (rule 23: a line typed during this edit is measured against that);
 *        persons, nights — the party and stay being saved;
 *        storedPersons, storedNights — what is in the database, null on a fresh fiche.
 * @returns {Array<{optionId, title, kind: 'persons'|'nights', typed, reference, current, label, applyLabel}>}
 */
function typedCountAlerts({
  quoteLines = [], requestLines = [], persons, nights, storedPersons = null, storedNights = null,
} = {}) {
  const requested = new Map((requestLines || []).map((line) => [Number(line?.optionId), line]));
  const alerts = [];
  for (const line of quoteLines || []) {
    if (line?.isCustom || line?.optionId == null) continue;
    const asked = requested.get(Number(line.optionId));
    if (line.cardPersons != null) {
      const reference = Number(asked?.typedAtParty) > 0 ? Number(asked.typedAtParty) : storedPersons;
      if (reference != null && reference !== persons && Number(line.cardPersons) !== persons) {
        alerts.push(alertFor(line, 'persons', Number(line.cardPersons), reference, persons));
      }
    }
    if (line.cardNights != null) {
      const reference = Number(asked?.typedAtNights) > 0 ? Number(asked.typedAtNights) : storedNights;
      if (reference != null && reference !== nights && Number(line.cardNights) !== nights) {
        alerts.push(alertFor(line, 'nights', Number(line.cardNights), reference, nights));
      }
    }
  }
  return alerts;
}

// The 409 of a save (rule 22): what the fiche's confirm dialog prints.
function typedCountsErrorPayload(alerts) {
  const lines = alerts.map((alert) => `${alert.title} : ${alert.typed}. ${alert.label}.`);
  return { error: lines.join(' '), code: 'TYPED_COUNTS_STALE', lines: alerts };
}

module.exports = { partyOf, nightsOf, typedCountOf, displayCountOf, typedCountAlerts, typedCountsErrorPayload };
