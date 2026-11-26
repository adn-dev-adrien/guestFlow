// specs/pricing/pricing-components.md §3 rule 94 readings (stabilisation loop t15, S15-3 / D15-2 and S15-4 / D15-1, 2026-11-17) — the numbering of repeated
// free labels reaches the devis: a devis with two « Ménage » stores « Ménage » and « Ménage (2) », so the stay it converts into keeps two lines of
// their own and a 2 € line discount takes 2 € (it took 4 €: both rows shared one fact key). And a blank label is never numbered: two blank lines
// posted by an API caller were stored as one priced « (2) » line (+10 €) on the preview, the creation and the save; the engine drops them again.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, row, addDaysToIsoDate, todayIso } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const devisController = require('../controllers/devisController');
const { storedBody } = require('../utils/stayOrderLines');
const { numberRepeatedCustomLines } = require('../utils/pricing/storedLines');

const linesOf = (id) => db.prepare('SELECT description, amount, lineId, discountCents FROM reservation_custom_options WHERE reservationId = ? ORDER BY id').all(id);
const cents = (value) => Math.round(Number(value || 0) * 100);
const call = (handler, body, params = {}) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    set() { return this; },
    setHeader() {},
  };
  Promise.resolve(handler({ body, params, query: {}, user: { role: 'admin', id: 1 }, headers: {} }, res)).catch(reject);
});
const stayDates = (offset) => {
  const start = addDaysToIsoDate(todayIso(), offset);
  return { propertyId: 9701, clientId: 9701, startDate: start, endDate: addDaysToIsoDate(start, 3), adults: 2, platform: 'direct' };
};
const MENAGE_TWICE = [{ description: 'Ménage', amount: 20 }, { description: 'Ménage', amount: 20 }];

test('S15-3 — a devis numbers a repeated free label; the converted stay takes a 2 € line discount as 2 €', async () => {
  const created = await call(devisController.create, { ...stayDates(50), customOptions: MENAGE_TWICE });
  assert.ok(created.status < 300, JSON.stringify(created.body));
  const devisId = Number(created.body.id);
  assert.deepEqual(linesOf(devisId).map((line) => line.description), ['Ménage', 'Ménage (2)']);

  const converted = await call(devisController.convertToReservation, {}, { id: devisId });
  assert.ok(converted.status < 300, JSON.stringify(converted.body));
  const id = Number(converted.body.reservationId || converted.body.id);
  assert.deepEqual(linesOf(id).map((line) => line.description), ['Ménage', 'Ménage (2)']);
  const before = cents(row(id).finalPrice);
  const second = linesOf(id)[1];
  assert.equal(extraSale.changeLine(id, `custom:${second.lineId}`, { discount: { amount: 2 } }, { now: new Date() }).status, 200);
  assert.equal(cents(row(id).finalPrice), before - 200);
  assert.deepEqual(linesOf(id).map((line) => line.discountCents || 0), [0, 200]);
  assert.equal(ctrl.performUpdate(id, storedBody(id), {}).status, 200);
  assert.equal(cents(row(id).finalPrice), before - 200);
});

test('S15-3 — the preview of a saved devis prices a repeated label under the key its write stores', async () => {
  const created = await call(devisController.create, { ...stayDates(60), customOptions: [{ description: 'Bois', amount: 10 }] });
  const devisId = Number(created.body.id);
  const preview = await call(ctrl.calculatePrice, {
    ...stayDates(60), devisId, customOptions: [{ customKey: 'custom_1', description: 'Bois', amount: 10 }, { customKey: 'custom_2', description: 'Bois', amount: 5 }],
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.optionLines.filter((line) => line.isCustom).map((line) => [line.title, line.key]), [['Bois', 'custom:bois'], ['Bois', 'custom:bois (2)']]);
});

test('S15-4 — blank labels are left as they are by the shared numbering', () => {
  const lines = [{ description: '', amount: 50 }, { description: '  ', amount: 30 }, { description: 'Bois', amount: 5 }, { description: 'Bois', amount: 5 }];
  assert.deepEqual(numberRepeatedCustomLines(lines).map((line) => line.description), ['', '  ', 'Bois', 'Bois (2)']);
});

test('S15-4 — two blank free lines price nothing on the preview, the creation and the save', async () => {
  const BLANKS = [{ description: '', amount: 50 }, { description: '  ', amount: 30 }];
  const bare = await call(ctrl.calculatePrice, { ...stayDates(70) });
  const preview = await call(ctrl.calculatePrice, { ...stayDates(70), customOptions: BLANKS.map((line, index) => ({ ...line, customKey: `custom_${index + 1}` })) });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(cents(preview.body.finalPrice), cents(bare.body.finalPrice));
  assert.equal(preview.body.optionLines.filter((line) => line.isCustom).length, 0);

  const created = await call(ctrl.create, { ...stayDates(80), customOptions: BLANKS });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));
  const id = Number(created.body.id);
  assert.deepEqual(linesOf(id), []);
  const price = cents(row(id).finalPrice);
  const body = storedBody(id);
  body.customOptions = BLANKS;
  assert.equal(ctrl.performUpdate(id, body, {}).status, 200);
  assert.deepEqual(linesOf(id), []);
  assert.equal(cents(row(id).finalPrice), price);
});
