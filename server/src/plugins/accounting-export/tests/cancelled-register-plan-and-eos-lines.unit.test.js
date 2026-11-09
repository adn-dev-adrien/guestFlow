// specs/reservation-refunds.md rule 49, reading of 2026-11-05 (audit R23 N5, N6) — money a cancelled stay collected stays on a
// line of its register: the options and resources shares of paid installments beyond the lines still naming them, and a paid
// end-of-stay complement. Given back whole, every account nets to 0. Replays of the auditor's a12, a1 and a2 probes.
// A future stay holding a paid end of stay is a row stored before D20 (reservation-payment-ledger rule 68): written as stored.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, ADMIN, TODAY, NO_ACOMPTE, S, C, forced, free, fiche, put, pay, storedEndOfStayPaid, cancel, register, offered, giveAll, net,
} = require('./journalFixture');
const installmentsController = require('../../../controllers/installmentsController');

db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (71, 'Panier', 'per_stay', 80)").run();
db.prepare("INSERT INTO resources (id, name, quantity, priceType, price) VALUES (72, 'Bain', 1, 'per_stay', 54)").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, 71)').run(NO_ACOMPTE);
db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (72, ?)').run(NO_ACOMPTE);

const PLAN_OPTIONS = 'plan:options';
const PLAN_RESOURCES = 'plan:resources';

async function plan(stay, paidCount = 2) {
  const set = respond();
  await installmentsController.put({ params: { id: stay.id }, body: { count: 2 }, user: ADMIN }, set);
  assert.equal(set.statusCode, 200, JSON.stringify(set.body));
  const rows = db.prepare('SELECT id FROM reservation_installments WHERE reservationId = ? ORDER BY number').all(stay.id);
  for (const installment of rows.slice(0, paidCount)) {
    const res = respond();
    await installmentsController.markPaid({ params: { id: stay.id, installmentId: installment.id }, body: { paidDate: TODAY, method: 'transfer' }, user: ADMIN }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  }
}
function givesAll(id) {
  giveAll(id);
  assert.deepEqual(net(id), {});
  assert.equal(register(id).collectedTtc, 0);
}
const lineOf = (id, key) => register(id).refundableLines.find((l) => l.key === key);

test('N5 — plan paid, a paid line of 100 € removed: offered under « Prestations encaissées », every account 0', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  await plan(stay);
  await put(stay, { customOptions: [] });
  await cancel(stay.id);
  const line = lineOf(stay.id, PLAN_OPTIONS);
  assert.equal(line.refundableTtc, 100);
  assert.equal(line.label, 'Prestations encaissées');
  assert.equal(line.bucket, 'options');
  givesAll(stay.id);
});

test('N5 — plan paid, a line lowered 100 → 40 €: 40 € on the line, 60 € on the bucket’s', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  await plan(stay);
  await put(stay, { customOptions: [free(40)] });
  await cancel(stay.id);
  assert.equal(offered(stay.id)[PLAN_OPTIONS], 60);
  assert.equal(offered(stay.id)['custom:libre'], 40);
  givesAll(stay.id);
});

test('N5 — half-paid plan, line moved to the complement: what the plan collected on it is offered', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  await plan(stay, 1);
  await put(stay, { customOptions: [forced(100, 'Libre')] });
  await cancel(stay.id);
  assert.ok(offered(stay.id)[PLAN_OPTIONS] > 40);
  givesAll(stay.id);
});

test('N5 — catalogue option and resource removed: one line per bucket', async () => {
  const lines = { options: [{ optionId: 71, quantity: 1 }], selectedOptions: [{ optionId: 71, quantity: 1 }], resources: [{ resourceId: 72, quantity: 1 }] };
  const stay = fiche(NO_ACOMPTE, 'direct', lines);
  await plan(stay);
  await put(stay, { options: [], selectedOptions: [], resources: [] });
  await cancel(stay.id);
  assert.equal(offered(stay.id)[PLAN_OPTIONS], 80);
  assert.equal(offered(stay.id)[PLAN_RESOURCES], 54);
  assert.equal(lineOf(stay.id, PLAN_RESOURCES).label, 'Activités encaissées');
  givesAll(stay.id);
});

test('N5 — lines unchanged: no such line', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  await plan(stay);
  await cancel(stay.id);
  assert.equal(offered(stay.id)[PLAN_OPTIONS], undefined);
  givesAll(stay.id);
});

test('N6 — solde, complement, one adult more, end of stay paid: the excess is a line, every account 0', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  storedEndOfStayPaid(stay.id);
  await cancel(stay.id);
  const line = lineOf(stay.id, 'arrivalComplementExcess');
  assert.equal(line.refundableTtc, 42.4);
  assert.equal(line.bucket, 'options');
  givesAll(stay.id);
});

test('N6 — a 30 € mid-stay line paid on the end of stay: offered on its own key, once', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { customOptions: [forced(20), free(30, 'Ajout', null)] });
  storedEndOfStayPaid(stay.id);
  await cancel(stay.id);
  assert.equal(offered(stay.id)['custom:ajout'], 30);
  givesAll(stay.id);
});

test('N6 — the same line with no stamped split on the complement: never counted twice', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { customOptions: [forced(20), free(30, 'Ajout', null)] });
  storedEndOfStayPaid(stay.id);
  db.prepare('UPDATE reservations SET complementPaidSplit = NULL WHERE id = ?').run(stay.id);
  await cancel(stay.id);
  assert.equal(offered(stay.id)['custom:ajout'], 30);
});

test('N6 — an end of stay in the caisse interne stays off the register (review of #929, F4)', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  storedEndOfStayPaid(stay.id, { cash: true });
  await cancel(stay.id);
  assert.equal(lineOf(stay.id, 'arrivalComplementExcess'), undefined);
});

test('D15 — a refund a line could give, then a cancellation and the give-back: every account 0', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  pay(stay.id, S);
  await put(stay, { customOptions: [free(100), free(16, 'Ajout')] });
  const { refund } = require('./journalFixture');
  assert.equal(refund(stay.id, [{ key: 'custom:ajout', amountTtc: 16 }]).statusCode, 409);
  assert.equal(refund(stay.id, [{ key: 'custom:libre', amountTtc: 16 }]).statusCode, 201);
  await cancel(stay.id);
  givesAll(stay.id);
});

// Audit R23 L3 — rule 49's « rounding cents excepted ».
test('N5 — a split leaving 1 or 2 cents above the line offers no plan line', async () => {
  for (const lowered of [99.99, 99.98]) {
    const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
    await plan(stay);
    await put(stay, { customOptions: [free(lowered)] });
    await cancel(stay.id);
    assert.equal(lineOf(stay.id, PLAN_OPTIONS), undefined, `line at ${lowered}`);
  }
});
