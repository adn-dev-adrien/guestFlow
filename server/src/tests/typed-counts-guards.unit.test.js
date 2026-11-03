// specs/non-card-option-served-persons.md rules 19, 21, 22 and 24 (audit R21-S5) — where the guard answers beyond the
// fiche's update: the devis, the creation, the live quote and the locked past stay; and the replay of a stored stay,
// which must keep a frozen night count.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const devisModel = require('../models/devisModel');
const controller = require('../controllers/reservationsController');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const reservationsModel = require('../models/reservationsModel');
const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
const { calculateReservationQuote } = require('../utils/pricing');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const TOWEL = 109;
const FIREWOOD = 121;

db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, depositEnabled)
            VALUES (1, 'Granja', 13, 'none', 0)`).run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight, minNights) VALUES (1, 'Standard', 100, 1)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Test', 'Noel')").run();
db.prepare(`INSERT INTO options (id, title, price, priceType) VALUES
  (109, 'Linge de toilette', 8, 'per_person'), (121, 'Bois', 5, 'per_night')`).run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 109), (1, 121)').run();

// One property: each stay takes its own stretch of the coming year, so none overlaps another.
let nextStart = 60;
function nextStay(nights = 2) {
  const startDate = addDaysToIsoDate(todayIso(), nextStart);
  nextStart += nights + 3;
  return { startDate, endDate: addDaysToIsoDate(startDate, nights) };
}

const fakeRes = () => ({
  statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; },
});
const STAY = { propertyId: 1, clientId: 1, platform: 'direct', checkInTime: '16:00', checkOutTime: '10:00', singleBeds: 0, doubleBeds: 0, babyBeds: 0, teens: 0, children: 0, babies: 0 };
const typedLine = { optionId: TOWEL, quantity: 1, cardPersons: 3, typedAtParty: 4 };
const option = (id, optionId) => db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, optionId);

test('rule 22 — a devis created with a count left behind by the party asks, and forcing keeps the count', () => {
  const model = devisModel.buildModel(db);
  const body = { ...STAY, ...nextStay(), adults: 5, selectedOptions: [typedLine] };

  const refused = model.create(body);
  assert.equal(refused.status, 409, JSON.stringify(refused));
  assert.equal(refused.code, 'TYPED_COUNTS_STALE');
  assert.equal(refused.lines[0].title, 'Linge de toilette');

  const forced = model.create({ ...body, forceTypedCounts: true });
  assert.ok(forced.ok, JSON.stringify(forced));
  assert.equal(option(forced.data.id, TOWEL).billedUnits, 3);
});

test('rule 22 — a devis saved after its party moved asks, and forcing keeps the count', () => {
  const model = devisModel.buildModel(db);
  const body = { ...STAY, ...nextStay(), adults: 4, selectedOptions: [{ optionId: TOWEL, quantity: 1, cardPersons: 3 }] };
  const { data: { id } } = model.create(body);

  const refused = model.update(id, { ...body, adults: 5 });
  assert.equal(refused.status, 409, JSON.stringify(refused));
  assert.equal(refused.code, 'TYPED_COUNTS_STALE');
  assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = ?').get(id).adults, 4, 'nothing written');

  const forced = model.update(id, { ...body, adults: 5, forceTypedCounts: true });
  assert.ok(forced.ok, JSON.stringify(forced));
  assert.equal(db.prepare('SELECT adults FROM reservations WHERE id = ?').get(id).adults, 5);
  assert.equal(option(id, TOWEL).billedUnits, 3);
});

test('rule 22 — a stay created with a count left behind by the party asks, and forcing keeps the count', () => {
  const body = { ...STAY, ...nextStay(), adults: 5, options: [typedLine] };
  const refused = fakeRes();
  controller.create({ body: { ...body }, user: { role: 'admin' } }, refused);
  assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'TYPED_COUNTS_STALE');

  const forced = fakeRes();
  controller.create({ body: { ...body, forceTypedCounts: true }, user: { role: 'admin' } }, forced);
  assert.equal(forced.statusCode, 200, JSON.stringify(forced.body));
  assert.equal(option(forced.body.id, TOWEL).billedUnits, 3);
});

test('rule 21 — the live quote names the lines to flag', async () => {
  const res = fakeRes();
  await controller.calculatePrice({
    body: { ...STAY, ...nextStay(), adults: 5, selectedOptions: [typedLine] }, user: { role: 'admin' },
  }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.typedCountAlerts.map((a) => [a.optionId, a.kind, a.typed, a.reference, a.current]), [[TOWEL, 'persons', 3, 4, 5]]);
});

test('rule 24 — a locked past stay is not asked; the same line on a stay to come is', () => {
  const save = (dates) => {
    const created = fakeRes();
    controller.create({ body: { ...STAY, ...dates, adults: 5, options: [{ optionId: TOWEL, quantity: 1, cardPersons: 3 }], forceTypedCounts: true }, user: { role: 'admin', roles: ['admin'] } }, created);
    assert.equal(created.statusCode, 200, JSON.stringify(created.body));
    return created.body.id;
  };
  const coming = save(nextStay());
  const started = save(nextStay());
  const startDate = addDaysToIsoDate(todayIso(), -1);
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(startDate, addDaysToIsoDate(startDate, 2), started);
  const bodyWithTag = (id) => {
    const body = toUpdateBody(reservationsModel.getByIdWithDetails(id));
    delete body.forceTypedCounts;
    for (const line of body.options) if (line.optionId === TOWEL) line.typedAtParty = 4;
    return body;
  };

  const asked = controller.performUpdate(String(coming), bodyWithTag(coming), {});
  assert.equal(asked?.status, 409, JSON.stringify(asked));
  assert.equal(asked.body.code, 'TYPED_COUNTS_STALE');

  const locked = controller.performUpdate(String(started), bodyWithTag(started), {});
  assert.notEqual(locked?.body?.code, 'TYPED_COUNTS_STALE', JSON.stringify(locked));
});

test('rule 19 — replaying a stored stay keeps its frozen night count, and so its amount', () => {
  const created = fakeRes();
  controller.create({ body: { ...STAY, ...nextStay(), adults: 2, options: [{ optionId: FIREWOOD, quantity: 1, cardNights: 3 }], forceTypedCounts: true }, user: { role: 'admin' } }, created);
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(created.body.id);
  assert.equal(option(row.id, FIREWOOD).cardNights, 3);

  const input = buildReservationEngineInput(db, row);
  assert.equal(input.selectedOptions.find((o) => Number(o.optionId) === FIREWOOD).cardNights, 3);
  const line = calculateReservationQuote(input).optionLines.find((l) => Number(l.optionId) === FIREWOOD);
  assert.deepEqual([line.cardNights, line.billedUnits, line.totalPrice], [3, 3, 15]);
});
