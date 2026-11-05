// specs/reservation-refunds.md rule 50 (D10, audit R22-7, 2026-11-05) — a live stay refuses a book refund above what it
// collected, as a cancelled stay does. The caisse interne is off the books and judged apart.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, rowOf, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, D, free, fiche, put, pay, refund, register, ficheView,
} = require('./moneyLedgerFixture');

const ACCOMMODATION = 'accommodation';
const TAX = 'touristTax';

test('D10 — nothing collected on a direct stay: a refund is refused with what was collected', () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  const res = refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 10 }]);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'REFUND_EXCEEDS_COLLECTED');
  assert.match(res.body.error, /Dépasse l’encaissé \(0,00.€\)/);
  assert.equal(register(stay.id).refunds.length, 0);
});

test('D10 — reversed platform with a guest added, solde collected: 600 € at most, not the 642,40 € offered', async () => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.reversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  pay(stay.id, S);
  const refused = refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 635.2 }, { key: TAX, amountTtc: 7.2 }]);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.body.code, 'REFUND_EXCEEDS_COLLECTED');
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 595.2 }, { key: TAX, amountTtc: 4.8 }]).statusCode, 201);
  assert.equal(register(stay.id).collectedTtc, 0);
  assert.equal(refund(stay.id, [{ label: 'Geste', bucket: 'options', amountTtc: 0.01 }]).statusCode, 409, 'nothing left');
});

test('D10 — acompte collected: refunds add up to it at most, and it is net of the earlier ones', () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  pay(stay.id, D);
  const collected = rowOf(stay.id).depositAmount;
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: collected + 0.01 }]).statusCode, 409);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 50 }]).statusCode, 201);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: collected - 49 }]).statusCode, 409);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: collected - 50 }]).statusCode, 201);
});

test('D10 — the tax on its own stays free per line: only the total is judged', () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  pay(stay.id, D);
  assert.equal(refund(stay.id, [{ key: TAX, amountTtc: 4.8 }]).statusCode, 201);
});

test('D10 — a refund in the caisse interne is not a book refund: the rule leaves it alone', () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  db.prepare('UPDATE reservations SET balancePaidCash = 1 WHERE id = ?').run(stay.id);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 10 }], 'internal').statusCode, 201);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: 10 }]).statusCode, 409, 'the transfer finds no book money');
});

test('D10 — a line refund keeps its own refusal first; a trop-perçu refund is within what was collected', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  pay(stay.id, S);
  const key = register(stay.id).refundableLines.find((l) => l.label === 'Libre').key;
  assert.equal(refund(stay.id, [{ key, amountTtc: 100.01 }]).body.code, 'REFUND_EXCEEDS_LINE');
  await put(stay, { customOptions: [] });
  assert.equal(ficheView(stay.id).ledger.remaining, 0);
  assert.equal(refund(stay.id, [{ label: 'Trop-perçu', bucket: 'options', amountTtc: 100 }]).statusCode, 201);
});
