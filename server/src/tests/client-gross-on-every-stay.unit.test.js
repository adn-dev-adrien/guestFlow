// specs/accounting-platform-commission-and-no-deposit.md rule 24 — `clientGrossAmount` is populated on a direct stay too: the gross
// is the stay's price, so no reader has to guess for a stay with no platform.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rowOf, NO_ACOMPTE, fiche, put } = require('./moneyLedgerFixture');

test('rule 24: a direct stay stores its price as its gross, at creation and after a save', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  assert.equal(rowOf(stay.id).clientGrossAmount, rowOf(stay.id).finalPrice);
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).clientGrossAmount, rowOf(stay.id).finalPrice);
});
