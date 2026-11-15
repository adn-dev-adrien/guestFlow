// specs/pricing-components.md §3 rule 14 — the arrival SAS's « Offrir » is ONE input, `offered`: the refs of the lines it offers and the two
// upsells (`{ kind: 'upsell', key }`), read into the one stored property. The three former fields (`cleaningOffered`, `bathLinenOffered`,
// `offeredExtras`) are no input any more. Real controller, real model, in-memory database.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const registry = require('../../sdk/registry');
const controller = require('../controller');
const reservationsModel = require('../../../models/reservationsModel');

registry.configure({ isActive: () => true, allows: () => true });
registry.ensure('linen');

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 6)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
let nextId = 700;
function stayWithBasket() {
  const id = nextId++;
  db.prepare(`INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate, platform, adults, complementAmount)
    VALUES (?, 'reservation', 1, 1, ?, '2099-01-03', 'direct', 2, 50)`).run(id, today());
  const customId = Number(db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement) VALUES (?, 'Panier', 50, 1)").run(id).lastInsertRowid);
  return { id, customId };
}
const ADMIN = { id: 1, roles: ['admin'] };
function call(fn, id, body) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  controller[fn]({ params: { id: String(id) }, body, user: ADMIN }, res);
  return res;
}
// What the controller hands the model's plan, the commit's own input.
function inputOf(body) {
  const { id } = stayWithBasket();
  const original = reservationsModel.planArrivalSas;
  let seen = null;
  reservationsModel.planArrivalSas = (rid, input) => { seen = input; return original.call(reservationsModel, rid, input); };
  try {
    assert.equal(call('previewArrival', id, body).statusCode, 200);
  } finally {
    reservationsModel.planArrivalSas = original;
  }
  return seen;
}

test('rule 14 — a line ref of `offered` offers that line: the basket bills 0 €', () => {
  const { id, customId } = stayWithBasket();
  assert.equal(call('previewArrival', id, { offered: [] }).body.arrivalComplementTotal, 50);
  assert.equal(call('previewArrival', id, { offered: [{ kind: 'custom', id: customId }] }).body.arrivalComplementTotal, 0);
});

test('rule 14 — the upsell refs and the line refs of the one list reach the model as the stored property\'s three readings', () => {
  const input = inputOf({ offered: [{ kind: 'upsell', key: 'cleaning' }, { kind: 'option', id: 5, lineId: 9 }, { kind: 'upsell', key: 'bathLinen' }] });
  assert.deepEqual([input.cleaningOffered, input.bathLinenOffered, input.offeredExtras], [true, true, [{ kind: 'option', id: 5, lineId: 9 }]]);
  const none = inputOf({});
  assert.deepEqual([none.cleaningOffered, none.bathLinenOffered, none.offeredExtras], [false, false, undefined], 'no list: no flag touched');
});

test('rule 14 — the three former fields are no input: the basket is billed, no upsell offered', () => {
  const { id, customId } = stayWithBasket();
  const recap = call('previewArrival', id, { cleaningOffered: true, bathLinenOffered: true, offeredExtras: [{ kind: 'custom', id: customId }] });
  assert.equal(recap.statusCode, 200);
  assert.equal(recap.body.arrivalComplementTotal, 50);
  const input = inputOf({ cleaningOffered: true, bathLinenOffered: true });
  assert.deepEqual([input.cleaningOffered, input.bathLinenOffered], [false, false]);
});
