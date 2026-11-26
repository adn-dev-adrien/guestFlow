// specs/platform-host-statement-and-commission-vat.md rules 1-12 — the statement of a platform stay is typed as the HOST's
// figures (location, options, the tax box by mode); the engine prices from them, the commission is read off them.
// The stays are the ones of the accountant's October review, with the figures measured in production on 2026-11-26.
const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateReservationQuote } = require('../utils/pricing').__test;
const { computePlatformCommission, taxPaidWithPayout } = require('../utils/pricing/platformPayment');
const { settleStatementOptions } = require('../utils/platformStatementOptions');
const { statementReadout } = require('../utils/platformStatementReadout');
const { touristTaxGapOf } = require('../utils/pricing/storedSaleFigures');
const {
  createDb, addPlatform, FRAISSE, DAUSQUE, TOUSSAINT, GILIBERT, MENAGE_PAID, LINGE,
} = require('./platformHostStatementFixture');

function fixture() {
  const db = createDb();
  addPlatform(db, 'Airbnb', 'reversed', 15.5);
  addPlatform(db, 'GitesDeFrance', 'remits');
  addPlatform(db, 'Booking', 'reversed', 15);
  return db;
}

const quoteOf = (db, stay, over = {}) => calculateReservationQuote({ ...stay, ...over, db });

test('rules 1, 3, 6, 8 — Fraisse (Airbnb, reversed): location 725 + options 80, tax paid 24, commission 124,78', () => {
  const db = fixture();
  const q = quoteOf(db, FRAISSE);
  assert.equal(q.accommodationAdjustedPrice, 725, 'the rent is the statement less the options');
  assert.equal(q.optionsTotal, 80);
  assert.equal(touristTaxGapOf(q), 0, 'the platform paid GuestFlow\'s own tax: 10 adults × 2 nights × 1,20');
  assert.equal(q.touristTaxTotal, 31.2, '24,00 paid by the platform + 7,20 of the three added adults');
  assert.equal(q.touristTaxAddedGuestsAmount, 7.2);
  assert.equal(q.finalPrice, 805, 'the host amount (the tax rides on top of it, as it always did)');
  assert.equal(q.totalStayPrice, 836.2, 'host amount + box + the added guests tax');
  assert.equal(q.balanceAmount, 829, 'what the platform settles: host amount + tax paid');
  assert.equal(computePlatformCommission({ gross: 805, payout: 704.22, touristTax: taxPaidWithPayout({ mode: 'platform_reversed', box: 24 }) }), 124.78);
  const settled = quoteOf(db, FRAISSE, { platformCommissionAmount: 124.78 });
  assert.equal(settled.platformNetReceivedAmount, 704.22, 'the net perçu is the transfer, to the cent');
  db.close();
});

test('rules 1, 3, 5, 8 — Dausque (Gîtes de France, platform): the tax kept enters nothing, commission 78', () => {
  const db = fixture();
  const q = quoteOf(db, DAUSQUE, { offeredOptionIds: [] });
  assert.equal(q.accommodationAdjustedPrice, 784);
  assert.equal(q.finalPrice, 864, 'the host amount, whatever the informational box says');
  assert.equal(q.touristTaxTotal, 0);
  assert.equal(touristTaxGapOf(q), 0);
  assert.equal(computePlatformCommission({ gross: 864, payout: 786, touristTax: taxPaidWithPayout({ mode: 'platform', box: 36 }) }), 78);
  db.close();
});

test('rules 7, 8 — Toussaint (Airbnb intake): the tax gap +28,80 goes into the accommodation, commission 178,96', () => {
  const db = fixture();
  const q = quoteOf(db, TOUSSAINT);
  assert.equal(q.touristTaxTotal, 24, 'GuestFlow\'s own tax: 5 adults × 4 nights × 1,20');
  assert.equal(touristTaxGapOf(q), 28.8);
  assert.equal(q.accommodationAdjustedPrice, 1183.4, '1 154,60 + 28,80');
  assert.equal(q.finalPrice, 1183.4);
  assert.equal(q.totalStayPrice, 1207.4, 'host amount + the box: Σ credits equals the money received');
  assert.equal(computePlatformCommission({ gross: 1154.6, payout: 1028.44, touristTax: 52.8 }), 178.96);
  db.close();
});

test('rule 7 — Gilibert (Booking): the platform paid less than our tax, the gap −6,38 comes out of the accommodation', () => {
  const db = fixture();
  const q = quoteOf(db, GILIBERT);
  assert.equal(q.touristTaxTotal, 26.4);
  assert.equal(touristTaxGapOf(q), -6.38);
  assert.equal(q.accommodationAdjustedPrice, 683.62);
  assert.equal(q.totalStayPrice, 710.02, 'the guest total of the extranet');
  db.close();
});

test('rule 7 — an empty box leaves no gap', () => {
  const db = fixture();
  const q = quoteOf(db, TOUSSAINT, { platformTouristTaxAmount: '' });
  assert.equal(touristTaxGapOf(q), 0);
  assert.equal(q.accommodationAdjustedPrice, 1154.6);
  db.close();
});

test('rule 9 — a stay whose tax was frozen under another mode does not move when its platform switches to reversed', () => {
  const db = fixture();
  const frozen = { freezeTouristTax: true, frozenTouristTaxTotal: 0, frozenTouristTaxRate: 0 };
  const q = quoteOf(db, FRAISSE, frozen);
  assert.equal(touristTaxGapOf(q), 0);
  assert.equal(q.accommodationAdjustedPrice, 725);
  assert.equal(q.finalPrice, 805, 'the price the stay had in mode platform, to the cent');
  db.close();
});

test('rule 5 — the box is informational in mode platform and ignored in owner mode', () => {
  const db = fixture();
  const withBox = quoteOf(db, DAUSQUE, { offeredOptionIds: [] });
  const withoutBox = quoteOf(db, DAUSQUE, { offeredOptionIds: [], platformTouristTaxAmount: '' });
  assert.equal(withBox.finalPrice, withoutBox.finalPrice);
  assert.equal(taxPaidWithPayout({ mode: 'owner', box: 36 }), 0);
  assert.equal(taxPaidWithPayout({ mode: 'platform', box: 36 }), 0);
  assert.equal(taxPaidWithPayout({ mode: 'platform_reversed', box: 36 }), 36);
  db.close();
});

// --- rule 2: the option lines follow the statement's options -------------------------------------------------------------------

function settle(db, stay, optionsAmount) {
  const input = {
    ...stay, db, selectedOptions: stay.selectedOptions.map((o) => ({ ...o })), customOptions: [...(stay.customOptions || [])],
    offeredOptionIds: [...(stay.offeredOptionIds || [])],
  };
  const result = settleStatementOptions(input, optionsAmount);
  return { input, result, quote: calculateReservationQuote(input) };
}

test('rule 2 — gap > 0: a ménage offered on the fiche and priced at the gap becomes paid (Dausque)', () => {
  const db = fixture();
  const { result, quote } = settle(db, DAUSQUE, 80);
  assert.equal(result.applied, true);
  assert.deepEqual(result.notes, ['Ménage passé en payant (80,00 €) pour suivre le relevé.']);
  assert.equal(quote.optionsTotal, 80);
  assert.equal(quote.accommodationAdjustedPrice, 784);
  db.close();
});

test('rule 2 — gap > 0: a catalogue option absent from the fiche and priced at the gap is added', () => {
  const db = fixture();
  const { input, result, quote } = settle(db, { ...TOUSSAINT, platformGrossAmount: 1234.6 }, 80);
  assert.equal(result.applied, true);
  assert.ok(input.selectedOptions.some((o) => o.optionId === 1), 'the ménage joined the fiche');
  assert.equal(quote.optionsTotal, 80);
  assert.equal(quote.accommodationAdjustedPrice, 1183.4);
  db.close();
});

test('rule 2 — gap > 0 with no option at that price: the custom line « Options <plateforme> » carries it, then grows with it', () => {
  const db = fixture();
  const first = settle(db, { ...TOUSSAINT, selectedOptions: [LINGE], offeredOptionIds: [2] }, 37.5);
  assert.equal(first.input.customOptions.length, 1);
  assert.equal(first.input.customOptions[0].customKey, 'platform_options');
  assert.equal(first.input.customOptions[0].description, 'Options Airbnb');
  assert.equal(first.quote.optionsTotal, 37.5);
  const second = settle(db, { ...TOUSSAINT, selectedOptions: [LINGE], offeredOptionIds: [2], customOptions: first.input.customOptions }, 50);
  assert.equal(second.input.customOptions.length, 1, 'updated, not duplicated');
  assert.equal(second.quote.optionsTotal, 50);
  db.close();
});

test('rule 2 — gap < 0: the custom line is lowered first, removed at 0', () => {
  const db = fixture();
  const custom = [{ customKey: 'platform_options', description: 'Options Airbnb', amount: 50, offered: false, inComplement: 0 }];
  const lowered = settle(db, { ...TOUSSAINT, customOptions: custom }, 20);
  assert.equal(lowered.input.customOptions[0].amount, 20);
  const removed = settle(db, { ...TOUSSAINT, customOptions: custom }, 0.005 * 0);
  assert.equal(removed.input.customOptions.length, 0);
  assert.equal(removed.quote.optionsTotal, 0);
  db.close();
});

test('rule 2 — gap < 0: then a paid platform-billed line priced exactly at the remaining gap becomes offered', () => {
  const db = fixture();
  const { result, quote } = settle(db, { ...DAUSQUE, offeredOptionIds: [] }, 0);
  assert.equal(result.applied, true);
  assert.deepEqual(result.notes, ['Ménage passé en offert (80,00 €) pour suivre le relevé.']);
  assert.equal(quote.optionsTotal, 0);
  db.close();
});

test('rule 2 — the one refusal: nothing matches the gap, on the field, in the words of the spec', () => {
  const db = fixture();
  const { result } = settle(db, { ...DAUSQUE, offeredOptionIds: [] }, 30);
  assert.equal(result.applied, false);
  assert.deepEqual(result.refusal, {
    field: 'platformOptionsAmount',
    message: 'Le relevé compte 30,00 € d’options, la fiche 80,00 € : retirer une option.',
  });
  db.close();
});

test('rule 2 — an empty « Options (relevé) » leaves the lines alone; a direct stay is never adjusted', () => {
  const db = fixture();
  assert.equal(settle(db, { ...DAUSQUE, offeredOptionIds: [] }, '').result.applied, false);
  assert.equal(settle(db, { ...DAUSQUE, platform: 'direct', offeredOptionIds: [] }, 0).result.applied, false);
  db.close();
});

// --- rules 10-12: what the block says --------------------------------------------------------------------------------------------

test('rule 10 — the closing line: host amount + tax paid − commission = transfer ✓, or the gap', () => {
  const figures = { platformGrossAmount: 805, platformTouristTaxAmount: 24, platformPayoutAmount: 704.22, platformCommissionAmount: 124.78 };
  const done = statementReadout({ figures, mode: 'platform_reversed', platformLabel: 'Airbnb' });
  assert.equal(done.lines[0].tone, 'done');
  assert.match(done.lines[0].label, /Montant hôte 805,00\s€ \+ taxe 24,00\s€ − commission 124,78\s€ = 704,22\s€ — identique au virement ✓/);
  const off = statementReadout({ figures: { ...figures, platformCommissionAmount: 120 }, mode: 'platform_reversed', platformLabel: 'Airbnb' });
  assert.equal(off.lines[0].tone, 'warning');
  assert.match(off.lines[0].label, /écart 4,78\s€/);
});

test('rule 7 — the tax gap line names both figures', () => {
  const readout = statementReadout({
    figures: { platformGrossAmount: 1154.6, platformTouristTaxAmount: 52.8 }, mode: 'platform_reversed', touristTaxGap: 28.8, platformLabel: 'Airbnb',
  });
  assert.equal(readout.lines.find((l) => /Écart de taxe/.test(l.label)).label, 'Écart de taxe de séjour : +28,80 € (Airbnb 52,80 €, GuestFlow 24,00 €) ajouté au logement.');
});

test('rule 11 — the commission rate warning, both ways, at one point', () => {
  const base = { figures: { platformGrossAmount: 1000, platformCommissionAmount: 175 }, mode: 'platform', platformLabel: 'Airbnb', commissionPercent: 15.5 };
  assert.equal(statementReadout(base).warnings.commissionRate,
    'Commission à 17,5 % du montant hôte, Airbnb est à 15,5 % : le montant hôte contient-il les frais payés par le voyageur ?');
  assert.equal(statementReadout({ ...base, figures: { platformGrossAmount: 1000, platformCommissionAmount: 160 } }).warnings.commissionRate, null);
  assert.equal(statementReadout({ ...base, figures: { platformGrossAmount: 1000, platformCommissionAmount: 140 } }).warnings.commissionRate !== null, true);
  assert.equal(statementReadout({ ...base, commissionPercent: 0 }).warnings.commissionRate, null, 'no rate, no check');
});

test('rule 12 — a commission above the host amount plus the tax paid is refused on its field', () => {
  const figures = { platformGrossAmount: 805, platformTouristTaxAmount: 24, platformCommissionAmount: 830 };
  assert.ok(statementReadout({ figures, mode: 'platform_reversed', platformLabel: 'Airbnb' }).refusals.platformCommissionAmount);
  assert.equal(statementReadout({ figures: { ...figures, platformCommissionAmount: 829 }, mode: 'platform_reversed', platformLabel: 'Airbnb' }).refusals.platformCommissionAmount, undefined);
  assert.ok(statementReadout({ figures: { ...figures, platformCommissionAmount: 810 }, mode: 'platform', platformLabel: 'Airbnb' }).refusals.platformCommissionAmount, 'in mode platform the box adds nothing');
});

test('rule 8 — the commission is floored at 0 and null without a figure', () => {
  assert.equal(computePlatformCommission({ gross: 100, payout: 120 }), 0);
  assert.equal(computePlatformCommission({ gross: 805, payout: 704.22, touristTax: 24, acompteCommission: 10 }), 114.78);
  assert.equal(computePlatformCommission({ gross: '', payout: 10 }), null);
});
