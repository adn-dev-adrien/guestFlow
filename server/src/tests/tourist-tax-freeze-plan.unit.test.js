// A plan pins the tax it collected (D17, Adrien, 2026-11-05):
//   specs/tourist-tax-matches-the-office-calculation.md rule 19 — fully paid, or a paid installment holding a tax share;
//   specs/tourist-tax-matches-the-office-calculation.md rule 11 — an untick does not thaw what a save stamped (R23-DB-2).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, rowOf, ADMIN, TODAY, NO_ACOMPTE, fiche, put, pay, S, free,
} = require('./moneyLedgerFixture');
const installmentsController = require('../controllers/installmentsController');
const financeController = require('../controllers/financeController');
const { isTouristTaxFrozen } = require('../utils/touristTaxFreeze');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const { liveQuote } = require('./ledgerFixture');

async function planOf(id) {
  const res = respond();
  await installmentsController.put({ params: { id }, body: { count: 2 }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return db.prepare('SELECT id FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(id);
}
function payInstallment(id, installment) {
  const res = respond();
  installmentsController.markPaid({ params: { id, installmentId: installment.id }, body: { paidDate: TODAY, method: 'transfer' }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}
const frozen = (id) => isTouristTaxFrozen(db, rowOf(id));
const moveRate = (t, rate = 2) => {
  t.after(() => db.prepare('UPDATE properties SET touristTaxPerDayPerPerson = 1.2 WHERE id = ?').run(NO_ACOMPTE));
  db.prepare('UPDATE properties SET touristTaxPerDayPerPerson = ? WHERE id = ?').run(rate, NO_ACOMPTE);
};
const preview = (id) => quoteStoredReservation(db, rowOf(id));
const line = free(30, 'Extra');

test('rule 19: a plan fully paid is pinned: the fiche replays what was collected, an unrelated save claims nothing more', async (t) => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  for (const installment of await planOf(stay.id)) payInstallment(stay.id, installment);
  const twin = fiche(NO_ACOMPTE, 'direct');
  pay(twin.id, S);
  moveRate(t);

  assert.equal(frozen(stay.id), true);
  assert.equal(preview(stay.id).touristTaxTotal, 4.8);
  assert.equal(preview(stay.id).complementAmount, 0);

  await put(stay, { customOptions: [line] });
  await put(twin, { customOptions: [line] });
  assert.equal(rowOf(stay.id).touristTaxTotal, 4.8);
  assert.equal(rowOf(stay.id).complementAmount, rowOf(twin.id).complementAmount, 'the same stay paid by solde');
  assert.equal(rowOf(stay.id).touristTaxTotal, rowOf(twin.id).touristTaxTotal);
  assert.ok(rowOf(stay.id).touristTaxFrozenAt);
});

test('rule 19: a paid installment holding a tax share pins it, an installment still due or not', async (t) => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  const plan = await planOf(stay.id);
  assert.equal(frozen(stay.id), false, 'nothing paid: live');
  payInstallment(stay.id, plan[0]);
  assert.ok(JSON.parse(db.prepare('SELECT paidSplit FROM reservation_installments WHERE id = ?').get(plan[0].id).paidSplit).taxCents > 0);
  assert.equal(frozen(stay.id), true);
  moveRate(t);
  assert.equal(preview(stay.id).touristTaxTotal, 4.8);
  await put(stay, { customOptions: [line] });
  assert.equal(rowOf(stay.id).touristTaxTotal, 4.8);
});

test('rule 19: an older paid installment with no frozen split reads its share from the plan', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  const plan = await planOf(stay.id);
  payInstallment(stay.id, plan[0]);
  db.prepare('UPDATE reservation_installments SET paidSplit = NULL WHERE id = ?').run(plan[0].id);
  assert.equal(frozen(stay.id), true);
});

test('rule 19: an installment paid with no tax share pins nothing; the plan fully paid pins all the same', async (t) => {
  const stay = fiche(NO_ACOMPTE, 'direct', { touristTaxInComplement: 1 });
  const plan = await planOf(stay.id);
  payInstallment(stay.id, plan[0]);
  assert.equal(frozen(stay.id), false, 'the tax rides the complement');
  moveRate(t);
  assert.equal(preview(stay.id).touristTaxTotal, 8);
  payInstallment(stay.id, plan[1]);
  assert.equal(frozen(stay.id), true);
});

test('rule 19: a stay with no plan and a plan with nothing paid stay live', async (t) => {
  const none = fiche(NO_ACOMPTE, 'direct');
  const unpaid = fiche(NO_ACOMPTE, 'direct');
  await planOf(unpaid.id);
  moveRate(t);
  assert.equal(frozen(none.id), false);
  assert.equal(frozen(unpaid.id), false);
  assert.equal(preview(unpaid.id).touristTaxTotal, 8);
});

test('rule 19: a party change on a paid plan still re-prices, as it does on a paid solde', async (t) => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  for (const installment of await planOf(stay.id)) payInstallment(stay.id, installment);
  moveRate(t);
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).touristTaxTotal, 12);
});

test('rule 11: an untick does not thaw what a save stamped: the rate stays out, a party change and « Recalculer » still go through', async (t) => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  await planOf(stay.id);
  // D16 refuses this tick today: one made before that decision, on a stay with nothing paid.
  db.prepare("UPDATE reservations SET touristTaxDeclaredAt = datetime('now'), touristTaxDeclaredWithAddedAmount = 0 WHERE id = ?").run(stay.id);
  await put(stay, { customOptions: [line] });
  assert.ok(rowOf(stay.id).touristTaxFrozenAt, 'the save stamped the freeze');

  const res = respond();
  financeController.setTouristTaxDeclared({ params: { reservationId: stay.id }, body: { declared: false } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(rowOf(stay.id).touristTaxDeclaredAt, null);
  assert.ok(rowOf(stay.id).touristTaxFrozenAt, 'still stamped');
  assert.equal(frozen(stay.id), true);

  moveRate(t);
  await put(stay, { customOptions: [{ ...line, amount: 40 }] });
  assert.equal(rowOf(stay.id).touristTaxTotal, 4.8);
  await put(stay, { refreshTouristTax: true });
  assert.equal(rowOf(stay.id).touristTaxTotal, 8);
});

test('rule 11: with no save between tick and untick there is no stamp, so the untick leaves the tax live', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  await planOf(stay.id);
  db.prepare("UPDATE reservations SET touristTaxDeclaredAt = datetime('now') WHERE id = ?").run(stay.id);
  assert.equal(frozen(stay.id), true);
  const res = respond();
  financeController.setTouristTaxDeclared({ params: { reservationId: stay.id }, body: { declared: false } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(frozen(stay.id), false);
});

test('rule 19: an installment paid at no tax share, the tax switched back since: its frozen split decides, nothing is pinned', async (t) => {
  const stay = fiche(NO_ACOMPTE, 'direct', { touristTaxInComplement: 1 });
  const plan = await planOf(stay.id);
  payInstallment(stay.id, plan[0]);
  assert.equal(JSON.parse(db.prepare('SELECT paidSplit FROM reservation_installments WHERE id = ?').get(plan[0].id).paidSplit).taxCents, 0);
  await put(stay, { touristTaxInComplement: 0 });
  assert.equal(rowOf(stay.id).touristTaxInComplement, 0);
  assert.equal(frozen(stay.id), false);
  moveRate(t);
  assert.equal(preview(stay.id).touristTaxTotal, 8);
});

test('rule 19, reading: calculate-price lifts the pin as the save does: a changed party shows what the save stores', async (t) => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  for (const installment of await planOf(stay.id)) payInstallment(stay.id, installment);
  moveRate(t);
  const stored = rowOf(stay.id);
  const asked = (over = {}) => liveQuote(stay.id, { adults: stored.adults, children: stored.children, teens: stored.teens, babies: stored.babies, ...over });

  assert.equal((await asked()).touristTaxTotal, 4.8, 'same stay: pinned');
  const grown = await asked({ adults: stored.adults + 1 });
  assert.equal(grown.touristTaxTotal, 12);
  await put(stay, { adults: stored.adults + 1 });
  assert.equal(rowOf(stay.id).touristTaxTotal, grown.touristTaxTotal, 'the preview said what the save stored');
});
