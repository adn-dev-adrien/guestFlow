// Label map parity + fail-loud accessor for the bilingual devis PDF.
// See specs/devis-english-language.md §3 rule 2.

const test = require('node:test');
const assert = require('node:assert/strict');

const { labels, supportedLanguages, FR, EN } = require('../utils/devisPdfLabels');

test('supportedLanguages exposes fr + en', () => {
  assert.deepEqual(supportedLanguages().sort(), ['en', 'fr']);
});

test('labels("xx") throws — fail-loud on unknown language', () => {
  assert.throws(() => labels('xx'), /unknown language/i);
  assert.throws(() => labels(), /unknown language/i);
  assert.throws(() => labels(''), /unknown language/i);
});

test('labels accepts upper/mixed case', () => {
  assert.equal(labels('FR').documentTitle, 'DEVIS');
  assert.equal(labels('En').documentTitle, 'QUOTE');
});

test('FR + EN expose IDENTICAL key sets (no FR-only or EN-only entries)', () => {
  const frKeys = Object.keys(FR).sort();
  const enKeys = Object.keys(EN).sort();
  assert.deepEqual(frKeys, enKeys, `FR/EN key parity violated.\nFR-only: ${frKeys.filter((k) => !enKeys.includes(k))}\nEN-only: ${enKeys.filter((k) => !frKeys.includes(k))}`);
});

test('every key in BOTH maps is a non-empty string or a function', () => {
  for (const key of Object.keys(FR)) {
    for (const lang of ['fr', 'en']) {
      const v = labels(lang)[key];
      const isUsable = (typeof v === 'string' && v.length > 0) || typeof v === 'function';
      assert.ok(isUsable, `labels(${lang}).${key} must be a non-empty string or function (got ${typeof v})`);
    }
  }
});

// Spot-check a handful of critical translations — anchor the contract for the renderer.
test('FR ↔ EN spot-check on the marquee labels', () => {
  assert.equal(FR.documentTitle, 'DEVIS');
  assert.equal(EN.documentTitle, 'QUOTE');
  assert.equal(FR.grandTotal, 'TOTAL TTC');
  assert.equal(EN.grandTotal, 'TOTAL incl. VAT');
  assert.equal(FR.depositLabel, 'Acompte :');
  assert.equal(EN.depositLabel, 'Deposit:');
  assert.equal(FR.cautionLabel, 'Caution :');
  assert.equal(EN.cautionLabel, 'Security deposit:');
  assert.equal(FR.offered, 'OFFERT');
  assert.equal(EN.offered, 'INCLUDED');
});

test('pluralisation helpers: accommodation/nights are sensitive to singular/plural', () => {
  assert.equal(FR.accommodation(1), 'Hébergement — 1 nuit');
  assert.equal(FR.accommodation(3), 'Hébergement — 3 nuits');
  assert.equal(EN.accommodation(1), 'Accommodation — 1 night');
  assert.equal(EN.accommodation(3), 'Accommodation — 3 nights');

  assert.equal(FR.accommodationWithSeason(1, 'Haute saison'), 'Hébergement — 1 nuit (Haute saison)');
  assert.equal(FR.accommodationWithSeason(5, 'Basse saison'), 'Hébergement — 5 nuits (Basse saison)');
  assert.equal(EN.accommodationWithSeason(1, 'High season'), 'Accommodation — 1 night (High season)');
  assert.equal(EN.accommodationWithSeason(5, 'Low season'), 'Accommodation — 5 nights (Low season)');
});

test('tourist tax breakdown plural in both languages', () => {
  assert.equal(FR.touristTaxBreakdown(2, 1, '1,50 €'), '2 pers. × 1 nuit × 1,50 € / pers./nuit');
  assert.equal(FR.touristTaxBreakdown(3, 4, '1,50 €'), '3 pers. × 4 nuits × 1,50 € / pers./nuit');
  assert.equal(EN.touristTaxBreakdown(1, 1, '1.50 €'), '1 guest × 1 night × 1.50 € / guest / night');
  assert.equal(EN.touristTaxBreakdown(2, 3, '1.50 €'), '2 guests × 3 nights × 1.50 € / guest / night');
});

test('document number, page number, discount, extra-hours suffix', () => {
  assert.equal(FR.documentNumber('DEV-001'), 'N° DEV-001');
  assert.equal(EN.documentNumber('DEV-001'), 'No. DEV-001');
  assert.equal(FR.pageNumber(2, 4), 'Page 2 / 4');
  assert.equal(EN.pageNumber(2, 4), 'Page 2 / 4');
  assert.equal(FR.accommodationDiscount(10), 'RÉDUCTION LOGEMENT 10%');
  assert.equal(EN.accommodationDiscount(10), 'ACCOMMODATION DISCOUNT 10%');
  assert.equal(FR.extraHoursSuffix('1,5h'), '1,5h suppl.');
  assert.equal(EN.extraHoursSuffix('1.5h'), '1.5h extra');
});
