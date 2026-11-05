// A stay with an installment plan on « Suivi taxe de séjour » (D14, 2026-11-05):
//   specs/tourist-tax-declaration-month-stay-end.md rule 7 — it enters at its stay month, whatever is paid;
//   specs/tourist-tax-declaration-month-stay-end.md rule 8 — and in that month only, other stays keep their gate;
//   specs/tourist-tax-declared-checkbox.md rule 7 — its tick works like any other, even on a tax not yet collected;
//   specs/platform-added-guests-tourist-tax.md rule 28 — main row and row of its own read as on any stay;
//   specs/direct-installments.md rule 51 — paying an installment never touches balancePaid, so the gate cannot read it.
// Everything goes through the real controllers. Each test has its month, so no stay collides with another.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, rowOf, ADMIN, TODAY, NO_ACOMPTE, PLATFORM, S, C, fiche, put, pay, cancel, refund,
} = require('./moneyLedgerFixture');
const installmentsController = require('../controllers/installmentsController');
const financeController = require('../controllers/financeController');
const { refreshDirectChannels } = require('../utils/platformNameFormat');

const pad2 = (n) => String(n).padStart(2, '0');
const monthOf = (offset) => {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};
const next = (month, by = 1) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
};

let slot = 0;
/** A month of its own, far enough ahead for a plan to have room. */
const nextMonth = () => { slot += 1; return monthOf(2 + slot); };
const twoNights = (month) => ({ startDate: `${month}-10`, endDate: `${month}-12` });

const clockAt = (t, iso) => {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${iso}T12:00:00`).getTime() });
};

async function planOf(id, count = 2) {
  const res = respond();
  await installmentsController.put({ params: { id }, body: { count }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return db.prepare('SELECT id, amountCents FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(id);
}
function payInstallment(id, installment, paidDate = TODAY) {
  const res = respond();
  installmentsController.markPaid({ params: { id, installmentId: installment.id }, body: { paidDate, method: 'transfer' }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}
function page(month) {
  const res = respond();
  financeController.touristTax({ query: { month } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}
function tick(id, declared = true, addedGuests = false) {
  const res = respond();
  financeController.setTouristTaxDeclared({ params: { reservationId: id }, body: { declared, addedGuests } }, res);
  return res;
}
const rowsOf = (data, id) => data.reservations.filter((r) => r.reservationId === id);
const mainOf = (data, id) => rowsOf(data, id).find((r) => !r.addedGuestsRow);
const addedOf = (data, id) => rowsOf(data, id).find((r) => r.addedGuestsRow);
const directStay = (month, extra = {}) => fiche(NO_ACOMPTE, 'direct', { ...twoNights(month), ...extra });
const addedGuestStay = async (month) => {
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { ...twoNights(month), platformGrossAmount: 600 });
  await put(stay, { adults: 3 });
  return stay;
};
const stamp = (id) => rowOf(id).touristTaxDeclaredWithAddedAmount;

test('rule 7: a plan fully paid is listed, with the amount, the KPIs and the aggregate of the same stay paid by solde', async (t) => {
  const month = nextMonth();
  const stay = directStay(month);
  const plan = await planOf(stay.id);
  for (const installment of plan) payInstallment(stay.id, installment);
  assert.equal(rowOf(stay.id).balancePaid, 0);
  assert.equal(rowOf(stay.id).installmentsPaidAmount, 604.8);

  const twinMonth = nextMonth();
  const twin = directStay(twinMonth);
  pay(twin.id, S);

  clockAt(t, `${next(twinMonth)}-15`);
  const data = page(month);
  const row = mainOf(data, stay.id);
  assert.equal(row.taxAmount, 4.8);
  assert.equal(row.adults, 2);
  assert.equal(row.nightsCount, 2);
  assert.equal(row.adultNights, 4);
  assert.equal(row.taxRate, 1.2);
  assert.equal(row.touristTaxDeclaredAt, null);

  const paidBySolde = page(twinMonth);
  const figures = ({ reservationId, startDate, endDate, lastNightDate, ...rest }) => rest;
  assert.deepEqual(figures(row), figures(mainOf(paidBySolde, twin.id)));
  assert.deepEqual(data.totals, paidBySolde.totals);
  assert.deepEqual(data.byProperty, paidBySolde.byProperty);

  assert.deepEqual(
    { count: data.totals.reservationsCount, nights: data.totals.rentedNights, adultNights: data.totals.adultNights, tax: data.totals.taxAmount },
    { count: 1, nights: 2, adultNights: 4, tax: 4.8 },
  );
  const [aggregate] = data.byProperty;
  assert.equal(data.byProperty.length, 1);
  assert.equal(aggregate.propertyId, NO_ACOMPTE);
  assert.equal(aggregate.reservationsCount, 1);
  assert.equal(aggregate.nightsCount, 2);
  assert.equal(aggregate.adultNights, 4);
  assert.equal(aggregate.taxAmount, 4.8);
  assert.equal(aggregate.accommodationAmount, row.accommodationAmount);
});

test('rule 7: a plan partly paid is listed for the whole tax', async (t) => {
  const month = nextMonth();
  const stay = directStay(month);
  const plan = await planOf(stay.id);
  payInstallment(stay.id, plan[0]);
  clockAt(t, `${next(month)}-15`);
  const data = page(month);
  assert.equal(mainOf(data, stay.id).taxAmount, 4.8);
  assert.equal(data.totals.taxAmount, 4.8);
  assert.equal(data.byProperty[0].taxAmount, 4.8);
});

test('rule 7: a plan with nothing paid yet is listed, during its stay month already', async (t) => {
  const month = nextMonth();
  const stay = directStay(month);
  await planOf(stay.id);
  clockAt(t, `${month}-05`);
  const data = page(month);
  assert.equal(rowOf(stay.id).installmentsPaidAmount, 0);
  assert.equal(mainOf(data, stay.id).taxAmount, 4.8);
  assert.equal(data.totals.reservationsCount, 1);
});

test('rule 7: the stay month, never the payment month: an installment paid after the stay moves nothing', async (t) => {
  const month = nextMonth();
  const stay = directStay(month);
  const plan = await planOf(stay.id);
  payInstallment(stay.id, plan[0]);
  clockAt(t, `${next(month, 1)}-05`);
  payInstallment(stay.id, plan[1], `${next(month, 1)}-05`);
  assert.equal(rowOf(stay.id).installmentsLastPaidDate, `${next(month, 1)}-05`);

  clockAt(t, `${next(month, 2)}-15`);
  assert.equal(rowsOf(page(next(month, -1)), stay.id).length, 0);
  assert.equal(rowsOf(page(month), stay.id).length, 1);
  assert.equal(rowsOf(page(next(month, 1)), stay.id).length, 0);
});

test('rule 7: the month of the last night: a departure on the 1st belongs to the month before', async (t) => {
  const month = nextMonth();
  slot += 1;
  const stay = fiche(NO_ACOMPTE, 'direct', { startDate: `${month}-27`, endDate: `${next(month)}-01` });
  await planOf(stay.id);
  clockAt(t, `${next(month, 2)}-15`);
  assert.equal(rowsOf(page(month), stay.id).length, 1);
  assert.equal(rowsOf(page(next(month)), stay.id).length, 0);
});

test('rule 8: a stay without a plan keeps its gate: absent unpaid, at the payment month when paid late', async (t) => {
  const month = nextMonth();
  slot += 1;
  const stay = directStay(month);
  clockAt(t, `${next(month, 2)}-15`);
  assert.equal(rowsOf(page(month), stay.id).length, 0);
  pay(stay.id, { balancePaid: true, balancePaidDate: `${next(month, 1)}-05` });
  assert.equal(rowsOf(page(month), stay.id).length, 0);
  assert.equal(rowsOf(page(next(month, 1)), stay.id).length, 1);
});

test('rule 8: a stay without a plan whose tax rides the complement keeps the complement as its gate', async (t) => {
  const month = nextMonth();
  const stay = directStay(month, { touristTaxInComplement: 1 });
  pay(stay.id, S);
  clockAt(t, `${next(month)}-15`);
  assert.equal(rowsOf(page(month), stay.id).length, 0);
  pay(stay.id, C);
  assert.equal(rowsOf(page(month), stay.id).length, 1);
});

test('rule 8: one month only: a plan row beside a solde flag paid later is not listed twice', async (t) => {
  const month = nextMonth();
  const stay = directStay(month);
  await planOf(stay.id);
  db.prepare('UPDATE reservations SET balancePaid = 1, balancePaidDate = ? WHERE id = ?').run(`${next(month)}-05`, stay.id);
  clockAt(t, `${next(month, 2)}-15`);
  assert.equal(rowsOf(page(month), stay.id).length, 1);
  assert.equal(rowsOf(page(next(month)), stay.id).length, 0);
});

test('rule 7: a plan whose tax is forced to the complement enters too, the complement unpaid', async (t) => {
  const month = nextMonth();
  const stay = directStay(month, { touristTaxInComplement: 1 });
  await planOf(stay.id);
  clockAt(t, `${next(month)}-15`);
  assert.equal(mainOf(page(month), stay.id).taxAmount, 4.8);
  assert.equal(rowsOf(page(next(month)), stay.id).length, 0);
  pay(stay.id, { complementPaid: true, complementPaidDate: `${next(month)}-05` });
  assert.equal(rowsOf(page(month), stay.id).length, 1);
  assert.equal(rowsOf(page(next(month)), stay.id).length, 0);
});

test('rule 7: an own channel that remits the tax itself stays off the page, plan or not', async (t) => {
  const name = 'CanalRemet';
  db.prepare('INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform, platformTakesDeposit, countsAsDirect) VALUES (?, 1, 1, 1, 1)').run(name);
  refreshDirectChannels(db);
  const month = nextMonth();
  const stay = fiche(NO_ACOMPTE, name, twoNights(month));
  await planOf(stay.id);
  clockAt(t, `${next(month)}-15`);
  assert.equal(rowsOf(page(month), stay.id).length, 0);
});

test('specs/tourist-tax-declared-checkbox.md rule 7: tick and untick on a plan with an installment still due', async (t) => {
  const month = nextMonth();
  const stay = directStay(month);
  const plan = await planOf(stay.id);
  payInstallment(stay.id, plan[0]);
  clockAt(t, `${next(month)}-15`);

  const first = tick(stay.id);
  assert.equal(first.statusCode, 200);
  assert.ok(first.body.declaredAt);
  assert.equal(mainOf(page(month), stay.id).touristTaxDeclaredAt, first.body.declaredAt);
  assert.equal(stamp(stay.id), 0);

  const DECLARED = `${month}-20 09:00:00`;
  db.prepare('UPDATE reservations SET touristTaxDeclaredAt = ? WHERE id = ?').run(DECLARED, stay.id);
  assert.equal(tick(stay.id).body.declaredAt, DECLARED);

  payInstallment(stay.id, plan[1], `${next(month)}-15`);
  const after = mainOf(page(month), stay.id);
  assert.equal(after.touristTaxDeclaredAt, DECLARED);
  assert.equal(after.taxAmount, 4.8);

  const off = tick(stay.id, false);
  assert.equal(off.statusCode, 200);
  assert.equal(off.body.declaredAt, null);
  assert.equal(stamp(stay.id), null);
  assert.equal(mainOf(page(month), stay.id).touristTaxDeclaredAt, null);
});

test('specs/tourist-tax-declared-checkbox.md rule 7: a ticked plan keeps the amount told to the commune when the commune\'s rate moves', async (t) => {
  const month = nextMonth();
  const stay = directStay(month);
  await planOf(stay.id);
  clockAt(t, `${next(month)}-15`);
  tick(stay.id);
  t.after(() => db.prepare('UPDATE properties SET touristTaxPerDayPerPerson = 1.2 WHERE id = ?').run(NO_ACOMPTE));
  db.prepare('UPDATE properties SET touristTaxPerDayPerPerson = 2 WHERE id = ?').run(NO_ACOMPTE);
  assert.equal(mainOf(page(month), stay.id).taxAmount, 4.8);
});

test('rule 7: a refunded night leaves the row, the KPIs and the aggregate; all of them and the row leaves', async (t) => {
  const month = nextMonth();
  const stay = directStay(month);
  const plan = await planOf(stay.id);
  for (const installment of plan) payInstallment(stay.id, installment);
  assert.equal(refund(stay.id, [{ key: 'touristTax', amountTtc: 2.4 }]).statusCode, 201);

  clockAt(t, `${next(month)}-15`);
  const data = page(month);
  const row = mainOf(data, stay.id);
  assert.equal(row.nightsCount, 1);
  assert.equal(row.adultNights, 2);
  assert.equal(row.taxAmount, 2.4);
  assert.equal(row.refundedTaxNights, 1);
  assert.equal(row.refundedTaxAmount, 2.4);
  assert.equal(data.totals.taxAmount, 2.4);
  assert.equal(data.totals.rentedNights, 1);
  assert.equal(data.byProperty[0].taxAmount, 2.4);

  assert.equal(refund(stay.id, [{ key: 'touristTax', amountTtc: 2.4 }]).statusCode, 201);
  assert.equal(rowsOf(page(month), stay.id).length, 0);
});

test('rule 7: a cancelled stay leaves the page as any other does, money paid or not, ticked or not', async (t) => {
  const month = nextMonth();
  const paid = directStay(month);
  const plan = await planOf(paid.id);
  payInstallment(paid.id, plan[0]);
  await cancel(paid.id);

  const declaredMonth = nextMonth();
  const declared = directStay(declaredMonth);
  await planOf(declared.id);

  clockAt(t, `${declaredMonth}-05`);
  assert.equal(rowsOf(page(month), paid.id).length, 0);
  assert.equal(tick(paid.id).statusCode, 404);
  assert.equal(tick(declared.id).statusCode, 200);
  assert.equal(rowsOf(page(declaredMonth), declared.id).length, 1);
  t.mock.timers.reset();
  await cancel(declared.id);
  clockAt(t, `${declaredMonth}-05`);
  assert.equal(rowsOf(page(declaredMonth), declared.id).length, 0);
});

test('rule 8: a plan removed again gives the stay its gate back, its tick kept', async (t) => {
  const month = nextMonth();
  const stay = directStay(month);
  await planOf(stay.id);

  clockAt(t, `${month}-05`);
  assert.equal(rowsOf(page(month), stay.id).length, 1);
  tick(stay.id);
  t.mock.timers.reset();

  const res = respond();
  await installmentsController.remove({ params: { id: stay.id }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  clockAt(t, `${next(month)}-15`);
  assert.equal(rowsOf(page(month), stay.id).length, 0);
  assert.ok(rowOf(stay.id).touristTaxDeclaredAt);
  pay(stay.id, S);
  const row = mainOf(page(month), stay.id);
  assert.equal(row.taxAmount, 4.8);
  assert.ok(row.touristTaxDeclaredAt);
});

test('specs/platform-added-guests-tourist-tax.md rule 28: complement paid before the tick: one row holds it all, the stamp says so', async (t) => {
  const month = nextMonth();
  const stay = await addedGuestStay(month);
  const plan = await planOf(stay.id);
  for (const installment of plan) payInstallment(stay.id, installment);
  pay(stay.id, C);

  clockAt(t, `${next(month)}-15`);
  const before = page(month);
  assert.equal(rowsOf(before, stay.id).length, 1);
  const main = mainOf(before, stay.id);
  assert.equal(main.taxAmount, 7.2);
  assert.equal(main.adults, 3);
  assert.equal(main.adultNights, 6);

  assert.equal(tick(stay.id).statusCode, 200);
  assert.equal(stamp(stay.id), 2.4);
  const after = page(month);
  assert.equal(rowsOf(after, stay.id).length, 1);
  assert.equal(after.totals.taxAmount, 7.2);
});

test('specs/platform-added-guests-tourist-tax.md rule 28: ticked before the complement: main row at the paid party, then a row of its own', async (t) => {
  const month = nextMonth();
  const stay = await addedGuestStay(month);
  const plan = await planOf(stay.id);
  payInstallment(stay.id, plan[0]);

  clockAt(t, `${next(month)}-15`);
  const open = page(month);
  assert.equal(rowsOf(open, stay.id).length, 1);
  assert.equal(mainOf(open, stay.id).taxAmount, 4.8);
  assert.equal(mainOf(open, stay.id).adults, 2);

  assert.equal(tick(stay.id, true, true).statusCode, 409);
  assert.equal(tick(stay.id).statusCode, 200);
  assert.equal(stamp(stay.id), 0);
  assert.equal(rowsOf(page(month), stay.id).length, 1);

  pay(stay.id, { ...C, complementPaidDate: `${month}-20` });
  const both = page(month);
  assert.equal(mainOf(both, stay.id).taxAmount, 4.8);
  const own = addedOf(both, stay.id);
  assert.equal(own.taxAmount, 2.4);
  assert.equal(own.adults, 1);
  assert.equal(own.adultNights, 2);
  assert.equal(own.accommodationAmount, 0);
  assert.deepEqual(
    { count: both.totals.reservationsCount, nights: both.totals.rentedNights, adultNights: both.totals.adultNights, tax: both.totals.taxAmount },
    { count: 1, nights: 2, adultNights: 6, tax: 7.2 },
  );
  assert.equal(both.byProperty[0].reservationsCount, 1);
  assert.equal(both.byProperty[0].nightsCount, 2);
  assert.equal(both.byProperty[0].adultNights, 6);
  assert.equal(both.byProperty[0].taxAmount, 7.2);

  assert.equal(tick(stay.id, true, true).statusCode, 200);
  assert.ok(addedOf(page(month), stay.id).touristTaxDeclaredAt);

  pay(stay.id, { complementPaid: false });
  assert.equal(rowOf(stay.id).touristTaxAddedGuestsDeclaredAt, null);
  assert.equal(rowsOf(page(month), stay.id).length, 1);
});

test('specs/platform-added-guests-tourist-tax.md rule 28: the row of its own is told in the month the complement was collected, the main row stays', async (t) => {
  const month = nextMonth();
  slot += 1;
  const stay = await addedGuestStay(month);
  await planOf(stay.id);
  clockAt(t, `${next(month)}-05`);
  tick(stay.id);
  pay(stay.id, { complementPaid: true, complementPaidDate: `${next(month)}-05` });

  clockAt(t, `${next(month, 2)}-15`);
  const stayMonth = page(month);
  assert.equal(rowsOf(stayMonth, stay.id).length, 1);
  assert.equal(mainOf(stayMonth, stay.id).taxAmount, 4.8);
  const collectedMonth = page(next(month));
  assert.equal(rowsOf(collectedMonth, stay.id).length, 1);
  assert.equal(addedOf(collectedMonth, stay.id).taxAmount, 2.4);
  assert.equal(collectedMonth.totals.reservationsCount, 0);
  assert.equal(collectedMonth.totals.taxAmount, 2.4);
});

test('specs/platform-added-guests-tourist-tax.md rule 28: a guest added after the tick of a paid plan gets a row of its own', async (t) => {
  const month = nextMonth();
  const stay = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { ...twoNights(month), platformGrossAmount: 600 });
  const plan = await planOf(stay.id);
  for (const installment of plan) payInstallment(stay.id, installment);

  clockAt(t, `${month}-05`);
  assert.equal(mainOf(page(month), stay.id).taxAmount, 4.8);
  tick(stay.id);
  await put(stay, { adults: 3 });
  assert.equal(rowOf(stay.id).touristTaxAddedGuestsAmount, 2.4);
  pay(stay.id, { complementPaid: true, complementPaidDate: `${month}-05` });

  const data = page(month);
  assert.equal(mainOf(data, stay.id).taxAmount, 4.8);
  assert.equal(addedOf(data, stay.id).taxAmount, 2.4);
  assert.equal(data.totals.taxAmount, 7.2);
});

test('specs/platform-added-guests-tourist-tax.md rule 28: a NULL stamp reads the dates, the row and the SQL alike', async (t) => {
  const month = nextMonth();
  const stay = await addedGuestStay(month);
  await planOf(stay.id);
  clockAt(t, `${next(month)}-15`);
  pay(stay.id, { complementPaid: true, complementPaidDate: `${month}-20` });
  const legacy = db.prepare('UPDATE reservations SET touristTaxDeclaredAt = ?, touristTaxDeclaredWithAddedAmount = NULL WHERE id = ?');

  legacy.run(`${month}-11 09:00:00`, stay.id);
  const split = page(month);
  assert.equal(mainOf(split, stay.id).taxAmount, 4.8);
  assert.equal(addedOf(split, stay.id).taxAmount, 2.4);

  legacy.run(`${month}-25 09:00:00`, stay.id);
  const merged = page(month);
  assert.equal(rowsOf(merged, stay.id).length, 1);
  assert.equal(mainOf(merged, stay.id).taxAmount, 7.2);
});
