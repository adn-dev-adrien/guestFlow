// specs/plugins-phase-1-sdk.md rule 47 (first used by specs/guest-app.md rules 24, 30, 34, 35) — the core commit of a
// plugin's order as mid-stay extras (`utils/midStayOrderCommit.js`): the order's lines added to the stored fiche and
// written by the operator's own save on a locked fiche, priced by the same engine, in one transaction with the plugin's
// order row, in the caller's own words; a card order's money settled as a mid-stay note marked with its source and ref.
//
// The boot schema (DB_PATH=:memory:) and stays around today: the mid-stay window is read on today's date.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();
const { skipWithout } = require('../plugins/sdk/testing');

const db = require('../database');
const { priceOrder, commitOrder, mergeOrderLines } = require('../utils/midStayOrderCommit');

/** How a plugin names its order: a basket source, its own ref, the history entry in its own words. */
const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });

const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (101, 'Ménage', 40, 'per_stay'), (102, 'Cidre', 6, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 101), (1, 102)').run();
db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, propertyId) VALUES (202, 'Bain', 1, 30, 'per_hour', 1)").run();
db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (202, 1)').run();
db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 202, 30, 60)').run();

function seedStay({ endOfStayPaid = 0, start = -1 } = {}) {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, endOfStayComplementPaid, cautionAmount, balanceDueDate, balancePaid)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 400, 0, 440, 0, 440, 1, 0, 'reservation', 1, '16:00', '10:00', 0, 0, 0, ?, 0, ?, 1)`)
    .run(isoPlus(start), isoPlus(start + 4), endOfStayPaid, isoPlus(start)).lastInsertRowid);
  for (let i = start; i < start + 4; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement)
              VALUES (?, 101, 1, 40, 1, 'per_stay', 40, 0, 0)`).run(id);
  return id;
}

const money = (id) => db.prepare('SELECT depositAmount, balanceAmount, complementAmount, endOfStayComplementAmount, endOfStayComplementDetail, midStaySettledNotes FROM reservations WHERE id = ?').get(id);
const midStay = (id) => JSON.parse(money(id).endOfStayComplementDetail || '[]').filter((l) => l.source === 'midStayExtra');

test('specs/pricing-components.md rules 13, 85: mergeOrderLines appends a line of its own for every unit and resource line, never adding to the stay’s line of the item', () => {
  const body = { adults: 2, teens: 0, children: 1, options: [{ optionId: 9, quantity: 2 }, { optionId: 7, quantity: 1, cardPersons: null }], resources: [{ resourceId: 3, quantity: 1, sessions: [{ date: '2099-07-07', start: '18:00', end: '19:00' }] }] };
  const rows = new Map([[7, { priceType: 'per_person' }], [9, { priceType: 'per_stay' }]]);
  let next = 100;
  const next_ = mergeOrderLines(body, [
    { kind: 'option', id: 9, quantity: 3 },
    { kind: 'option', id: 7, quantity: 2 },
    { kind: 'option', id: 8, quantity: 1 },
    { kind: 'resource', id: 3, sessions: [{ date: '2099-07-08', start: '20:00', end: '21:30' }] },
  ], rows, () => { next += 1; return next; });
  assert.deepEqual(next_.options, [
    { optionId: 9, quantity: 2 },
    { optionId: 7, quantity: 1, cardPersons: null },
    { optionId: 9, quantity: 3, offered: false, newLine: true, lineId: 101 },
    { optionId: 7, quantity: 1, cardPersons: 2, offered: false, newLine: true, lineId: 102 },
    { optionId: 8, quantity: 1, offered: false, newLine: true, lineId: 103 },
  ]);
  assert.deepEqual(next_.resources, [
    { resourceId: 3, quantity: 1, sessions: [{ date: '2099-07-07', start: '18:00', end: '19:00' }] },
    { resourceId: 3, quantity: 1.5, offered: false, inComplement: 0, sessions: [{ date: '2099-07-08', start: '20:00', end: '21:30' }], newLine: true, lineId: 104 },
  ]);
  assert.deepEqual(body.options[0], { optionId: 9, quantity: 2 }, 'the stored body is not touched');
});

test('specs/guest-app.md rule 27bis: a breakfast order sets the hour of the mornings it names, and adds the others', () => {
  const body = { options: [{ optionId: 5, quantity: 2, cardOccurrences: [{ date: '2099-07-07', time: '08:30' }, { date: '2099-07-08', time: '08:30', done: true }], cardPersons: 2 }], resources: [] };
  const next = mergeOrderLines(body, [{ kind: 'breakfast', id: 5, mornings: ['2099-07-07', '2099-07-08', '2099-07-09'], time: '09:30', persons: 3 }]);
  assert.deepEqual(next.options[0], {
    optionId: 5, quantity: 3, cardPersons: 2,
    cardOccurrences: [{ date: '2099-07-07', time: '09:30' }, { date: '2099-07-08', time: '09:30', done: true }, { date: '2099-07-09', time: '09:30' }],
  });
});

test('specs/guest-app.md rule 27bis: a breakfast line with no morning placed keeps its quantity — the order only places its mornings', () => {
  const body = { options: [{ optionId: 5, quantity: 3, cardPersons: 2 }], resources: [] };
  const next = mergeOrderLines(body, [{ kind: 'breakfast', id: 5, mornings: ['2099-07-08'], time: '09:00', persons: 2 }]);
  assert.deepEqual(next.options[0], { optionId: 5, quantity: 3, cardPersons: 2, cardOccurrences: [{ date: '2099-07-08', time: '09:00' }] });
  const more = mergeOrderLines(body, [{ kind: 'breakfast', id: 5, mornings: ['2099-07-07', '2099-07-08', '2099-07-09', '2099-07-10'], time: '09:00', persons: 2 }]);
  assert.equal(more.options[0].quantity, 4, 'more mornings than the line held raise it');
});

test('rule 24: priceOrder is the engine’s own answer for the fiche with the order, and writes nothing', () => {
  const id = seedStay();
  const before = money(id);
  const priced = priceOrder(id, [{ kind: 'option', id: 102, quantity: 3 }]);
  assert.equal(priced.status, 200, JSON.stringify(priced.body));
  assert.deepEqual(priced.byKey, { 'opt:102': 18 });
  assert.equal(priced.total, 18);
  assert.deepEqual(money(id), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ? AND optionId = 102').get(id).n, 0);
});

test('rule 25: free minutes come from the engine — the first hour of the bath is offered, the second is not', { skip: skipWithout(['hourly-resources']) }, () => {
  const id = seedStay();
  const session = (start, end) => ({ date: isoPlus(1), start, end });
  assert.equal(priceOrder(id, [{ kind: 'resource', id: 202, sessions: [session('18:00', '19:00')] }]).total, 0);
  assert.deepEqual(priceOrder(id, [{ kind: 'resource', id: 202, sessions: [session('18:00', '20:00')] }]).byKey, { 'res:202': 30 });
});

test('rule 47: priceOrder prices after the pending lines — a later order never takes the free hour a pending order was quoted with', { skip: skipWithout(['hourly-resources']) }, () => {
  const id = seedStay();
  const session = (start, end) => ({ date: isoPlus(1), start, end });
  const pending = [{ kind: 'resource', id: 202, sessions: [session('10:00', '12:00')] }];
  assert.equal(priceOrder(id, pending).total, 30, 'the pending order alone: 2 h, the first offered');
  const later = priceOrder(id, [{ kind: 'resource', id: 202, sessions: [session('18:00', '19:00')] }], { pending });
  assert.equal(later.status, 200, JSON.stringify(later.body));
  assert.deepEqual(later.byKey, { 'res:202': 30 }, 'the free hour is the pending order’s');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources WHERE reservationId = ?').get(id).n, 0, 'nothing written');
});

test('rules 30, 34: a note order lands as mid-stay extras — the end-of-stay complement only, the arrival money untouched, one history entry', () => {
  const id = seedStay();
  const before = money(id);
  let inside = null;
  const result = commitOrder(id, { ...named(12), lines: [{ kind: 'option', id: 102, quantity: 2 }], within: (r) => { inside = r; } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(inside.byKey, { 'opt:102': 12 }, 'within() runs in the transaction, with the priced result');
  assert.deepEqual(midStay(id).map((l) => [l.key, l.amount]), [['opt:102', 12]]);
  const after = money(id);
  assert.deepEqual([after.depositAmount, after.balanceAmount, after.complementAmount], [before.depositAmount, before.balanceAmount, before.complementAmount]);
  const history = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ?").all(id).flatMap((r) => JSON.parse(r.changedFields));
  assert.ok(history.some((c) => c.field === 'shopOrder' && c.label === 'Commande boutique' && c.to === 'Commande boutique #12'));
});

test('rule 30: the order’s sessions join the stay’s resource line and raise its sold hours', { skip: skipWithout(['hourly-resources']) }, () => {
  const id = seedStay();
  const sessions = [{ date: isoPlus(1), start: '18:00', end: '20:00' }];
  assert.equal(commitOrder(id, { ...named(1), lines: [{ kind: 'resource', id: 202, sessions }] }).status, 200);
  const line = db.prepare('SELECT quantity, sessions FROM reservation_resources WHERE reservationId = ? AND resourceId = 202').get(id);
  assert.equal(line.quantity, 2);
  assert.deepEqual(JSON.parse(line.sessions).map(({ date, start, end }) => ({ date, start, end })), sessions);
});

test('rule 35: a paid order is collected at once — a settled note with the order and the provider’s reference, the remainder owes nothing', () => {
  const id = seedStay();
  const result = commitOrder(id, {
    ...named(7), lines: [{ kind: 'option', id: 102, quantity: 2 }], paid: { amountCents: 1200, paidDate: isoPlus(0), reference: 'pay_1' },
  });
  assert.equal(result.status, 200);
  assert.equal(result.settledCents, 1200);
  assert.equal(result.excessCents, 0);
  assert.deepEqual(midStay(id), []);
  const [note] = JSON.parse(money(id).midStaySettledNotes);
  assert.deepEqual([note.total, note.paidCash, note.source, note.ref, note.reference, note.paidDate], [12, 0, 'shopOrder', '7', 'pay_1', isoPlus(0)]);
});

test('rule 34: a closed window refuses the order with the fiche’s own code — nothing written, within() never runs', () => {
  const id = seedStay({ endOfStayPaid: 1 });
  let ran = false;
  const result = commitOrder(id, { ...named(3), lines: [{ kind: 'option', id: 102, quantity: 1 }], within: () => { ran = true; } });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'MID_STAY_EXTRAS_CLOSED');
  assert.equal(ran, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ? AND optionId = 102').get(id).n, 0);
});

test('rule 34: a write the plugin’s own step refuses rolls the fiche back with it', () => {
  const id = seedStay();
  assert.throws(() => commitOrder(id, { ...named(4), lines: [{ kind: 'option', id: 102, quantity: 1 }], within: () => { throw new Error('order row gone'); } }), /order row gone/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ? AND optionId = 102').get(id).n, 0);
});

test('rule 46: an order the caller does not name is refused before anything is written', () => {
  const id = seedStay();
  const lines = [{ kind: 'option', id: 102, quantity: 1 }];
  assert.throws(() => commitOrder(id, { lines }), /source/);
  assert.throws(() => commitOrder(id, { source: 'shopOrder', lines }), /ref/);
  assert.throws(() => commitOrder(id, { source: 'shopOrder', ref: 1, history: { field: 'x' }, lines }), /history/);
});
