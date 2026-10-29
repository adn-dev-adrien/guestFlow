// specs/reservation-save-keeps-pricing.md rules 5 and 6 — the pricing summary warns, server-worded, about
// a commission far above the platform's configured rate (#22201: 91,5 % on a channel at 5 %) and about a
// tourist tax the engine no longer prices as the fiche stored it (#22270, #22282, #22301, #22304: stored
// 0 since before Booking was switched to « nous reverse » the tax).
const test = require('node:test');
const assert = require('node:assert/strict');

const { touristTaxStale, platformCommissionOdd } = require('../utils/fichePricingNotices');

test('rule 5 — 91,5 % commission on a channel configured at 5 % is flagged, with both figures', () => {
  const notice = platformCommissionOdd({ commission: 1118.06, gross: 1222, platformLabel: 'Lodgify', configuredPercent: 5 });
  assert.equal(notice.code, 'PLATFORM_COMMISSION_ODD');
  assert.match(notice.text, /^Commission de 1 118,06 € : 91,5 % du séjour, contre 5,0 % attendus pour Lodgify\.$/);
});

test('rule 5 — a commission up to twice the configured rate passes; beyond it does not', () => {
  assert.equal(platformCommissionOdd({ commission: 150, gross: 1000, platformLabel: 'Booking', configuredPercent: 15 }), null);
  assert.equal(platformCommissionOdd({ commission: 300, gross: 1000, platformLabel: 'Booking', configuredPercent: 15 }), null);
  assert.ok(platformCommissionOdd({ commission: 310, gross: 1000, platformLabel: 'Booking', configuredPercent: 15 }));
});

test('rule 5 — without a configured rate only a commission over half the sale is flagged; nothing without a commission', () => {
  assert.equal(platformCommissionOdd({ commission: 400, gross: 1000, platformLabel: 'Abritel', configuredPercent: 0 }), null);
  const notice = platformCommissionOdd({ commission: 600, gross: 1000, platformLabel: 'Abritel', configuredPercent: 0 });
  assert.match(notice.text, /^Commission de 600,00 € : 60,0 % du séjour\.$/);
  assert.equal(platformCommissionOdd({ commission: 0, gross: 1000, platformLabel: 'Abritel', configuredPercent: 5 }), null);
  assert.equal(platformCommissionOdd({ commission: 50, gross: 0, platformLabel: 'Abritel', configuredPercent: 5 }), null);
});

test('rule 6 — a stored tax of 0 against 21,24 € computed is announced, with the action that recomputes it', () => {
  const notice = touristTaxStale({ quote: { touristTaxTotal: 21.24, touristTaxFrozen: false }, storedRow: { kind: 'reservation', touristTaxTotal: 0 } });
  assert.deepEqual(notice, {
    code: 'TOURIST_TAX_STALE',
    text: 'Taxe de séjour à mettre à jour : 0,00 € enregistrés, 21,24 € calculés.',
    action: 'refreshTouristTax',
  });
});

test('rule 6 — same tax, frozen tax, devis and new stays announce nothing', () => {
  const stored = { kind: 'reservation', touristTaxTotal: 21.24 };
  assert.equal(touristTaxStale({ quote: { touristTaxTotal: 21.24 }, storedRow: stored }), null);
  assert.equal(touristTaxStale({ quote: { touristTaxTotal: 30, touristTaxFrozen: true }, storedRow: stored }), null);
  assert.equal(touristTaxStale({ quote: { touristTaxTotal: 30 }, storedRow: { kind: 'devis', touristTaxTotal: 0 } }), null);
  assert.equal(touristTaxStale({ quote: { touristTaxTotal: 30 }, storedRow: null }), null);
});

test('rule 6 — a platform now reversing the tax: the notice names the figure the summary still shows (the amount entered then)', () => {
  const notice = touristTaxStale({
    quote: { touristTaxTotal: 19.2, touristTaxReversedByPlatform: true },
    storedRow: { kind: 'reservation', touristTaxTotal: 0, platformTouristTaxAmount: 16.02 },
  });
  assert.equal(notice.text, 'Taxe de séjour à mettre à jour : 16,02 € enregistrés, 19,20 € calculés.');
});
