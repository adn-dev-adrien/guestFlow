const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveExtraGuestPdfRow } = require('../utils/devisHelpers');
const { labels } = require('../utils/devisPdfLabels');

// The devis PDF's line items are nights + options + resources; the extra-guest supplement used to
// live in the GRAND TOTAL only, so any devis with extra guests printed a sub-total that did not
// match its own lines (69 € of unexplained gap on a 5-guest 2-night Lodge stay). This pins the row
// that closes the gap — specs/tariff-events-and-extra-guest-tiers/spec.md §6.

test('a live quote with a supplement yields a billed row carrying the tier phrase', () => {
  const row = resolveExtraGuestPdfRow({
    quote: {
      extraGuestSurchargeOriginal: 69, extraGuestSurcharge: 69, extraGuestSurchargeOffered: false,
      extraGuestCount: 3, extraGuestTiersLabel: '15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit',
    },
    finalPriceTtc: 444.44,
  });
  assert.deepEqual(row, {
    totalTtc: 69, originalTtc: 69, offered: false, count: 3,
    tiersLabel: '15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit',
  });
});

test('an OFFERED supplement bills 0 and keeps the real value for the strike-through', () => {
  const row = resolveExtraGuestPdfRow({
    quote: {
      extraGuestSurchargeOriginal: 69, extraGuestSurcharge: 0, extraGuestSurchargeOffered: true,
      extraGuestCount: 3, extraGuestTiersLabel: null,
    },
  });
  assert.equal(row.totalTtc, 0);
  assert.equal(row.originalTtc, 69);
  assert.equal(row.offered, true);
});

test('no supplement → no row (every 2-guest stay, every existing Gîte devis)', () => {
  assert.equal(resolveExtraGuestPdfRow({ quote: { extraGuestSurchargeOriginal: 0 } }), null);
});

test('engine failure at print time: the remainder finalPrice − rows becomes the row', () => {
  // 444,44 total, 375,44 of accommodation, 0 options/resources → the 69 € the rows cannot explain.
  const row = resolveExtraGuestPdfRow({
    quote: null, finalPriceTtc: 444.44, accommodationTtc: 375.44, optionsTtc: 0, resourcesTtc: 0,
  });
  assert.deepEqual(row, { totalTtc: 69, originalTtc: 69, offered: false, count: 0, tiersLabel: null });
});

test('engine failure + no gap → no row: an offered supplement never resurfaces as billed', () => {
  // finalPrice already excludes an offered supplement, so the remainder is 0.
  assert.equal(
    resolveExtraGuestPdfRow({ quote: null, finalPriceTtc: 375.44, accommodationTtc: 375.44, optionsTtc: 0, resourcesTtc: 0 }),
    null,
  );
});

test('a sub-cent remainder is noise, not a supplement', () => {
  assert.equal(
    resolveExtraGuestPdfRow({ quote: null, finalPriceTtc: 100.005, accommodationTtc: 100, optionsTtc: 0, resourcesTtc: 0 }),
    null,
  );
});

test('the FR label carries the tier phrase, the EN label deliberately does not', () => {
  const fr = labels('fr').extraGuestSupplement(3, '15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit');
  assert.equal(fr, 'Surcoût voyageurs (3 pers. au-delà du tarif de base) — 15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit');
  const en = labels('en').extraGuestSupplement(1, '15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit');
  assert.equal(en, 'Extra-guest supplement (1 guest above the base rate)');
});
