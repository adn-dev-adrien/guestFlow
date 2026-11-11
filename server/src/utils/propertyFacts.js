/**
 * The facts of a property the guest emails state, and those nobody gave yet
 * (specs/guest-email-texts-made-simple.md rule 28). Pure.
 *
 * The start assistant creates a property without asking for its deposit, its cleaning, its bath
 * linen or its bed linen (`linen`, 2026-10-18). Those facts are « pending » (`properties.pendingFacts`, comma-separated) and every sentence
 * built on one is left out until the owner answers: an email never asserts what nobody said.
 *
 *   PENDABLE                      the facts that can be pending
 *   FLAG_FACTS                    [field, fact] — the yes/no answers (NULL: the options decide)
 *   pendingFactsOf(property)      Set of the pending facts
 *   withoutPending(list, facts)   the stored value once `facts` are answered
 *   answeredFlag(value)           true / false / null (NULL: the options decide) from a form value
 */

const PENDABLE = Object.freeze(['caution', 'cleaning', 'towels', 'linen']);
const FLAG_FACTS = Object.freeze([['cleaningIncluded', 'cleaning'], ['towelsProvided', 'towels'], ['bedLinenProvided', 'linen']]);

function pendingFactsOf(property) {
  const raw = property && property.pendingFacts != null ? String(property.pendingFacts) : '';
  return new Set(raw.split(',').map((f) => f.trim()).filter((f) => PENDABLE.includes(f)));
}

function withoutPending(raw, answered) {
  const gone = new Set(answered);
  return [...pendingFactsOf({ pendingFacts: raw })].filter((f) => !gone.has(f)).join(',');
}

function answeredFlag(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return null;
}

module.exports = { PENDABLE, FLAG_FACTS, pendingFactsOf, withoutPending, answeredFlag };
