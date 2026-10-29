// specs/reservation-save-keeps-pricing.md — a save that moved no pricing input keeps the stay as it was
// priced. Client audit 2026-10-28 (finding 1): pressing « Enregistrer » on an untouched fiche rewrote
// finalPrice / balanceAmount of closed stays (#22212: 297,61 -> 300,27; #22282: 905 -> 901,82 and a
// tourist tax 0 -> 19,20), re-inserted the custom options under new ids, re-stamped the snapshots and
// logged an operator edit. The engine of today disagreed with the engine that priced the stay.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

let seeded = false;
function fixture() {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  if (!seeded) seed(db);
  seeded = true;
  return stay(db, controller);
}

function seed(db) {
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
              VALUES (1, 'Gîte', 8, 'per_day_per_person', 1, 0)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
}

let nextWeek = 0;
function stay(db, controller) {
  nextWeek += 1;
  const day = (offset) => new Date(Date.UTC(2099, 1, 1 + offset)).toISOString().slice(0, 10);
  const start = day(nextWeek * 4);
  const end = day(nextWeek * 4 + 3);
  const body = (overrides = {}) => ({
    propertyId: 1, clientId: 1, startDate: start, endDate: end,
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    depositDisabled: 1, options: [], customOptions: [{ customKey: 'a', description: 'Panier', amount: 20, offered: false }],
    ...overrides,
  });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.create({ body: body(), user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return { db, controller, id: res.body.id, body };
}

const row = (db, id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
const historyCount = (db, id) => db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(id).n;

test('rule 1 — an untouched save leaves a stay priced by an older engine exactly as it was', () => {
  const { db, controller, id, body } = fixture();
  // The stay as an earlier engine priced it: the figures differ from what today's engine says.
  db.prepare("UPDATE reservations SET finalPrice = finalPrice - 5, balanceAmount = balanceAmount - 5, touristTaxTotal = 0 WHERE id = ?").run(id);
  const before = row(db, id);
  const customBefore = db.prepare('SELECT id, createdAt FROM reservation_custom_options WHERE reservationId = ?').all(id);
  const nightsBefore = JSON.stringify(db.prepare('SELECT * FROM reservation_nights WHERE reservationId = ?').all(id));
  const historyBefore = historyCount(db, id);

  const saved = controller.performUpdate(id, body({ customOptions: [{ customKey: String(customBefore[0].id), customOptionId: customBefore[0].id, description: 'Panier', amount: 20, offered: false }] }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const after = row(db, id);
  for (const column of ['totalPrice', 'finalPrice', 'balanceAmount', 'depositAmount', 'complementAmount', 'touristTaxTotal', 'tariffSnapshot', 'balanceDueDate']) {
    assert.equal(after[column], before[column], column);
  }
  assert.deepEqual(db.prepare('SELECT id, createdAt FROM reservation_custom_options WHERE reservationId = ?').all(id), customBefore, 'custom option ids are stable');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM reservation_nights WHERE reservationId = ?').all(id)), nightsBefore);
  assert.equal(historyCount(db, id), historyBefore, 'no fake operator edit in the history');
});

test('rule 1 — a non-pricing edit (notes) is saved and logged, the money still stands', () => {
  const { db, controller, id, body } = fixture();
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - 5, balanceAmount = balanceAmount - 5 WHERE id = ?').run(id);
  const before = row(db, id);
  const historyBefore = historyCount(db, id);
  const custom = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id);
  const saved = controller.performUpdate(id, body({ notes: 'Arrivée tardive', customOptions: [{ customKey: String(custom.id), customOptionId: custom.id, description: 'Panier', amount: 20, offered: false }] }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const after = row(db, id);
  assert.equal(after.notes, 'Arrivée tardive');
  assert.equal(historyCount(db, id), historyBefore + 1, 'the note is logged');
  assert.equal(after.finalPrice, before.finalPrice);
  assert.equal(after.balanceAmount, before.balanceAmount);
});

test('rule 2 — a pricing input that moved re-prices the stay', () => {
  const { db, controller, id, body } = fixture();
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - 5, balanceAmount = balanceAmount - 5 WHERE id = ?').run(id);
  const stale = row(db, id).finalPrice;
  const custom = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id);
  const saved = controller.performUpdate(id, body({ adults: 3, customOptions: [{ customKey: String(custom.id), customOptionId: custom.id, description: 'Panier', amount: 20, offered: false }] }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const after = row(db, id);
  assert.equal(after.adults, 3);
  assert.notEqual(after.finalPrice, stale);
  assert.equal(after.finalPrice, 320, '3 nights at 100 + the 20 € option');
});

test('rule 2 — « Recalculer » (refreshTouristTax) re-prices an untouched stay: the way a stale tax gets updated', () => {
  const { db, controller, id, body } = fixture();
  db.prepare('UPDATE reservations SET touristTaxTotal = 0 WHERE id = ?').run(id);
  const custom = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id);
  const sent = { customOptions: [{ customKey: String(custom.id), customOptionId: custom.id, description: 'Panier', amount: 20, offered: false }] };
  assert.equal(controller.performUpdate(id, body(sent)).status, 200);
  assert.equal(row(db, id).touristTaxTotal, 0, 'an untouched save leaves the stored tax alone');
  assert.equal(controller.performUpdate(id, body({ ...sent, refreshTouristTax: true })).status, 200);
  assert.equal(row(db, id).touristTaxTotal, 6, '2 adults x 3 nights x 1 €');
});

test('rule 1 — an unpriced save still applies the bed invariant on the lines it stored (the bed-config-in-linen-card invariant)', () => {
  const { db, controller, id, body } = fixture();
  db.prepare('UPDATE reservations SET singleBeds = 2, doubleBeds = 1 WHERE id = ?').run(id);
  const custom = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id);
  const sent = { singleBeds: 2, doubleBeds: 1, customOptions: [{ customKey: String(custom.id), customOptionId: custom.id, description: 'Panier', amount: 20, offered: false }] };
  assert.equal(controller.performUpdate(id, body(sent)).status, 200);
  const after = row(db, id);
  assert.deepEqual([after.singleBeds, after.doubleBeds], [0, 0], 'no bed-linen line: no beds');

  const linen = db.prepare("INSERT INTO options (title, priceType, price, countsAsBedLinen) VALUES ('Linge test', 'per_stay', 0, 1)").run().lastInsertRowid;
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice) VALUES (?, ?, 1, 0, 1, ?, 0)').run(id, linen, 'per_stay');
  assert.equal(controller.performUpdate(id, body({ ...sent, options: [{ optionId: linen, quantity: 1 }] })).status, 200);
  assert.deepEqual([row(db, id).singleBeds, row(db, id).doubleBeds], [2, 1], 'a stored linen line keeps the beds');
});

test('rule 1 — a refused save writes nothing: the arrival baseline is not captured before the gate', () => {
  const { db, controller, id, body } = fixture();
  db.prepare("UPDATE reservations SET startDate = '2000-01-01', endDate = '2000-01-04', arrivalExtrasBaseline = NULL, endOfStayComplementPaid = 1, complementPaid = 1 WHERE id = ?").run(id);
  const custom = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id);
  const refused = controller.performUpdate(id, body({
    startDate: '2000-01-01', endDate: '2000-01-04', adults: 5,
    customOptions: [{ customKey: String(custom.id), customOptionId: custom.id, description: 'Panier', amount: 20, offered: false }],
  }));
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'PAST_RESERVATION_LOCKED');
  assert.equal(row(db, id).arrivalExtrasBaseline, null);
});

// Review of #847, point 1: the operator's own text and amounts on a custom line are pricing inputs.
function customSave(stay, patch) {
  const { db, controller, id, body } = stay;
  const custom = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id);
  const line = { customKey: String(custom.id), customOptionId: custom.id, description: 'Panier', amount: 20, offered: false, ...patch };
  const saved = controller.performUpdate(id, body({ customOptions: [line] }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return db.prepare('SELECT description, amount, offered FROM reservation_custom_options WHERE reservationId = ?').get(id);
}

test('rule 2 — renaming a custom line saves the text alone: money, tax, ids and snapshots stand, one history row (Adrien, 2026-10-29)', () => {
  const stay = fixture();
  const { db, id } = stay;
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - 5, balanceAmount = balanceAmount - 5, touristTaxTotal = 0 WHERE id = ?').run(id);
  const before = row(db, id);
  const ids = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').all(id);
  const history = historyCount(db, id);
  assert.equal(customSave(stay, { description: 'Panier garni' }).description, 'Panier garni');
  const after = row(db, id);
  for (const column of ['finalPrice', 'balanceAmount', 'touristTaxTotal', 'tariffSnapshot']) assert.equal(after[column], before[column], column);
  assert.deepEqual(db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').all(id), ids);
  assert.equal(historyCount(db, id), history + 1);
});

test('rule 2 — renaming an offered custom line saves the text alone', () => {
  const stay = fixture();
  customSave(stay, { offered: true });
  assert.equal(customSave(stay, { offered: true, description: 'Panier offert' }).description, 'Panier offert');
});

test('rule 2 — retyping the amount of an offered custom line is saved', () => {
  const stay = fixture();
  customSave(stay, { offered: true });
  assert.equal(customSave(stay, { offered: true, amount: 35 }).amount, 35);
});

test('rule 1 — a refused or untouched save on a started fiche does not pin the arrival baseline either', () => {
  const { db, controller, id, body } = fixture();
  db.prepare("UPDATE reservations SET startDate = '2000-02-01', endDate = '2000-02-04', arrivalExtrasBaseline = NULL WHERE id = ?").run(id);
  const custom = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id);
  const sent = { startDate: '2000-02-01', endDate: '2000-02-04', customOptions: [{ customKey: String(custom.id), customOptionId: custom.id, description: 'Panier', amount: 20, offered: false }] };
  const refused = controller.performUpdate(id, body({ ...sent, adults: 5 }));
  assert.equal(refused.status, 400);
  assert.equal(row(db, id).arrivalExtrasBaseline, null, 'a refused save writes nothing');
  assert.equal(controller.performUpdate(id, body(sent), { dryRun: true }).status, 200);
  assert.equal(row(db, id).arrivalExtrasBaseline, null, 'a dry run writes nothing');
});

test('rule 1 — an adjusted complement is not an edit: a past stay carrying one is saved untouched (#22275)', () => {
  const { db, controller, id, body } = fixture();
  db.prepare("UPDATE reservations SET startDate = '2000-03-01', endDate = '2000-03-04', complementAmountOverride = 50, complementPaid = 1, complementAmount = 50 WHERE id = ?").run(id);
  const custom = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id);
  const sent = { startDate: '2000-03-01', endDate: '2000-03-04', complementAmountOverride: 50, customOptions: [{ customKey: String(custom.id), customOptionId: custom.id, description: 'Panier', amount: 20, offered: false }] };
  const saved = controller.performUpdate(id, body(sent));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(row(db, id).complementAmountOverride, 50);
});

test('rule 2 — in the extras window of a started fiche a rename is refused with its own message, not « ni retirée ni réduite »', () => {
  const { db, controller, id, body } = fixture();
  db.prepare("UPDATE reservations SET startDate = '2000-04-01', endDate = '2000-04-04', arrivalExtrasBaseline = NULL WHERE id = ?").run(id);
  require('../models/reservationsModel').captureArrivalExtrasBaseline(id);
  const idOf = (description) => db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ? AND description = ?').get(id, description).id;
  const line = (lineId, description, amount) => ({ customKey: String(lineId), customOptionId: lineId, description, amount, offered: false });
  const send = (lines) => controller.performUpdate(id, body({ startDate: '2000-04-01', endDate: '2000-04-04', customOptions: lines }));
  const added = send([line(idOf('Panier'), 'Panier', 20), { customKey: 'new', description: 'Bouquet', amount: 15, offered: false }]);
  assert.equal(added.status, 200, JSON.stringify(added.body));

  for (const [target, renamed] of [['Panier', 'Panier garni'], ['Bouquet', 'Bouquet de saison']]) {
    const lines = [line(idOf('Panier'), 'Panier', 20), line(idOf('Bouquet'), 'Bouquet', 15)].map((l) => (l.description === target ? { ...l, description: renamed } : l));
    const refused = send(lines);
    assert.equal(refused.status, 400, target);
    assert.equal(refused.body.code, 'ARRIVAL_LINE_RENAME');
    assert.match(refused.body.error, /ne peut plus être renommée/);
  }
});
