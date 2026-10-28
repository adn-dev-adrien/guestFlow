// specs/vat-optional-mode.md rules 1, 2 and 12 — what a « Sans TVA » sale prints: the legal
// mention (one of two fixed texts, French and English) instead of the VAT breakdown, on the live and the
// stored summary and on the devis PDF; the settings summary words the regime.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');
const rules = require('../utils/vatRegime');

const db = buildVatGoldenDb();
const { calculateReservationQuote } = require('../utils/pricing');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const reservationsController = require('../controllers/reservationsController');
const devisModel = require('../models/devisModel');
const settingsModel = require('../models/settingsModel');
const { generateDevisPdf } = require('../utils/devisPdf');
const { buildSummary } = require('../controllers/settingsSummaryController');

const MENTION_FR = 'TVA non applicable, art. 293 B du CGI';
const MENTION_EN = 'VAT not applicable, art. 293 B of the French General Tax Code';

async function drawn(id) {
  const PDFDocument = require('pdfkit');
  const realText = PDFDocument.prototype.text;
  const calls = [];
  PDFDocument.prototype.text = function patched(text, ...rest) { calls.push(String(text)); return realText.call(this, text, ...rest); };
  try {
    await generateDevisPdf(devisModel.findById(id), settingsModel.read(), devisModel.recomputeQuote(id));
  } finally {
    PDFDocument.prototype.text = realText;
  }
  return calls;
}

test('rule 2: the two legal mentions are fixed texts, in French and in English', () => {
  assert.deepEqual(Object.keys(rules.MENTIONS), ['art_293_b', 'art_261_d_4']);
  assert.equal(rules.mentionText('art_293_b', 'fr'), MENTION_FR);
  assert.equal(rules.mentionText('art_293_b', 'en'), MENTION_EN);
  assert.equal(rules.mentionText('art_261_d_4', 'fr'), 'Exonération de TVA, art. 261 D 4° du CGI');
  assert.equal(rules.mentionText('art_261_d_4', 'en'), 'VAT exempt, art. 261 D 4° of the French General Tax Code');
  assert.equal(rules.mentionText('free text', 'fr'), null);
  assert.equal(rules.DEFAULT_MENTION, 'art_293_b');
});

test('rule 1: under VAT a devis prints the breakdown and no mention', async () => {
  const text = await drawn(201);
  assert.ok(text.includes('TVA %') && text.includes('Total HT') && text.includes('TOTAL TTC'));
  assert.ok(!text.some((t) => t.includes('art. 293 B')));
});

test('rule 12 (a): the live summary carries the regime and its mention, the stored one too', () => {
  const regimeOf = (id) => calculateReservationQuote(buildReservationEngineInput(db, db.prepare('SELECT * FROM reservations WHERE id = ?').get(id))).vatRegime;
  assert.equal(regimeOf(101).regime, 'subject');
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_293_b', 'all')").run();
  db.prepare('UPDATE reservations SET vatPeriodId = 2 WHERE id = 101').run();
  const live = regimeOf(101);
  assert.deepEqual([live.regime, live.rate, live.legalMentionText, live.legalMentionTextEn], ['not_subject', 0, MENTION_FR, MENTION_EN]);
  let stored;
  reservationsController.getById({ params: { id: 101 }, user: { id: 1, roles: ['admin'], role: 'admin' } }, { json: (b) => { stored = b.storedSummary; } });
  assert.equal(stored.vatRegime.regime, 'not_subject');
  assert.equal(stored.vatRate, 0);
  assert.equal(stored.totalVatAmount, 0);
  assert.equal(stored.totalNetPrice, stored.finalPrice);
  assert.equal(stored.vatRegime.legalMentionText, MENTION_FR);
});

test('rule 12 (b): the French devis drops the VAT and HT columns and prints the mention under the total', async () => {
  const text = await drawn(201);
  for (const gone of ['TVA %', 'Total HT', 'Total TTC', 'Sous-total HT', 'Sous-total TTC', 'TOTAL TTC', 'Total du séjour TTC']) assert.ok(!text.includes(gone), gone);
  for (const kept of ['Total', 'Sous-total', 'TOTAL', 'Total du séjour', MENTION_FR]) assert.ok(text.includes(kept), kept);
  assert.ok(!text.some((t) => /^\d+,\d{2}%$/.test(t)), 'no rate printed on a row');
});

test('rule 12 (b): the English devis follows the language of the document', async () => {
  const text = await drawn(202);
  for (const gone of ['VAT %', 'Total excl. VAT', 'Total incl. VAT', 'Subtotal excl. VAT', 'TOTAL incl. VAT']) assert.ok(!text.includes(gone), gone);
  for (const kept of ['Total', 'Subtotal', 'TOTAL', 'Total for the stay', MENTION_EN]) assert.ok(text.includes(kept), kept);
  assert.ok(!text.includes(MENTION_FR));
});

test('rule 12 (b): the company VAT number still prints when it is set — it is the operator\'s data', async () => {
  db.prepare("UPDATE app_settings SET companyTva = 'FR12345678901'").run();
  assert.ok((await drawn(201)).some((t) => t.includes('FR12345678901')));
});

test('rule 12 (b): the PDF of a not-subject devis is a valid document whose total is the stored price', async () => {
  const bytes = await generateDevisPdf(devisModel.findById(201), settingsModel.read(), devisModel.recomputeQuote(201));
  assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  const quote = devisModel.recomputeQuote(201);
  assert.equal(quote.totalNetPrice, quote.finalPrice);
});

test('rule 12 (e): the settings summary words the regime', () => {
  const { lines } = buildSummary({ db, settings: () => settingsModel.read(), plugins: () => [], today: () => '2027-10-20' }, { id: 1, roles: ['admin'] });
  assert.equal(lines['/settings/tva-exercice'].text, 'Sans TVA · exercice clos fin décembre');
});
