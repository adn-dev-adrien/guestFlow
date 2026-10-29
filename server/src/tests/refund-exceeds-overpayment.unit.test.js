// specs/reservation-refunds.md rule 42 — a refund of the trop-perçu cannot exceed what is still over-collected,
// so a double click or a stale tab cannot give the same money back twice.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const refundsModel = require('../models/refundsModel');
const { createController } = require('../controllers/refundsController');
const { todayIso } = require('../utils/localDate');

function setup(overpayment) {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Durand')").run();
  db.prepare("INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, finalPrice, touristTaxTotal) VALUES (1, 1, 1, '2026-08-10', '2026-08-17', 480, 13.2)").run();
  const model = refundsModel.createModel(db);
  const state = { over: overpayment };
  const controller = createController({
    refundsModel: model,
    reservationsModel: { getByIdWithDetails: () => ({ id: 1, finalPrice: 480, touristTaxTotal: 13.2, options: [], resources: [] }) },
    vatRateOf: () => 10,
    storedOverpaymentTtc: () => state.over,
  });
  return { controller, model, state };
}

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const request = (amount, flagged = true) => ({
  params: { id: '1' },
  body: { refundDate: todayIso(), method: 'transfer', fromOverpayment: flagged || undefined, lines: [{ label: 'Trop-perçu', bucket: 'options', amountTtc: amount }] },
});

test('rule 42 — the trop-perçu is refunded once: the second identical request is refused', () => {
  const { controller, model, state } = setup(28);
  const first = res();
  controller.create(request(28), first);
  assert.equal(first.statusCode, 201);
  state.over = 0; // the stored trop-perçu now nets the refund
  const second = res();
  controller.create(request(28), second);
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.code, 'REFUND_EXCEEDS_OVERPAYMENT');
  assert.equal(second.body.error, 'Le trop-perçu est déjà remboursé.');
  assert.equal(model.listByReservation(1).length, 1);
});

test('rule 42 — a refund above the remaining trop-perçu is refused, one within it is recorded', () => {
  const { controller } = setup(28);
  const above = res();
  controller.create(request(30), above);
  assert.equal(above.statusCode, 409);
  const within = res();
  controller.create(request(10), within);
  assert.equal(within.statusCode, 201);
});

test('rule 42 — a free-line refund not flagged as a trop-perçu (commercial gesture) is not capped by it', () => {
  const { controller } = setup(0);
  const answer = res();
  controller.create(request(15, false), answer);
  assert.equal(answer.statusCode, 201);
});
