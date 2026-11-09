// specs/mid-stay-extras-to-end-of-stay-complement.md rule 20, reading of 2026-11-06 (audit R26 L1, accepted) — un-ticking a paid
// arrival complement leaves the « Ajouté après l'encaissement du complément d'arrivée » excess on the end of stay until the next
// save, which folds it back into the complement. The amount owed never moves, no euro is lost nor asked twice.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  rowOf, NO_ACOMPTE, S, C, forced, fiche, put, pay, ficheView,
} = require('./moneyLedgerFixture');

const owed = (id) => {
  const row = rowOf(id);
  return Math.round((row.finalPrice + row.touristTaxTotal) * 100) / 100;
};

test('untick then save: the excess waits on the end of stay, then follows the complement; the total owed never moves', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 42.4);
  const total = owed(stay.id);

  pay(stay.id, { complementPaid: false });
  let row = rowOf(stay.id);
  assert.equal(row.complementPaid, 0);
  assert.equal(row.complementAmount, 20);
  assert.equal(row.endOfStayComplementAmount, 42.4);
  assert.equal(owed(stay.id), total);
  assert.equal(ficheView(stay.id).ledger.remaining, 62.4);

  await put(stay);
  row = rowOf(stay.id);
  assert.equal(row.complementAmount, 62.4);
  assert.equal(row.endOfStayComplementAmount, 0);
  assert.equal(owed(stay.id), total);
  assert.equal(ficheView(stay.id).ledger.remaining, 62.4);

  await put(stay);
  const again = rowOf(stay.id);
  assert.equal(again.complementAmount, 62.4);
  assert.equal(again.endOfStayComplementAmount, 0);
  assert.equal(owed(stay.id), total);
});
