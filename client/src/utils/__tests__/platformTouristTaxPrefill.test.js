import { resolvePlatformTouristTaxPrefill } from '../platformTouristTaxPrefill';

// specs/platform-tourist-tax-out-of-the-commission.md rule 4 — the « Taxe de séjour retenue » box is
// seeded with the engine's figure on a fiche that has nothing typed in it yet, and never written
// into again. Rule 2 is what makes the « never again » part matter: an empty box on a fiche that
// already carries a brut means that brut is tax-excluded, so re-seeding it would silently move that
// reservation's revenue. Which fiches the seed reaches is rule 21's subject, pinned next door in
// platformTouristTaxPrefill.prefill-on-empty-gross.test.js.

const OFFERED = { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 14.40 };

test('rule 4 — a fiche with nothing typed in it, on an offered-tax platform, is seeded with the engine figure', () => {
  expect(resolvePlatformTouristTaxPrefill({ grossEntered: false, currentValue: '', quote: OFFERED })).toBe(14.40);
});

test('rule 4 — a fiche that already carries a brut is never seeded (rule 2: empty means tax-excluded)', () => {
  expect(resolvePlatformTouristTaxPrefill({ grossEntered: true, currentValue: '', quote: OFFERED })).toBeNull();
});

test('rule 4 — a box that already holds a value is left alone: the platform’s number is the operator’s', () => {
  expect(resolvePlatformTouristTaxPrefill({ grossEntered: false, currentValue: 16.02, quote: OFFERED })).toBeNull();
});

test('rule 15 — an explicit 0 blocks the seed, where an empty box would not', () => {
  expect(resolvePlatformTouristTaxPrefill({ grossEntered: false, currentValue: 0, quote: OFFERED })).toBeNull();
});

test('rule 1 — no seed when the platform does not remit the tax to the commune itself', () => {
  const reversed = { touristTaxOfferedByPlatform: false, touristTaxOriginalTotal: 14.40 };
  expect(resolvePlatformTouristTaxPrefill({ grossEntered: false, currentValue: '', quote: reversed })).toBeNull();
});

test('rule 4 — no seed before the first quote comes back, or when the estimate is zero', () => {
  expect(resolvePlatformTouristTaxPrefill({ grossEntered: false, currentValue: '', quote: null })).toBeNull();
  expect(resolvePlatformTouristTaxPrefill({
    grossEntered: false, currentValue: '', quote: { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 0 },
  })).toBeNull();
});

test('rule 4 — seeding is idempotent: the value it wrote blocks the next call', () => {
  const first = resolvePlatformTouristTaxPrefill({ grossEntered: false, currentValue: '', quote: OFFERED });
  expect(first).toBe(14.40);
  // The recompute that follows the write must not fire it again — a different estimate included.
  const second = resolvePlatformTouristTaxPrefill({
    grossEntered: false, currentValue: first, quote: { ...OFFERED, touristTaxOriginalTotal: 19.20 },
  });
  expect(second).toBeNull();
});
