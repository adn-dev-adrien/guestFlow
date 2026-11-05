// specs/reservation-payment-ledger.md rule 46, reading of 2026-11-05 (audit R22-3) — a solde ticked before its acompte
// keeps what it collected across a save: the acompte still owed shrinks first, a rise goes to the complement, and the
// solde carries the stored split from the first entry.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const {
  rowOf, WITH_ACOMPTE, S, D, free, fiche, put, pay, ficheView,
} = require('./moneyLedgerFixture');
const { liveQuote } = require('./ledgerFixture');

const journalFixture = optionalPlugin(() => require('../plugins/accounting-export/tests/journalFixture'));
const accounting = { skip: skipWithout(['accounting-export']) };
const line = free(100);
const addition = free(20, 'Ajout', null);

test('R22-3 — +20 € after a solde ticked first: solde 494,80 € kept, acompte 210 € kept, complement 20 €', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [line] });
  assert.equal(rowOf(stay.id).depositAmount, 210);
  assert.equal(rowOf(stay.id).balanceAmount, 494.8);
  pay(stay.id, S);
  assert.notEqual(rowOf(stay.id).accommodationSoldeContribTtc, null, 'the stored split is written from the first entry');

  await put(stay, { customOptions: [line, addition] });

  const row = rowOf(stay.id);
  assert.equal(row.balanceAmount, 494.8);
  assert.equal(row.depositAmount, 210);
  assert.equal(row.complementAmount, 20);
  assert.equal(ficheView(stay.id).ledger.remaining, 230);
});

test('R22-3 — one adult more moves neither the paid solde nor the acompte owed', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [line] });
  pay(stay.id, S);
  await put(stay, { adults: 3 });
  const row = rowOf(stay.id);
  assert.equal(row.balanceAmount, 494.8);
  assert.equal(row.depositAmount, 210);
  assert.equal(row.complementAmount, 42.4);
});

test('R22-3 — a stay reduced: the acompte still owed shrinks, the paid solde holds', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [line] });
  pay(stay.id, S);
  await put(stay, { customOptions: [] });
  const row = rowOf(stay.id);
  assert.equal(row.balanceAmount, 494.8);
  assert.equal(row.depositAmount, 110);
  assert.equal(row.complementAmount, 0);
});

test('R22-3 — the live preview answers what the save stores, whatever acompte the browser carries', async () => {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [line] });
  pay(stay.id, S);
  const quote = await liveQuote(stay.id, { adults: 2, customOptions: [], depositAmount: 12 });
  assert.equal(quote.depositAmount, 110);
  assert.equal(quote.balanceAmount, 494.8);
});

test('R22-3 — journal byte-identical through the save, the acompte then pays normally', accounting, async () => {
  const { csv, journal } = journalFixture;
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [line] });
  pay(stay.id, S);
  const before = csv();
  await put(stay, { customOptions: [line, addition] });
  assert.equal(csv(), before);
  pay(stay.id, D);
  assert.equal(rowOf(stay.id).depositPaid, 1);
  assert.equal(rowOf(stay.id).balanceAmount, 494.8);
  const [kinds] = [journal(stay.id).map(([kind]) => kind)];
  assert.deepEqual(kinds.sort(), ['balance', 'deposit']);
  const credits = journal(stay.id).find(([kind]) => kind === 'deposit')[1];
  assert.equal(Object.entries(credits).filter(([account]) => /^(70|445)/.test(account)).reduce((sum, [, value]) => sum + value, 0).toFixed(2), '210.00');
});

test('R22-3 — control: acompte then solde still keeps both, the rise goes to the complement', accounting, async () => {
  const { csv } = journalFixture;
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [line] });
  pay(stay.id, D, S);
  const before = csv();
  await put(stay, { customOptions: [line, addition] });
  assert.equal(csv(), before);
  assert.equal(rowOf(stay.id).complementAmount, 20);
});
