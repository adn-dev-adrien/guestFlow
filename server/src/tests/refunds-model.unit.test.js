// Remboursements — persistence + orchestration (specs/reservation-refunds.md §3.1, §3.3, §4.3).
// The model against the real schema (header + lines in one transaction, cascades, the two total
// readings), then the controller against stub deps (caps enforced, register refreshed).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const refundsModel = require('../models/refundsModel');
const refundsController = require('../controllers/refundsController');
const { createController: createRefundsController } = refundsController;

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte du Pré')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Durand')").run();
  db.prepare(`
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, finalPrice, touristTaxTotal)
    VALUES (1, 1, 1, '2026-08-10', '2026-08-17', 480, 13.2)
  `).run();
  return { db, model: refundsModel.createModel(db) };
}

const BREAKFASTS = {
  refundDate: '2026-08-14',
  method: 'transfer',
  reason: 'Départ anticipé — petits-déjeuners non pris',
  totalTtc: 24,
  lines: [{ lineKey: 'opt:7', label: 'Petit-déjeuner', bucket: 'options', quantity: 2, unitPrice: 12, amountTtc: 24, vatRate: 10 }],
};

test('create persists the header and its lines, and listByReservation reads them back', () => {
  const { model } = freshDb();
  const id = model.create(1, BREAKFASTS);

  const [refund] = model.listByReservation(1);
  assert.equal(refund.id, id);
  assert.equal(refund.refundDate, '2026-08-14');
  assert.equal(refund.method, 'transfer');
  assert.equal(refund.totalTtc, 24);
  assert.equal(refund.reason, 'Départ anticipé — petits-déjeuners non pris');
  assert.equal(refund.lines.length, 1);
  assert.deepEqual(
    { ...refund.lines[0], id: undefined, refundId: undefined },
    { id: undefined, refundId: undefined, lineKey: 'opt:7', label: 'Petit-déjeuner', bucket: 'options', quantity: 2, unitPrice: 12, amountTtc: 24, vatRate: 10 },
  );
});

test('the sale is never touched by a refund', () => {
  const { db, model } = freshDb();
  const before = db.prepare('SELECT * FROM reservations WHERE id = 1').get();
  model.create(1, BREAKFASTS);
  assert.deepEqual(db.prepare('SELECT * FROM reservations WHERE id = 1').get(), before);
});

test('totalsByReservation splits book money from the caisse interne', () => {
  const { model } = freshDb();
  model.create(1, BREAKFASTS);
  model.create(1, { ...BREAKFASTS, method: 'internal', totalTtc: 10, lines: [{ ...BREAKFASTS.lines[0], amountTtc: 10, quantity: null, unitPrice: null }] });
  model.create(1, { ...BREAKFASTS, method: 'cash', totalTtc: 5, lines: [{ lineKey: null, label: 'Geste', bucket: 'options', quantity: null, unitPrice: null, amountTtc: 5, vatRate: 10 }] });

  assert.deepEqual(model.totalsByReservation(1), { book: 29, withCash: 39 });
  assert.deepEqual(model.totalsByReservationIds([1, 2]), { 1: { book: 29, withCash: 39 } });
  assert.deepEqual(model.totalsByReservationIds([]), {});
});

test('remove deletes the header + its lines, and refuses a refund of another reservation', () => {
  const { db, model } = freshDb();
  db.prepare(`
    INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, finalPrice)
    VALUES (2, 1, 1, '2026-09-01', '2026-09-05', 300)
  `).run();
  const id = model.create(1, BREAKFASTS);

  assert.equal(model.remove(2, id), false, 'a refund cannot be deleted through another reservation');
  assert.equal(model.remove(1, id), true);
  assert.equal(model.listByReservation(1).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_refund_lines').get().n, 0);
  assert.equal(model.remove(1, id), false, 'deleting twice is a no-op, not a crash');
});

test('deleting the reservation cascades the whole register away', () => {
  const { db, model } = freshDb();
  model.create(1, BREAKFASTS);
  db.prepare('DELETE FROM reservations WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_refunds').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_refund_lines').get().n, 0);
});

test('listByMonth returns the book-money refunds of the month, caisse interne excluded', () => {
  const { model } = freshDb();
  model.create(1, BREAKFASTS);                                        // 14/08 — transfer
  model.create(1, { ...BREAKFASTS, refundDate: '2026-08-31', method: 'cash', totalTtc: 5, lines: [{ ...BREAKFASTS.lines[0], amountTtc: 5 }] });
  model.create(1, { ...BREAKFASTS, refundDate: '2026-08-20', method: 'internal', totalTtc: 9, lines: [{ ...BREAKFASTS.lines[0], amountTtc: 9 }] });
  model.create(1, { ...BREAKFASTS, refundDate: '2026-09-01', totalTtc: 7, lines: [{ ...BREAKFASTS.lines[0], amountTtc: 7 }] });

  const august = model.listByMonth({ from: '2026-08-01', nextMonth: '2026-09-01' });
  assert.deepEqual(august.map((r) => [r.refundDate, r.totalTtc]), [['2026-08-14', 24], ['2026-08-31', 5]]);
  assert.equal(august[0].lastName, 'Durand');
  assert.equal(august[0].propertyName, 'Gîte du Pré');
});

// ── Controller ───────────────────────────────────────────────────────────────

function stubbedController(overrides = {}) {
  const { db, model } = freshDb();
  const reservation = {
    id: 1, finalPrice: 480, touristTaxTotal: 13.2,
    options: [{ optionId: 7, title: 'Petit-déjeuner', totalPrice: 72, billedUnits: 6, offered: 0 }],
    resources: [],
    ...(overrides.reservation || {}),
  };
  const controller = createRefundsController({
    refundsModel: model,
    reservationsModel: { getByIdWithDetails: (id) => (Number(id) === 1 ? reservation : null) },
    settingsModel: { read: () => ({ vatRate: 10 }) },
  });
  return { db, model, controller };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const todayIso = () => new Date().toISOString().slice(0, 10);

test('POST creates the refund and hands back the refreshed register', () => {
  const { controller } = stubbedController();
  const res = fakeRes();
  controller.create(
    { params: { id: '1' }, body: { refundDate: todayIso(), method: 'transfer', lines: [{ key: 'opt:7', quantity: 2, amountTtc: 24 }] } },
    res,
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.refund.totalTtc, 24);
  assert.equal(res.body.refunds.length, 1);
  assert.deepEqual(res.body.refundTotals, { book: 24, withCash: 24 });
  const breakfasts = res.body.refundableLines.find((l) => l.key === 'opt:7');
  assert.equal(breakfasts.refundedTtc, 24);
  assert.equal(breakfasts.refundableTtc, 48);
});

test('POST over the per-line cap is a 409 and persists nothing', () => {
  const { controller, model } = stubbedController();
  const res = fakeRes();
  controller.create(
    { params: { id: '1' }, body: { refundDate: todayIso(), lines: [{ key: 'opt:7', amountTtc: 90 }] } },
    res,
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'REFUND_EXCEEDS_LINE');
  assert.equal(model.listByReservation(1).length, 0);
});

test('GET on an unknown reservation is a 404; DELETE on an unknown refund too', () => {
  const { controller } = stubbedController();
  const missing = fakeRes();
  controller.list({ params: { id: '99' } }, missing);
  assert.equal(missing.statusCode, 404);

  const gone = fakeRes();
  controller.remove({ params: { id: '1', refundId: '42' } }, gone);
  assert.equal(gone.statusCode, 404);
});

test('DELETE removes the refund and the amount returns to the refundable lines', () => {
  const { controller } = stubbedController();
  const created = fakeRes();
  controller.create(
    { params: { id: '1' }, body: { refundDate: todayIso(), lines: [{ key: 'opt:7', amountTtc: 24 }] } },
    created,
  );

  const res = fakeRes();
  controller.remove({ params: { id: '1', refundId: String(created.body.refund.id) } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.refunds, []);
  assert.deepEqual(res.body.refundTotals, { book: 0, withCash: 0 });
  assert.equal(res.body.refundableLines.find((l) => l.key === 'opt:7').refundableTtc, 72);
});

test('the module exports real (req, res) handlers — the factory must not shadow one', () => {
  // Regression 2026-08-10: the factory was exported as `create`, overwriting the POST handler of the
  // same name. The route then called the factory, which returns a controller object instead of
  // answering — the request hung forever, and no unit test noticed because they all used the factory.
  for (const name of ['list', 'create', 'remove']) {
    assert.equal(typeof refundsController[name], 'function', `${name} must be exported`);
    assert.equal(refundsController[name].length, 2, `${name} must take (req, res)`);
  }
});
