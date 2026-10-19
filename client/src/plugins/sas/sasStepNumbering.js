/**
 * « 3 sur 9 » — the SAS header's step number (specs/ui-review-2026-10-19-operations.md rule 3).
 *
 * The total counts the QUESTIONS of the run, which the reservation's data decides before the first
 * page. A page that an answer opens (missing linen, missing towels, extinguisher charges, the mornings
 * and the composition of a breakfast sold at the door, the catering catalogue, the caution reminder)
 * carries the number of the question that opened it — so the total never grows when an upsell is
 * accepted, the reason the header once dropped its total (specs/review-2026-10-18-reservations.md
 * rule 3).
 */

// Pages only an answer opens.
const OPENED_BY_AN_ANSWER = new Set([
  'linenItems', 'missingItems', 'extinguisherItems', 'breakfastMornings', 'cateringItems', 'cautionReport',
]);

function isOpenedByAnswer(key, index, keys) {
  if (OPENED_BY_AN_ANSWER.has(key)) return true;
  // The composition of a breakfast sold at the door follows its sale; a booked breakfast is a question.
  if (key === 'breakfast') {
    const sale = keys.indexOf('breakfastSale');
    return sale >= 0 && sale < index;
  }
  return false;
}

/**
 * @param {string[]} keys  the dialog's active pages, in order
 * @param {string} key     the page shown
 * @returns {{ number: number, total: number } | null}  null when the page is not in the run
 */
export default function stepNumbering(keys, key) {
  const list = Array.isArray(keys) ? keys : [];
  const index = list.indexOf(key);
  if (index < 0) return null;
  let number = 0;
  let total = 0;
  list.forEach((k, i) => {
    if (isOpenedByAnswer(k, i, list)) return;
    total += 1;
    if (i <= index) number += 1;
  });
  return { number: Math.max(1, number), total };
}
