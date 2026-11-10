// specs/reservation-payment-ledger.md rule 72 (audit R39-M-L2, 2026-11-10) — every tick the two SAS read is the PATCH's
// tick (rule 66): true, false, 1 or 0, or absent. `Boolean("false")` used to settle a solde and return a caution the
// request said were not; anything else is now 400 INVALID_PAYMENT_FLAG with its field, preview and commit, reception
// included, before anything is planned or written. A field reception never sends (the stay settlement) is still dropped.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const registry = require('../../sdk/registry');
const controller = require('../controller');

registry.configure({ isActive: () => true, allows: () => true });
registry.ensure('linen');

db.prepare("INSERT INTO properties (id, name, maxGuests, defaultCautionAmount) VALUES (1, 'Gîte fictif', 6, 300)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const PILLOW = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Taie', 3.3, 'bed')").run().lastInsertRowid);

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayAt = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

let nextId = 900;
function stay(columns) {
  const id = nextId++;
  const cols = {
    id, kind: 'reservation', clientId: 1, propertyId: 1, platform: 'direct', adults: 2, finalPrice: 600,
    balanceAmount: 600, balancePaid: 0, complementAmount: 0, cautionAmount: 300, ...columns,
  };
  const keys = Object.keys(cols);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => cols[k]));
  return id;
}
const arrivalStay = () => stay({ startDate: dayAt(0), endDate: dayAt(3) });
const departureStay = () => stay({
  startDate: dayAt(-3), endDate: dayAt(0), balancePaid: 1, balancePaidDate: dayAt(-10),
  cautionReceived: 1, cautionReceivedDate: dayAt(-3), checkInDone: 1,
});

const ADMIN = { id: 1, roles: ['admin'] };
const RECEPTION = { id: 2, roles: ['reception'] };
function call(fn, id, body, user = ADMIN) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  controller[fn]({ params: { id: String(id) }, body, user, query: {} }, res);
  return res;
}
const row = (id) => db.prepare(`SELECT balancePaid, balancePaidDate, complementPaid, cautionReceived, cautionReturned,
  cautionAmount, arrivalSasDoneAt, departureSasDoneAt, extinguisherSealOkAtArrival, extinguisherSealOkAtDeparture
  FROM reservations WHERE id = ?`).get(id);

const NOT_A_TICK = ['false', 'true', '0', '1', '', null, 2, -1, {}, [], [true]];

const ARRIVAL_FLAGS = [
  'cautionReceived', 'stayPaid', 'stayPaidCash', 'complementSettled', 'complementPaidCash', 'arrivalPaymentSplit',
  'cleaningAdded', 'bathLinenAdded', 'cleaningOffered', 'bathLinenOffered', 'extinguisherSealOkAtArrival',
];
const DEPARTURE_FLAGS = [
  'cautionReturned', 'complementsSettled', 'complementsPaidCash', 'cleaningCharged', 'cleaningOffered',
  'extinguisherSealOkAtDeparture',
];

function assertRefused(fn, id, body, field, user = ADMIN) {
  const before = row(id);
  const res = call(fn, id, body, user);
  assert.equal(res.statusCode, 400, `${fn} ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`);
  assert.deepEqual(res.body, { error: 'Valeur invalide.', code: 'INVALID_PAYMENT_FLAG', field }, `${fn} ${JSON.stringify(body)}`);
  assert.deepEqual(row(id), before, `${fn} ${JSON.stringify(body)} wrote something`);
}

test('rule 72 (R39-M-L2 repro): « stayPaid: "false" » no longer books the solde', () => {
  const id = arrivalStay();
  assertRefused('commitArrival', id, { stayPaid: 'false', arrivalPaymentSplit: true }, 'stayPaid');
  assert.equal(row(id).balancePaid, 0);
});

test('rule 72 (R39-M-L2 repro): « cautionReturned: "false" » no longer returns the caution', () => {
  const id = departureStay();
  assertRefused('commitDeparture', id, { cautionReturned: 'false' }, 'cautionReturned');
  assert.equal(row(id).cautionReturned, 0);
});

test('rule 72: every arrival tick that is not true / false / 1 / 0 is refused, preview and commit, nothing written', () => {
  const id = arrivalStay();
  for (const field of ARRIVAL_FLAGS) {
    for (const value of NOT_A_TICK) {
      assertRefused('previewArrival', id, { [field]: value }, field);
      assertRefused('commitArrival', id, { [field]: value }, field);
    }
  }
});

test('rule 72: every departure tick that is not true / false / 1 / 0 is refused, preview and commit, nothing written', () => {
  const id = departureStay();
  for (const field of DEPARTURE_FLAGS) {
    for (const value of NOT_A_TICK) {
      assertRefused('previewDeparture', id, { [field]: value }, field);
      assertRefused('commitDeparture', id, { [field]: value }, field);
    }
  }
});

test('rule 72: the « Offrir » tick of a line is held to the same reading', () => {
  const arrival = arrivalStay();
  const departure = departureStay();
  for (const value of ['false', null, {}]) {
    assertRefused('commitArrival', arrival, { linenItems: [{ itemId: PILLOW, qty: 1, offered: value }] }, 'linenItems.offered');
    assertRefused('commitArrival', arrival, { keptLines: [{ customOptionId: 1, offered: value }] }, 'keptLines.offered');
    assertRefused('previewDeparture', departure, { missingItems: [{ itemId: PILLOW, qty: 1, offered: value }] }, 'missingItems.offered');
    assertRefused('commitDeparture', departure, { storedLines: [{ key: 'dep:1', offered: value }] }, 'storedLines.offered');
    assertRefused('commitDeparture', departure, { extinguisherCharges: [{ repairKey: 'seal', qty: 1, offered: value }] }, 'extinguisherCharges.offered');
  }
});

test('rule 72: a reception session is held to the same refusal; the stay settlement it never sends is still dropped', () => {
  const id = arrivalStay();
  assertRefused('commitArrival', id, { cautionReceived: 'false' }, 'cautionReceived', RECEPTION);
  assertRefused('commitArrival', id, { complementSettled: 'true' }, 'complementSettled', RECEPTION);
  const res = call('commitArrival', id, { stayPaid: 'false', arrivalPaymentSplit: 'yes' }, RECEPTION);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(row(id).balancePaid, 0);
});

test('rule 72: 1 and 0 read as true and false, as on the PATCH; an absent tick still leaves its mark untouched', () => {
  const id = arrivalStay();
  const received = call('commitArrival', id, { cautionReceived: 1, stayPaid: 0, arrivalPaymentSplit: 1, extinguisherSealOkAtArrival: 0 });
  assert.equal(received.statusCode, 200, JSON.stringify(received.body));
  assert.equal(row(id).cautionReceived, 1);
  assert.equal(row(id).balancePaid, 0);
  const paid = call('commitArrival', id, { stayPaid: 1, arrivalPaymentSplit: 1 });
  assert.equal(paid.statusCode, 200, JSON.stringify(paid.body));
  assert.equal(row(id).balancePaid, 1);
  assert.equal(row(id).cautionReceived, 1, 'absent: untouched');

  const out = departureStay();
  const returned = call('commitDeparture', out, { cautionReturned: 1, complementsSettled: 0 });
  assert.equal(returned.statusCode, 200, JSON.stringify(returned.body));
  assert.equal(row(out).cautionReturned, 1);
  const kept = call('commitDeparture', out, { cautionReturned: 0 });
  assert.equal(kept.statusCode, 200, JSON.stringify(kept.body));
  assert.equal(row(out).cautionReturned, 0);
});
