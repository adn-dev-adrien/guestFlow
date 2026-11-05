// « Déclarée » waits for a stay paid and over (D16, Adrien, 2026-11-05):
//   specs/tourist-tax-declared-checkbox.md rule 8 — the tick and its flag, main row and row of its own.
// D16 withdraws D14's « a tax not yet collected can be declared »; the plan row placement stays.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, rowOf, ADMIN, TODAY, NO_ACOMPTE, PLATFORM, S, C, fiche, put, pay,
} = require('./moneyLedgerFixture');
const installmentsController = require('../controllers/installmentsController');
const financeController = require('../controllers/financeController');
const { isTouristTaxDeclarable } = require('../utils/touristTaxFreeze');

const REFUSAL = 'Déclarable une fois le séjour payé et terminé.';
const monthAhead = (offset) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const after = (month) => monthAhead(Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - (new Date().getFullYear() * 12 + new Date().getMonth() + 1) + 1);
let slot = 2;
const nextMonth = () => { slot += 1; return monthAhead(slot); };
const stayIn = (month, platform = 'direct', extra = {}) => fiche(NO_ACOMPTE, platform, { startDate: `${month}-10`, endDate: `${month}-12`, ...extra });

const clockAt = (t, stamp) => {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: new Date(stamp).getTime() });
};
const tick = (id, declared = true, addedGuests = false) => {
  const res = respond();
  financeController.setTouristTaxDeclared({ params: { reservationId: id }, body: { declared, addedGuests } }, res);
  return res;
};
const rowsOf = (month, id) => {
  const res = respond();
  financeController.touristTax({ query: { month } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.reservations.filter((r) => r.reservationId === id);
};
const mainOf = (month, id) => rowsOf(month, id).find((r) => !r.addedGuestsRow);
const ownOf = (month, id) => rowsOf(month, id).find((r) => r.addedGuestsRow);
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
const assertRefused = (res) => {
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'TOURIST_TAX_NOT_DECLARABLE');
  assert.equal(res.body.error, REFUSAL);
};

test('rule 8: the stay paid but not over: refused, flag false, nothing written, on its last day too', (t) => {
  const month = nextMonth();
  const stay = stayIn(month);
  pay(stay.id, S);

  clockAt(t, `${month}-11T12:00:00`);
  assert.equal(mainOf(month, stay.id).declarable, false);
  assertRefused(tick(stay.id));

  clockAt(t, `${month}-12T23:30:00`);
  assert.equal(mainOf(month, stay.id).declarable, false, 'today = endDate is not over');
  assertRefused(tick(stay.id));
  assert.equal(rowOf(stay.id).touristTaxDeclaredAt, null);
  assert.equal(rowOf(stay.id).touristTaxDeclaredWithAddedAmount, null);

  clockAt(t, `${month}-13T00:30:00`);
  assert.equal(mainOf(month, stay.id).declarable, true, 'the local day after the end');
  assert.equal(tick(stay.id).statusCode, 200);
  assert.ok(rowOf(stay.id).touristTaxDeclaredAt);
});

test('rule 8: over but not paid: refused, from a screen left open on a row the gate dropped', (t) => {
  const month = nextMonth();
  const stay = stayIn(month);
  pay(stay.id, S);
  pay(stay.id, { balancePaid: false });
  clockAt(t, `${after(month)}-15T12:00:00`);
  assertRefused(tick(stay.id));
});

test('rule 8: paid reads the bucket carrying the tax: a tax on the complement waits for the complement', (t) => {
  const month = nextMonth();
  const stay = stayIn(month, 'direct', { touristTaxInComplement: 1 });
  pay(stay.id, S);
  clockAt(t, `${after(month)}-15T12:00:00`);
  assertRefused(tick(stay.id));
  pay(stay.id, { complementPaid: true, complementPaidDate: `${month}-12` });
  assert.equal(mainOf(month, stay.id).declarable, true);
  assert.equal(tick(stay.id).statusCode, 200);
});

test('rule 8: a plan is listed with an installment due, not declarable until every installment is paid', async (t) => {
  const month = nextMonth();
  const stay = stayIn(month);
  const plan = await planOf(stay.id);
  payInstallment(stay.id, plan[0]);
  clockAt(t, `${after(month)}-15T12:00:00`);
  assert.equal(mainOf(month, stay.id).declarable, false);
  assertRefused(tick(stay.id));
  t.mock.timers.reset();

  payInstallment(stay.id, plan[1]);
  clockAt(t, `${month}-11T12:00:00`);
  assert.equal(mainOf(month, stay.id).declarable, false, 'paid, still under way');
  assertRefused(tick(stay.id));

  clockAt(t, `${after(month)}-15T12:00:00`);
  assert.equal(mainOf(month, stay.id).declarable, true);
  assert.equal(tick(stay.id).statusCode, 200);
});

test('rule 8: the row of its own is judged too: main tick stored, complement collected, stay under way', async (t) => {
  const month = nextMonth();
  const stay = stayIn(month, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  pay(stay.id, S);
  db.prepare('UPDATE reservations SET touristTaxDeclaredAt = ?, touristTaxDeclaredWithAddedAmount = 0 WHERE id = ?').run(`${month}-01 09:00:00`, stay.id);
  pay(stay.id, { complementPaid: true, complementPaidDate: TODAY });

  clockAt(t, `${month}-11T12:00:00`);
  assert.equal(ownOf(month, stay.id).declarable, false);
  assertRefused(tick(stay.id, true, true));
  assert.equal(rowOf(stay.id).touristTaxAddedGuestsDeclaredAt, null);

  clockAt(t, `${month}-13T12:00:00`);
  assert.equal(ownOf(month, stay.id).declarable, true);
  assert.equal(tick(stay.id, true, true).statusCode, 200);
});

test('rule 8: a stored tick is not rewritten: sent back unchanged it passes with its date, the untick passes', (t) => {
  const month = nextMonth();
  const stay = stayIn(month);
  pay(stay.id, S);
  const STORED = `${month}-01 09:00:00`;
  db.prepare('UPDATE reservations SET touristTaxDeclaredAt = ?, touristTaxDeclaredWithAddedAmount = 0 WHERE id = ?').run(STORED, stay.id);

  clockAt(t, `${month}-11T12:00:00`);
  assert.equal(mainOf(month, stay.id).touristTaxDeclaredAt, STORED);
  assert.equal(mainOf(month, stay.id).declarable, false);
  const same = tick(stay.id);
  assert.equal(same.statusCode, 200);
  assert.equal(same.body.declaredAt, STORED);

  assert.equal(tick(stay.id, false).statusCode, 200);
  assert.equal(rowOf(stay.id).touristTaxDeclaredAt, null);
  assertRefused(tick(stay.id));
});

test('rule 8: the own tick sent back unchanged keeps its date and the untick passes, the stay unpaid since', async (t) => {
  const month = nextMonth();
  const stay = stayIn(month, PLATFORM.ownReversed, { platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  pay(stay.id, S, C);
  const STORED = `${month}-01 09:00:00`;
  db.prepare('UPDATE reservations SET touristTaxDeclaredAt = ?, touristTaxDeclaredWithAddedAmount = 0, touristTaxAddedGuestsDeclaredAt = ? WHERE id = ?').run(STORED, STORED, stay.id);
  pay(stay.id, { balancePaid: false });
  const same = tick(stay.id, true, true);
  assert.equal(same.statusCode, 200, JSON.stringify(same.body));
  assert.equal(same.body.declaredAt, STORED);
  assert.equal(tick(stay.id, false, true).statusCode, 200);
  assert.equal(rowOf(stay.id).touristTaxAddedGuestsDeclaredAt, null);
});

test('rule 8: no stay, nothing to judge; a stay whose end date is missing is never declarable', () => {
  assert.equal(isTouristTaxDeclarable(db, null), false);
  assert.equal(isTouristTaxDeclarable(db, { id: 0, balancePaid: 1 }), false);
});
