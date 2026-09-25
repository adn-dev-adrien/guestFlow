import { resolvePlatformTouristTaxPrefill } from '../platformTouristTaxPrefill';

// specs/platform-tourist-tax-out-of-the-commission.md §3.5, rules 21-23 — the seed follows the entry,
// not the fiche's age.
//
// Rule 4 shipped the seed on « a fiche that has never been saved ». That is not the fiche an operator
// types a statement into: an iCal-imported booking IS saved — it lands in the database before anyone
// opens it — and Booking, Airbnb and Gîtes de France all arrive that way, so the seed never fired
// where it was needed. What decides is now whether the brut has been entered; a never-saved fiche has
// no brut either, so it keeps being seeded as the special case of the same rule.
//
// The numbers are réservation 22219 (Booking, 17-19 July 2026, 8 guests), measured 2026-09-25:
// Montant Total 1 283,34 · virement 1 075,27 · tax 19,20 (8 × 2 × 1,20).

const OFFERED = { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 19.20 };

const resolve = (over) => resolvePlatformTouristTaxPrefill({ grossEntered: false, currentValue: '', quote: OFFERED, ...over });

test('rule 21 — a fiche with no brut is seeded, whether it was imported by iCal or opened blank', () => {
  expect(resolve()).toBe(19.20);
});

test('rule 22 — 22219, whose brut is already entered, is never touched: its tax-excluded total stands', () => {
  expect(resolve({ grossEntered: true })).toBeNull();
});

test('rule 22 — an entered brut blocks the seed even on a fiche whose box is empty and whose estimate is live', () => {
  expect(resolve({ grossEntered: true, quote: { ...OFFERED, touristTaxOriginalTotal: 14.40 } })).toBeNull();
});

test('rule 21 — the other guards are unchanged: an explicit 0 in the box still blocks the seed', () => {
  expect(resolve({ currentValue: 0 })).toBeNull();
});

test('rule 21 — the other guards are unchanged: a platform outside mode « platform » is never seeded', () => {
  expect(resolve({ quote: { touristTaxOfferedByPlatform: false, touristTaxOriginalTotal: 19.20 } })).toBeNull();
});

test('rule 21 — the other guards are unchanged: a zero estimate is never seeded', () => {
  expect(resolve({ quote: { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 0 } })).toBeNull();
});

test('rule 23 — the seed only hands the next entry a convention: it fires once and moves no amount', () => {
  // The back-solve reads the brut as its pin, so with no brut a seeded box changes nothing on the
  // fiche. All the helper does is answer with the amount — and then stop answering, so the recompute
  // that follows the write cannot fire it again.
  const seeded = resolve();
  expect(seeded).toBe(19.20);
  expect(resolve({ currentValue: seeded })).toBeNull();
});
