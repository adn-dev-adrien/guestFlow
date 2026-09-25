/**
 * « Is this resource the cot? » — the one predicate, for every reader
 * (specs/translation-catalogue.md rule 22).
 *
 * The cot is a resource like any other in the database, but the booking funnel treats it apart: it is
 * couchage, driven by the `babyBeds` stepper, not a tickable supplement. Something therefore has to
 * recognise it, and until the catalogue arrived everything recognised it by its French name — which
 * worked exactly as long as every reader saw French. The public API now serves « Baby bed » to an
 * English page, and the widget's name test stopped matching: the cot reappeared among the extras,
 * offered whatever the number of babies.
 *
 * So the name is matched HERE, once, on the row as it is stored — never on a projected payload, whose
 * `name` is whatever language was asked for. What leaves the building is a flag (`isBabyBed`), the
 * same way `isCancellationInsurance` already spares the site from keying on a title.
 */

/** The names the seeder has used. Matched accent-insensitively: a hand-typed « Lit bebe » is one too. */
const BABY_BED_NAMES = Object.freeze(['lit bebe']);

function normalise(name) {
  return String(name == null ? '' : name)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * @param {{name?: string}|string} row  A resource row, or a bare name.
 * @returns {boolean}
 */
function isBabyBedResource(row) {
  const name = typeof row === 'string' ? row : (row && row.name);
  return BABY_BED_NAMES.includes(normalise(name));
}

module.exports = { isBabyBedResource, BABY_BED_NAMES };
