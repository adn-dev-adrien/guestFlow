/**
 * The capacity the start assistant proposes for a property (specs/plugins-phase-p-productisation.md
 * §3.D rule 21): two guests per double bed, one per single bed, kept within 1–MAX_CAPACITY.
 *
 * The inputs arrive while the operator is still typing, so a count that is not a whole number ≥ 0
 * (empty, negative, decimal, text) counts as no bed rather than as an error: the authoritative
 * validation runs on save.
 */

const MAX_CAPACITY = 50;

function bedCount(value) {
  // A repeated query parameter arrives as an array: not a count.
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function defaultCapacity(doubleBeds, singleBeds) {
  const places = 2 * bedCount(doubleBeds) + bedCount(singleBeds);
  return Math.min(MAX_CAPACITY, Math.max(1, places));
}

module.exports = { defaultCapacity, bedCount, MAX_CAPACITY };
