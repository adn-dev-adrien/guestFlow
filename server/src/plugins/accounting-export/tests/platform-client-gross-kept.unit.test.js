// specs/accounting-books-the-money-collected.md rule 4, reading of 2026-11-05 (audit R22-1 of the reservations slice) —
// a save on a non-direct stay keeps `clientGrossAmount` unless the body carries a number: no client sends the retired
// field, and the export still books legacy stays from it. A closed month never moves.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, NO_ACOMPTE, PLATFORM, S, fiche, pay, csv, rowOf, controller, respond, ADMIN, month,
} = require('./journalFixture');
const model = require('../../../models/reservationsModel');
const { toUpdateBody } = require('../../../utils/reservationUpdateBody');

async function resave(id, over = {}) {
  const res = respond();
  await controller.update({ params: { id }, body: { ...toUpdateBody(model.getByIdWithDetails(id)), forceOverpayment: true, ...over }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}

function legacyStay() {
  const stay = fiche(NO_ACOMPTE, PLATFORM.reversed, {});
  pay(stay.id, S);
  const final = rowOf(stay.id).finalPrice;
  db.prepare('UPDATE reservations SET clientGrossAmount = ?, platformCommissionAmount = NULL WHERE id = ?').run(final + 66, stay.id);
  return { id: stay.id, gross: final + 66 };
}

test('a legacy platform stay saved unchanged: clientGrossAmount kept, journal byte-identical', async () => {
  const { id, gross } = legacyStay();
  const before = csv();
  await resave(id);
  assert.equal(rowOf(id).clientGrossAmount, gross);
  assert.equal(csv(), before);
  assert.equal(month().totals.allBalanced, true);
});

test('a body that names a number still writes it; empty and null are « not carried »', async () => {
  const { id, gross } = legacyStay();
  await resave(id, { clientGrossAmount: null });
  assert.equal(rowOf(id).clientGrossAmount, gross);
  await resave(id, { clientGrossAmount: '' });
  assert.equal(rowOf(id).clientGrossAmount, gross);
  await resave(id, { clientGrossAmount: gross + 1 });
  assert.equal(rowOf(id).clientGrossAmount, gross + 1);
});

test('a direct stay moved to a platform takes no stale figure from its direct life', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', {});
  assert.equal(rowOf(stay.id).clientGrossAmount, rowOf(stay.id).finalPrice);
  await resave(stay.id, { platform: PLATFORM.reversed });
  assert.equal(rowOf(stay.id).clientGrossAmount, null);
});
