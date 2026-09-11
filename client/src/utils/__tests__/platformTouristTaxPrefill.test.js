import { resolvePlatformTouristTaxPrefill } from '../platformTouristTaxPrefill';

// specs/platform-tourist-tax-out-of-the-commission.md rule 4 — the « Taxe de séjour retenue » box is
// seeded with the engine's figure on a brand-new fiche, and never written into again. Rule 2 is what
// makes the « never again » part matter: an empty box on a SAVED fiche means the brut is
// tax-excluded, so re-seeding it would silently move that reservation's revenue.

const OFFERED = { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 14.40 };

test('rule 4 — a new fiche on an offered-tax platform is seeded with the engine figure', () => {
  expect(resolvePlatformTouristTaxPrefill({ isNewFiche: true, currentValue: '', quote: OFFERED })).toBe(14.40);
});

test('rule 4 — a saved reservation is never seeded (rule 2: empty means tax-excluded)', () => {
  expect(resolvePlatformTouristTaxPrefill({ isNewFiche: false, currentValue: '', quote: OFFERED })).toBeNull();
});

test('rule 4 — a box that already holds a value is left alone: the platform’s number is the operator’s', () => {
  expect(resolvePlatformTouristTaxPrefill({ isNewFiche: true, currentValue: 16.02, quote: OFFERED })).toBeNull();
});

test('rule 15 — an explicit 0 blocks the seed, where an empty box would not', () => {
  expect(resolvePlatformTouristTaxPrefill({ isNewFiche: true, currentValue: 0, quote: OFFERED })).toBeNull();
});

test('rule 1 — no seed when the platform does not remit the tax to the commune itself', () => {
  const reversed = { touristTaxOfferedByPlatform: false, touristTaxOriginalTotal: 14.40 };
  expect(resolvePlatformTouristTaxPrefill({ isNewFiche: true, currentValue: '', quote: reversed })).toBeNull();
});

test('rule 4 — no seed before the first quote comes back, or when the estimate is zero', () => {
  expect(resolvePlatformTouristTaxPrefill({ isNewFiche: true, currentValue: '', quote: null })).toBeNull();
  expect(resolvePlatformTouristTaxPrefill({
    isNewFiche: true, currentValue: '', quote: { touristTaxOfferedByPlatform: true, touristTaxOriginalTotal: 0 },
  })).toBeNull();
});

test('rule 4 — seeding is idempotent: the value it wrote blocks the next call', () => {
  const first = resolvePlatformTouristTaxPrefill({ isNewFiche: true, currentValue: '', quote: OFFERED });
  expect(first).toBe(14.40);
  // The recompute that follows the write must not fire it again — a different estimate included.
  const second = resolvePlatformTouristTaxPrefill({
    isNewFiche: true, currentValue: first, quote: { ...OFFERED, touristTaxOriginalTotal: 19.20 },
  });
  expect(second).toBeNull();
});
