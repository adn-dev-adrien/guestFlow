// specs/reservation-refunds.md rule 51 (D15, Adrien, 2026-11-05; audit R23 N9) — a live stay refuses a refund on a line above what
// that line collected. The total stays judged first (rule 50), free lines on the total only, the caisse interne not at all,
// stored refunds and the cancelled register unchanged. The figure ships as `availableTtc`: the dialog does no math.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, ADMIN, TODAY, NO_ACOMPTE, WITH_ACOMPTE, S, C, D, forced, free, fiche, put, pay, storedEndOfStayPaid, cancel, refund, register, rowOf,
} = require('./moneyLedgerFixture');
const installmentsController = require('../controllers/installmentsController');

const ACCOMMODATION = 'accommodation';
const TAX = 'touristTax';
const CODE = 'REFUND_EXCEEDS_LINE_COLLECTED';
const NOTHING = 'Rien d’encaissé sur cette ligne.';
const line = (id, key) => register(id).refundableLines.find((l) => l.key === key);

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

test('a line added after the solde collected nothing: 409 with its own code and message', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  await put(stay, { customOptions: [free(16, 'Ajout')] });
  assert.equal(line(stay.id, 'custom:ajout').availableTtc, 0);
  const res = refund(stay.id, [{ key: 'custom:ajout', amountTtc: 16 }]);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, CODE);
  assert.equal(res.body.error, NOTHING);
  assert.equal(register(stay.id).refunds.length, 0);
});

test('a tax raised after the solde: the amount available, 4,80 €', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  await put(stay, { adults: 3 });
  assert.equal(line(stay.id, TAX).billedTtc, 7.2);
  assert.equal(line(stay.id, TAX).availableTtc, 4.8);
  const res = refund(stay.id, [{ key: TAX, amountTtc: 7.2 }]);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, CODE);
  assert.match(res.body.error, /^Disponible sur cette ligne : 4,80.€\.$/);
  assert.equal(refund(stay.id, [{ key: TAX, amountTtc: 4.8 }]).statusCode, 201);
});

test('net of what the line already gave back', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  pay(stay.id, S);
  assert.equal(line(stay.id, 'custom:libre').availableTtc, 100);
  assert.equal(refund(stay.id, [{ key: 'custom:libre', amountTtc: 60 }]).statusCode, 201);
  assert.equal(line(stay.id, 'custom:libre').availableTtc, 40);
  assert.equal(refund(stay.id, [{ key: 'custom:libre', amountTtc: 40.01 }]).body.code, 'REFUND_EXCEEDS_LINE');
  assert.equal(refund(stay.id, [{ key: 'custom:libre', amountTtc: 40 }]).statusCode, 201);
});

test('the acompte holds no tax yet: the tax line collected nothing, the accommodation holds the money', () => {
  const stay = fiche(WITH_ACOMPTE, 'direct');
  pay(stay.id, D);
  assert.equal(refund(stay.id, [{ key: TAX, amountTtc: 4.8 }]).body.error, NOTHING);
  assert.equal(refund(stay.id, [{ key: ACCOMMODATION, amountTtc: rowOf(stay.id).depositAmount }]).statusCode, 201);
});

test('a forced line collected by the complement alone is available whole', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { depositDisabled: 1, customOptions: [forced(50), free(100)] });
  pay(stay.id, C);
  assert.equal(line(stay.id, 'custom:forcée').availableTtc, 50);
  assert.equal(line(stay.id, 'custom:libre').availableTtc, 0);
  assert.equal(refund(stay.id, [{ key: 'custom:forcée', amountTtc: 50 }]).statusCode, 201);
});

test('free lines are judged on the total only', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  await put(stay, { customOptions: [free(16, 'Ajout')] });
  assert.equal(refund(stay.id, [{ label: 'Geste', bucket: 'options', amountTtc: 16 }]).statusCode, 201);
  assert.equal(refund(stay.id, [{ label: 'Geste', bucket: 'options', amountTtc: 10000 }]).body.code, 'REFUND_EXCEEDS_COLLECTED');
});

test('the total is still judged first: nothing collected reads as rule 50', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(30)] });
  assert.equal(refund(stay.id, [{ key: 'custom:libre', amountTtc: 10 }]).body.code, 'REFUND_EXCEEDS_COLLECTED');
});

test('the caisse interne is not judged by this rule', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  await put(stay, { customOptions: [free(16, 'Ajout')] });
  assert.equal(refund(stay.id, [{ key: 'custom:ajout', amountTtc: 16 }], 'internal').statusCode, 201);
});

test('a caisse-interne refund takes nothing from what the line holds on the books', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  pay(stay.id, S);
  assert.equal(refund(stay.id, [{ key: 'custom:libre', amountTtc: 30 }], 'internal').statusCode, 201);
  assert.equal(line(stay.id, 'custom:libre').availableTtc, 70, 'min of what the line can still give back');

  const acompte = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(100)] });
  pay(acompte.id, D);
  assert.equal(refund(acompte.id, [{ key: 'custom:libre', amountTtc: 10 }], 'internal').statusCode, 201);
  assert.equal(line(acompte.id, 'custom:libre').availableTtc, 30, 'its 30 € on the books are all there');
});

test('a trop-perçu refund still works: free lines, on what was collected', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  pay(stay.id, S);
  await put(stay, { customOptions: [] });
  assert.equal(refund(stay.id, [{ label: 'Trop-perçu', bucket: 'options', amountTtc: 100 }]).statusCode, 201);
});

test('a stored refund above the line is not rewritten: it stays, the line offers nothing more', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(20)] });
  pay(stay.id, S);
  await put(stay, { customOptions: [free(20), free(16, 'Ajout')] });
  const stored = require('../models/refundsModel').create(stay.id, {
    refundDate: TODAY, method: 'transfer', reason: '', totalTtc: 10,
    lines: [{ lineKey: 'custom:ajout', label: 'Ajout', bucket: 'options', quantity: null, unitPrice: null, amountTtc: 10, vatRate: 10 }],
  });
  assert.ok(stored);
  assert.equal(register(stay.id).refunds.length, 1);
  assert.equal(line(stay.id, 'custom:ajout').availableTtc, 0);
  assert.equal(refund(stay.id, [{ key: 'custom:libre', amountTtc: 20 }]).statusCode, 201);
});

test('a cancelled stay carries no such figure: its register keeps its own rules', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(20)] });
  pay(stay.id, S);
  await cancel(stay.id);
  for (const l of register(stay.id).refundableLines) assert.equal(l.availableTtc, undefined);
  assert.equal(refund(stay.id, [{ key: 'custom:libre', amountTtc: 20 }]).statusCode, 201);
});

test('an end-of-stay line once paid is available; before, it collected nothing', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { customOptions: [forced(20), free(30, 'Ajout', null)] });
  assert.equal(line(stay.id, 'custom:ajout').availableTtc, 0);
  storedEndOfStayPaid(stay.id);
  assert.equal(line(stay.id, 'custom:ajout').availableTtc, 30);
  assert.equal(refund(stay.id, [{ key: 'custom:ajout', amountTtc: 30 }]).statusCode, 201);
});

test('a mid-stay note collected on a line makes it available; one in the caisse interne does not', async () => {
  const noted = (cash) => JSON.stringify([{ id: 1, total: 30, paidDate: TODAY, paidCash: cash, lines: [{ key: 'custom:ajout', amount: 30 }] }]);
  const stay = fiche(NO_ACOMPTE, 'direct');
  pay(stay.id, S);
  await put(stay, { customOptions: [free(30, 'Ajout')] });
  db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(noted(0), stay.id);
  assert.equal(line(stay.id, 'custom:ajout').availableTtc, 30);
  db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(noted(1), stay.id);
  assert.equal(line(stay.id, 'custom:ajout').availableTtc, 0);
});

test('a plan: a line’s share is known by its bucket; a line in a bucket that holds nothing is refused', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  await plan(stay, 1);
  const available = line(stay.id, 'custom:libre').availableTtc;
  assert.ok(available > 40 && available < 60, `half paid: ${available}`);
  assert.equal(refund(stay.id, [{ key: 'custom:libre', amountTtc: 100 }]).body.code, CODE);
  assert.equal(refund(stay.id, [{ key: 'custom:libre', amountTtc: available }]).statusCode, 201);

  db.prepare("INSERT INTO resources (id, name, quantity, priceType, price) VALUES (77, 'Bain', 1, 'per_stay', 80)").run();
  db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (77, ?)').run(NO_ACOMPTE);
  const other = fiche(NO_ACOMPTE, 'direct');
  await plan(other);
  await put(other, { customOptions: [], resources: [{ resourceId: 77, quantity: 1 }] });
  assert.equal(line(other.id, 'res:77').availableTtc, 0);
  assert.equal(refund(other.id, [{ key: 'res:77', amountTtc: 10 }]).body.error, NOTHING);
});

test('a plan: two lines of one bucket share its money', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100, 'Une'), free(100, 'Deux')] });
  await plan(stay, 1);
  const available = line(stay.id, 'custom:une').availableTtc;
  assert.equal(line(stay.id, 'custom:deux').availableTtc, available);
  const res = refund(stay.id, [{ key: 'custom:une', amountTtc: available }, { key: 'custom:deux', amountTtc: 1 }]);
  assert.equal(res.body.code, CODE);
  assert.equal(refund(stay.id, [{ key: 'custom:une', amountTtc: available - 1 }, { key: 'custom:deux', amountTtc: 1 }]).statusCode, 201);
  assert.equal(line(stay.id, 'custom:deux').availableTtc, 0);
});

test('legacy money no contrib describes keeps the total as its judge', () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100)] });
  pay(stay.id, S);
  db.prepare('UPDATE reservations SET accommodationSoldeContribTtc = NULL, touristTaxSoldeContribTtc = NULL WHERE id = ?').run(stay.id);
  db.prepare('UPDATE reservation_custom_options SET soldeContribTtc = NULL WHERE reservationId = ?').run(stay.id);
  assert.equal(refund(stay.id, [{ key: 'custom:libre', amountTtc: 100 }]).statusCode, 201);
});

// Audit R23 L4.
test('a plan: what the end of stay collected on a line adds to its bucket’s share', async () => {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(100, 'Ligne'), forced(20)] });
  await plan(stay);
  pay(stay.id, C);
  await put(stay, { customOptions: [free(130, 'Ligne'), forced(20)] });
  storedEndOfStayPaid(stay.id);
  assert.equal(line(stay.id, 'custom:ligne').availableTtc, 130);
});
