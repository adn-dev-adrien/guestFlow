// specs/sas-departure-recap-server-side.md rule 28 (2026-10-27 spec review) — a linen element is
// counted in whole pieces. The departure preview rounded a missing quantity of 1.5 to 2 and billed
// it; the arrival rounded the same way. Both drafts now refuse it (400 INVALID_QUANTITY), preview
// and commit alike, and write nothing.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../../../database');
const registry = require('../../sdk/registry');
const controller = require('../controller');

registry.configure({ isActive: () => true, allows: () => true });
registry.ensure('linen');

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 6)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const TOWEL = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Serviette', 6.5, 'bath')").run().lastInsertRowid);
const PILLOW = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Taie d''oreiller', 3.3, 'bed')").run().lastInsertRowid);

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let nextId = 700;
function stay(columns) {
  const id = nextId++;
  const cols = { id, kind: 'reservation', clientId: 1, propertyId: 1, platform: 'direct', adults: 2, complementAmount: 0, ...columns };
  const keys = Object.keys(cols);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => cols[k]));
  return id;
}

function call(fn, id, body) {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  controller[fn]({ params: { id: String(id) }, body, user: { id: 1, roles: ['admin'] }, query: {} }, res);
  return res;
}

test('departure: 1.5 missing towels is refused at the preview and at the commit', () => {
  const id = stay({ startDate: '2099-01-01', endDate: today() });
  for (const fn of ['previewDeparture', 'commitDeparture']) {
    const res = call(fn, id, { missingItems: [{ itemId: TOWEL, qty: 1.5 }] });
    assert.equal(res.statusCode, 400, fn);
    assert.equal(res.body.error, 'INVALID_QUANTITY');
  }
  assert.equal(db.prepare('SELECT departureSasDoneAt FROM reservations WHERE id = ?').get(id).departureSasDoneAt, null);
});

test('departure: a whole quantity is still priced as before', () => {
  const id = stay({ startDate: '2099-01-01', endDate: today() });
  const res = call('previewDeparture', id, { missingItems: [{ itemId: TOWEL, qty: 2 }] });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.endOfStayTotal, 13);
});

test('arrival: 1.5 pillowcases is refused at the preview and at the commit', () => {
  const id = stay({ startDate: today(), endDate: '2099-01-03' });
  for (const fn of ['previewArrival', 'commitArrival']) {
    const res = call(fn, id, { linenItems: [{ itemId: PILLOW, qty: 1.5 }] });
    assert.equal(res.statusCode, 400, fn);
    assert.equal(res.body.error, 'INVALID_QUANTITY');
  }
  assert.equal(db.prepare('SELECT arrivalSasDoneAt FROM reservations WHERE id = ?').get(id).arrivalSasDoneAt, null);
});
