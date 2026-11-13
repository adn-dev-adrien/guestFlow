// specs/pricing-components.md §3 rule 90.1 — the arrival SAS's complement is the engine's, and its plan is the commit played inside a
// transaction rolled back: one computation by construction. Prod copy 2026-11-11: the stored complement equals the engine's on 62 stays of 62.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 6)").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (1, 'Standard', 100, 5)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const PILLOW = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Taie d''oreiller', 5, 'bed')").run().lastInsertRowid);
const PANIER = Number(db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Panier gourmand', 'per_stay', 20)").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(PANIER);

let nextId = 300;
function stay(columns = {}) {
  const id = nextId++;
  const cols = {
    id, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2027-07-10', endDate: '2027-07-12', platform: 'direct', adults: 2, complementAmount: 0, ...columns,
  };
  const keys = Object.keys(cols);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => cols[k]));
  return id;
}
const amountOf = (id) => db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount;
const draft = (id, linenItems) => ({ complementItems: model.resolveSasArrivalItems(id, { linenItems }) });
const snapshot = (id) => JSON.stringify([
  db.prepare('SELECT * FROM reservations WHERE id = ?').get(id),
  db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? ORDER BY rowid').all(id),
  db.prepare('SELECT * FROM reservation_custom_options WHERE reservationId = ? ORDER BY id').all(id),
]);

test('rule 90.1 — a stored complement the engine does not reproduce is not carried forward: the run stores the engine’s', () => {
  // 30 € stored with no line behind it: the arithmetic stored 35 € (30 + the pillowcase), the engine bills what the lines make.
  const id = stay({ complementAmount: 30 });
  const input = draft(id, [{ itemId: PILLOW, qty: 1 }]);
  const before = snapshot(id);
  const plan = model.planArrivalSas(id, input);
  assert.equal(snapshot(id), before, 'the plan rolls its write back');
  assert.equal(plan.arrivalComplementTotal, 5);
  assert.equal(plan.existingTotal, 0);
  assert.equal(model.commitArrivalSas(id, input), plan.arrivalComplementTotal);
  assert.equal(amountOf(id), 5);
});

test('rule 90.1 — the plan and the commit agree on a stay with a line of its own, on the first run and on a re-run', () => {
  const id = stay({ complementAmount: 20 });
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement)
    VALUES (?, ?, 1, 20, 1, 'per_stay', 20, 1)`).run(id, PANIER);
  const input = draft(id, [{ itemId: PILLOW, qty: 2 }]);
  const plan = model.planArrivalSas(id, input);
  assert.equal(plan.arrivalComplementTotal, 30);
  assert.equal(model.commitArrivalSas(id, input), 30);
  const again = draft(id, [{ itemId: PILLOW, qty: 2 }]);
  assert.equal(model.planArrivalSas(id, again).arrivalComplementTotal, 30, 'a re-run never bills the SAS lines twice');
  assert.equal(model.commitArrivalSas(id, again), 30);
});

test('rule 90.1 — the stay’s shape is not the SAS’s to judge: a stay below its lodging’s minimum still checks in', () => {
  const id = stay();
  const { storedBody } = require('../utils/stayOrderLines');
  const fiche = require('../controllers/reservationsController').performUpdate(id, storedBody(id), { dryRun: true });
  assert.equal(fiche.body.code, 'MIN_NIGHTS', 'the fiche’s save refuses this stay');
  assert.equal(model.commitArrivalSas(id, draft(id, [{ itemId: PILLOW, qty: 1 }])), 5);
});

test('rule 90.1 — an operator’s adjustment is re-applied over the engine figure, and the plan names both', () => {
  const id = stay({ complementAmount: 12, complementAmountOverride: 12 });
  const input = draft(id, [{ itemId: PILLOW, qty: 1 }]);
  const plan = model.planArrivalSas(id, input);
  assert.deepEqual(plan.adjusted, { amount: 12, engineAmount: 5 });
  assert.equal(model.commitArrivalSas(id, input), 12);
});

test('rule 90.1 — a model built on a database the engine does not run on keeps the arithmetic', () => {
  const foreign = model.create(db);
  const id = stay({ complementAmount: 30 });
  assert.equal(foreign.planArrivalSas(id, draft(id, [{ itemId: PILLOW, qty: 1 }])).arrivalComplementTotal, 35);
});
