// specs/pricing-components.md §3 rule 90.3 (rule 24, owner Q-C7) — the evening of an hourly session is a component of the session line.
// While that line is the open arrival complement's, the SAS sets its evening component (it grows and shrinks, the hours do not move) and
// the fiche's next save keeps it; otherwise what the sessions add beyond the evening the line carries rides a line of its own; a stay
// holding a stored `evening:<id>` line keeps it, and the session line gets no component (billed once).

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 6)").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const BATH = Number(db.prepare("INSERT INTO resources (name, quantity, price, priceType, propertyId) VALUES ('Bain nordique', 1, 30, 'per_hour', 1)").run().lastInsertRowid);
db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price) VALUES (1, ?, 30)').run(BATH);
const KEY = `hourly-resources:evening:${BATH}`;

let nextId = 700;
function stay({ inComplement = 1, legacy = 0, ...columns } = {}) {
  const id = nextId++;
  const cols = {
    id, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2027-07-10', endDate: '2027-07-12', platform: 'direct', adults: 2, complementAmount: 0, ...columns,
  };
  const keys = Object.keys(cols);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => cols[k]));
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, lineId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement)
    VALUES (?, ?, ?, 2, 30, 2, 'per_hour', 60, ?)`).run(id, BATH, 9000 + id, inComplement);
  if (legacy) {
    db.prepare(`INSERT INTO reservation_custom_options (reservationId, description, amount, inComplement, sasArrivalOrigin, sasLineKey)
      VALUES (?, 'Bain nordique — supplément soirée', ?, 1, 1, ?)`).run(id, legacy, KEY);
  }
  return id;
}
const evening = (amount) => ({ complementItems: [{ label: 'Bain nordique — supplément soirée', amount, sasLineKey: KEY, component: { kind: 'evening', resourceId: BATH } }] });
const sessionLine = (id) => db.prepare('SELECT totalPrice, components FROM reservation_resources WHERE reservationId = ? AND quantity > 0 ORDER BY lineId LIMIT 1').get(id);
const eveningOf = (id) => (JSON.parse(sessionLine(id).components || '[]').find((c) => c.kind === 'evening') || { cents: 0 }).cents;
const customs = (id) => db.prepare('SELECT description, amount, sasLineKey FROM reservation_custom_options WHERE reservationId = ? ORDER BY id').all(id);

test('rule 90.3 — on an open session line the evening is its component: the plan and the commit agree, the line totals its components', () => {
  const id = stay();
  const plan = model.planArrivalSas(id, evening(20));
  assert.equal(plan.arrivalComplementTotal, 80);
  assert.deepEqual(plan.lines.filter((l) => l.group === 'plugin').map((l) => [l.label, l.real]), [['Bain nordique — supplément soirée', 20]]);
  assert.deepEqual(plan.lines.filter((l) => l.group === 'existing').map((l) => l.real), [60], 'the session line shows its sold hours, the evening apart');
  assert.equal(model.commitArrivalSas(id, evening(20)), 80);
  assert.equal(sessionLine(id).totalPrice, 80);
  const components = JSON.parse(sessionLine(id).components);
  assert.deepEqual(components.map((c) => c.kind), ['base', 'evening', 'free']);
  assert.equal(components.reduce((s, c) => s + c.cents, 0), 8000, 'the total is the sum of the components');
  assert.deepEqual(customs(id), [], 'no evening line beside the session line');
});

test('rule 90.3 — a re-run sets the component, never adds to it; sessions back in the day band shrink it to 0', () => {
  const id = stay();
  model.commitArrivalSas(id, evening(20));
  assert.equal(model.planArrivalSas(id, evening(20)).arrivalComplementTotal, 80);
  assert.equal(model.commitArrivalSas(id, evening(40)), 100);
  assert.equal(eveningOf(id), 4000);
  assert.equal(model.commitArrivalSas(id, evening(0)), 60);
  assert.equal(sessionLine(id).totalPrice, 60);
  assert.equal(eveningOf(id), 0);
});

test('rule 90.3 — the fiche’s next save keeps the evening the component put on the line (the price lock), the hours do not move', () => {
  const id = stay();
  model.commitArrivalSas(id, evening(20));
  const { storedBody } = require('../utils/midStayOrderCommit');
  const saved = require('../controllers/reservationsController').performUpdate(id, storedBody(id));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const row = db.prepare('SELECT totalPrice, quantity, billedUnits FROM reservation_resources WHERE reservationId = ? ORDER BY lineId LIMIT 1').get(id);
  assert.deepEqual([row.totalPrice, row.quantity, row.billedUnits], [80, 2, 2]);
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount, 80);
});

const eveningLines = (id) => db.prepare(`SELECT quantity, billedUnits, totalPrice, inComplement, components FROM reservation_resources
  WHERE reservationId = ? AND COALESCE(billedUnits, 0) = 0 ORDER BY lineId`).all(id)
  .map((row) => [row.billedUnits, row.totalPrice, row.inComplement, JSON.parse(row.components)]);

test('rule 90.3 — a session line sold into the stay’s plan is not the arrival’s: the evening is a line of the resource holding only it, collected at the arrival', () => {
  const id = stay({ inComplement: 0 });
  const plan = model.planArrivalSas(id, evening(20));
  assert.equal(plan.arrivalComplementTotal, 20);
  assert.deepEqual(plan.lines.filter((l) => l.group === 'plugin').map((l) => [l.label, l.real]), [['Bain nordique — supplément soirée', 20]]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources WHERE reservationId = ?').get(id).n, 1, 'the plan writes nothing');
  assert.equal(model.commitArrivalSas(id, evening(20)), 20);
  assert.equal(sessionLine(id).components, null);
  assert.deepEqual(customs(id), [], 'no SAS custom line');
  assert.deepEqual(eveningLines(id), [[0, 20, 1, [{ kind: 'evening', cents: 2000 }]]]);
});

test('rule 90.3 — the line holding only an evening is kept by the fiche’s next save (the engine keeps a zero-hour line with an evening)', () => {
  const id = stay({ inComplement: 0 });
  model.commitArrivalSas(id, evening(20));
  const { storedBody } = require('../utils/midStayOrderCommit');
  const saved = require('../controllers/reservationsController').performUpdate(id, storedBody(id));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(eveningLines(id), [[0, 20, 1, [{ kind: 'evening', cents: 2000 }]]]);
  assert.equal(db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount, 20);
});

test('rule 90.3 — a re-run sets the evening line, never adds to it, and a 0 € evening removes it', () => {
  const id = stay({ inComplement: 0 });
  model.commitArrivalSas(id, evening(20));
  assert.equal(model.planArrivalSas(id, evening(20)).arrivalComplementTotal, 20);
  assert.equal(model.commitArrivalSas(id, evening(35)), 35);
  assert.deepEqual(eveningLines(id).map((line) => line[1]), [35]);
  assert.equal(model.commitArrivalSas(id, evening(0)), 0);
  assert.deepEqual(eveningLines(id), []);
});

test('rule 90.3 — guard: a stay holding a stored evening line keeps it, its session line gets no component, the evening is billed once', () => {
  const id = stay({ legacy: 20, complementAmount: 80 });
  assert.equal(model.planArrivalSas(id, evening(20)).arrivalComplementTotal, 80);
  assert.equal(model.commitArrivalSas(id, evening(20)), 80);
  assert.equal(sessionLine(id).components, null);
  assert.deepEqual(customs(id).map((c) => [c.amount, c.sasLineKey]), [[20, KEY]]);
  model.commitArrivalSas(id, evening(20));
  assert.deepEqual(customs(id).map((c) => c.amount), [20], 'a replay never bills it twice');
});

test('rule 90.3 — on a collected complement, only the evening beyond what the session line already carries is new money', () => {
  const id = stay();
  model.commitArrivalSas(id, { ...evening(20), complementSettled: true });
  assert.equal(eveningOf(id), 2000);
  const plan = model.planArrivalSas(id, evening(30));
  assert.equal(plan.arrivalComplementTotal, 80, 'a collected complement never moves');
  assert.equal(plan.supplementOutsideComplement, 10);
});
