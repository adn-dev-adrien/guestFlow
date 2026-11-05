// specs/reservations-backend-mvc.md rule 17 (audit R22-C6) — the save refuses a range with no cot left, on the real
// model: moving a fiche's dates or its logement is judged even when the party did not move, and a range that did not
// move still saves when its cots are already oversold (specs/edit-reservation-blocked-by-overlap.md).
const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay } = require('./datesTakenFixture');
const controller = require('../controllers/reservationsController');
const { addDays } = require('../utils/dateDays');

const FULL_FROM = inDays(60);
const FULL_TO = addDays(FULL_FROM, 4);
const FREE_FROM = inDays(90);
const FREE_TO = addDays(FREE_FROM, 4);

// Three cots shared by every logement, or `scopedTo` one logement alone.
function cots({ scopedTo = null } = {}) {
  db.prepare('DELETE FROM reservations').run();
  db.prepare('DELETE FROM resources').run();
  const cot = Number(db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Lit bébé', 3, 0, 'free')").run().lastInsertRowid);
  if (scopedTo) db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (?, ?)').run(cot, scopedTo);
}

const stayHolding = (babyBeds, propertyId, start, end) => addStay({ propertyId, start, end, extra: { babies: babyBeds, babyBeds } });

async function save(id, changes) {
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.update({
    params: { id: String(id) },
    query: {},
    user: { roles: ['admin'] },
    body: {
      propertyId: row.propertyId, clientId: 1, startDate: row.startDate, endDate: row.endDate,
      checkInTime: row.checkInTime, checkOutTime: row.checkOutTime, platform: 'direct',
      adults: row.adults, children: 0, teens: 0, babies: row.babies, babyBeds: row.babyBeds,
      customPrice: 300, depositAmount: 90, balanceAmount: 210,
      forceMinNights: true, forceMaxNights: true, forceChangeover: true, forceCapacity: true,
      ...changes,
    },
  }, res);
  return res;
}

const stored = (id) => db.prepare('SELECT startDate, endDate, propertyId, babyBeds FROM reservations WHERE id = ?').get(id);

// Another stay holds all three cots on the full range; the fiche, elsewhere, holds one.
function fullRange() {
  cots();
  stayHolding(3, freshProperty(), FULL_FROM, FULL_TO);
  return stayHolding(1, freshProperty(), inDays(30), inDays(33));
}

test('rule 17 — dates moved onto a range with no cot left, the party unchanged: 400 and nothing moves', async () => {
  const id = fullRange();
  const before = stored(id);
  const res = await save(id, { startDate: FULL_FROM, endDate: FULL_TO });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /Lits bébé indisponibles: 0 restant/);
  assert.deepEqual(stored(id), before);
});

test('rule 17 — the same move with the party changed gives the same answer', async () => {
  const id = fullRange();
  const res = await save(id, { startDate: FULL_FROM, endDate: FULL_TO, adults: 3 });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /Lits bébé indisponibles: 0 restant/);
});

test('rule 17 — one date alone moved into the full range is judged: the departure, then the arrival', async () => {
  cots();
  stayHolding(3, freshProperty(), FULL_FROM, FULL_TO);
  const before = stayHolding(1, freshProperty(), addDays(FULL_FROM, -3), FULL_FROM);
  const after = stayHolding(1, freshProperty(), FULL_TO, addDays(FULL_TO, 3));
  const later = await save(before, { endDate: addDays(FULL_FROM, 1) });
  assert.equal(later.statusCode, 400, JSON.stringify(later.body));
  assert.match(later.body.error, /Lits bébé indisponibles/);
  const earlier = await save(after, { startDate: addDays(FULL_TO, -1) });
  assert.equal(earlier.statusCode, 400, JSON.stringify(earlier.body));
  assert.match(earlier.body.error, /Lits bébé indisponibles/);
});

test('rule 17 — dates moved onto a range with a cot left save', async () => {
  const id = fullRange();
  const { propertyId } = stored(id);
  const res = await save(id, { startDate: FREE_FROM, endDate: FREE_TO });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(stored(id), { startDate: FREE_FROM, endDate: FREE_TO, propertyId, babyBeds: 1 });
});

test('rule 17 — a fiche holding no cot moves onto a range with none left', async () => {
  cots();
  stayHolding(3, freshProperty(), FULL_FROM, FULL_TO);
  const id = stayHolding(0, freshProperty(), inDays(30), inDays(33));
  const res = await save(id, { startDate: FULL_FROM, endDate: FULL_TO });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});

test('rule 17 — moving to a logement with no cot on the same dates is judged too', async () => {
  const withCots = freshProperty();
  const without = freshProperty();
  cots({ scopedTo: withCots });
  const id = stayHolding(1, withCots, FULL_FROM, FULL_TO);
  const res = await save(id, { propertyId: without });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /Lits bébé indisponibles: 0 restant/);
});

test('rule 17 — already oversold with the range unchanged, the fiche still saves', async () => {
  cots();
  stayHolding(3, freshProperty(), FULL_FROM, FULL_TO);
  const id = stayHolding(1, freshProperty(), FULL_FROM, FULL_TO);
  const res = await save(id, { notes: 'Arrivée tardive' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(stored(id).babyBeds, 1);
});

test('rule 17 — on a range that did not move, one more cot is still judged', async () => {
  cots();
  stayHolding(3, freshProperty(), FULL_FROM, FULL_TO);
  const id = stayHolding(1, freshProperty(), FULL_FROM, FULL_TO);
  const res = await save(id, { babies: 2, babyBeds: 2 });
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /Lits bébé indisponibles/);
});
