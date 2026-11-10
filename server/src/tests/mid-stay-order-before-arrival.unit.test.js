// specs/guest-app.md rules 66-67 (« Mon séjour » from J-7) — the core commit of a plugin's order BEFORE the arrival
// (`utils/midStayOrderCommit.js`, specs/plugins-phase-1-sdk.md rule 47 reading of 2026-11-10): while the arrival is not
// marked, the order's lines are ordinary lines of the fiche; the engine routes their amount to the arrival complement
// once the pre-arrival money is settled, and the commit measures the order there. Anything else it would move is refused.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

require('./hourlyResourcesFixture').liveHourlyResources();
const { skipWithout } = require('../plugins/sdk/testing');

const db = require('../database');
const { priceOrder, commitOrder, orderCollection } = require('../utils/midStayOrderCommit');

const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });

const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (101, 'Ménage', 40, 'per_stay'), (102, 'Cidre', 6, 'per_stay'), (103, 'Offert', 0, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 101), (1, 102), (1, 103)').run();
db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, propertyId) VALUES (202, 'Bain', 1, 30, 'per_hour', 1)").run();
db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (202, 1)').run();
db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 202, 30, 60)').run();

/** A stay not arrived yet: paid at booking by default (acompte and solde), `balancePaid: 0` leaves the solde due. */
function seedStay({ start = 5, balancePaid = 1, checkInDone = 0, complementPaid = 0 } = {}) {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, complementPaid, cautionAmount, balanceDueDate, balancePaid)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 400, 0, 440, 0, 440, 1, 0, 'reservation', ?, '16:00', '10:00', 0, 0, 0, ?, 0, ?, ?)`)
    .run(isoPlus(start), isoPlus(start + 4), checkInDone, complementPaid, isoPlus(start), balancePaid).lastInsertRowid);
  for (let i = start; i < start + 4; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement)
              VALUES (?, 101, 1, 40, 1, 'per_stay', 40, 0, 0)`).run(id);
  return id;
}

const money = (id) => db.prepare('SELECT finalPrice, depositAmount, balanceAmount, complementAmount, endOfStayComplementAmount, endOfStayComplementDetail FROM reservations WHERE id = ?').get(id);

const planned = (id, paid) => {
  paid.forEach((isPaid, index) => db.prepare(`INSERT INTO reservation_installments (reservationId, number, dueDate, amountCents, paid, paidDate)
    VALUES (?, ?, ?, 22000, ?, ?)`).run(id, index + 1, isoPlus(-1 - index), isPaid ? 1 : 0, isPaid ? isoPlus(-2) : null));
  db.prepare('UPDATE reservations SET balancePaid = 0 WHERE id = ?').run(id);
};
const lineCount = (id, optionId) => db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, optionId).n;

test('rule 66 (the finding of 2026-11-10): on the arrival day, before the arrival SAS, a priced option is committed on the arrival complement', () => {
  const id = seedStay({ start: 0 });
  const before = money(id);
  assert.equal(orderCollection(id), 'arrival');
  const result = commitOrder(id, { ...named(1), lines: [{ kind: 'option', id: 102, quantity: 2 }] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.byKey, { 'opt:102': 12 });
  assert.equal(result.total, 12);
  assert.equal(result.collectAt, 'arrival');
  const after = money(id);
  assert.equal(after.complementAmount - before.complementAmount, 12);
  assert.equal(after.depositAmount, before.depositAmount);
  assert.equal(after.balanceAmount, before.balanceAmount);
  assert.equal(after.endOfStayComplementAmount, before.endOfStayComplementAmount);
  assert.equal(db.prepare('SELECT arrivalExtrasBaseline FROM reservations WHERE id = ?').get(id).arrivalExtrasBaseline, null, 'no baseline pinned: the arrival is not marked');
});

test('rule 66: J-5, acompte and solde paid — priceOrder answers the same, the commit writes one history entry', () => {
  const id = seedStay({ start: 5 });
  const before = money(id);
  const priced = priceOrder(id, [{ kind: 'option', id: 102, quantity: 3 }]);
  assert.deepEqual([priced.status, priced.byKey, priced.collectAt], [200, { 'opt:102': 18 }, 'arrival']);
  assert.deepEqual(money(id), before, 'priceOrder writes nothing');
  const result = commitOrder(id, { ...named(2), lines: [{ kind: 'option', id: 102, quantity: 3 }] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const after = money(id);
  assert.equal(after.complementAmount, 18);
  assert.deepEqual([after.depositAmount, after.balanceAmount, after.endOfStayComplementAmount], [before.depositAmount, before.balanceAmount, before.endOfStayComplementAmount]);
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id).flatMap((r) => JSON.parse(r.changedFields));
  assert.ok(history.some((c) => c.field === 'shopOrder' && c.to === 'Commande boutique #2'));
});

test('rule 66: a second order adds to the arrival complement, a line of the same item adds up', () => {
  const id = seedStay({ start: 3 });
  assert.equal(commitOrder(id, { ...named(3), lines: [{ kind: 'option', id: 102, quantity: 1 }] }).status, 200);
  const second = commitOrder(id, { ...named(4), lines: [{ kind: 'option', id: 102, quantity: 2 }] });
  assert.deepEqual([second.status, second.byKey], [200, { 'opt:102': 12 }]);
  assert.equal(money(id).complementAmount, 18);
  assert.equal(db.prepare('SELECT quantity FROM reservation_options WHERE reservationId = ? AND optionId = 102').get(id).quantity, 3);
});

test('rule 68, 66: the solde still due — orderCollection is unavailable and the order is refused ORDER_OFF_ARRIVAL_COMPLEMENT, nothing written', () => {
  const id = seedStay({ start: 5, balancePaid: 0 });
  const before = money(id);
  assert.equal(orderCollection(id), 'unavailable');
  const priced = priceOrder(id, [{ kind: 'option', id: 102, quantity: 1 }]);
  assert.deepEqual([priced.status, priced.body.code], [409, 'ORDER_OFF_ARRIVAL_COMPLEMENT']);
  const result = commitOrder(id, { ...named(5), lines: [{ kind: 'option', id: 102, quantity: 1 }] });
  assert.deepEqual([result.status, result.body.code], [409, 'ORDER_OFF_ARRIVAL_COMPLEMENT']);
  assert.deepEqual(money(id), before);
  assert.equal(lineCount(id, 102), 0);
});

test('rule 68 (D2): a plan with an installment still due is unavailable; a plan all paid is the arrival complement', () => {
  const due = seedStay({ start: 5, balancePaid: 0 });
  planned(due, [true, false]);
  assert.equal(orderCollection(due), 'unavailable');
  assert.equal(commitOrder(due, { ...named(6), lines: [{ kind: 'option', id: 102, quantity: 1 }] }).body.code, 'ORDER_OFF_ARRIVAL_COMPLEMENT');
  const settled = seedStay({ start: 5, balancePaid: 0 });
  planned(settled, [true, true]);
  assert.equal(orderCollection(settled), 'arrival');
  const result = commitOrder(settled, { ...named(7), lines: [{ kind: 'option', id: 102, quantity: 1 }] });
  assert.deepEqual([result.status, result.collectAt], [200, 'arrival'], JSON.stringify(result.body));
});

test('rule 66 (owner 2026-11-10): a stored price the engine no longer reproduces does not refuse the order — only its own growth is measured', () => {
  const id = seedStay({ start: 5 });
  db.prepare('UPDATE reservations SET finalPrice = 999 WHERE id = ?').run(id);
  assert.equal(orderCollection(id), 'arrival');
  const priced = priceOrder(id, [{ kind: 'option', id: 102, quantity: 1 }]);
  assert.deepEqual([priced.status, priced.byKey], [200, { 'opt:102': 6 }]);
  const result = commitOrder(id, { ...named(8), lines: [{ kind: 'option', id: 102, quantity: 1 }] });
  assert.deepEqual([result.status, result.byKey, result.collectAt], [200, { 'opt:102': 6 }, 'arrival'], JSON.stringify(result.body));
});

test('rule 68 (owner 2026-11-10): a platform stay with nothing paid orders before the arrival, on the arrival complement', () => {
  const id = seedStay({ start: 5, balancePaid: 0 });
  db.prepare("UPDATE reservations SET platform = 'booking', depositAmount = 0 WHERE id = ?").run(id);
  assert.equal(orderCollection(id), 'arrival');
  const before = money(id);
  const result = commitOrder(id, { ...named(13), lines: [{ kind: 'option', id: 102, quantity: 2 }] });
  assert.deepEqual([result.status, result.byKey, result.collectAt], [200, { 'opt:102': 12 }, 'arrival'], JSON.stringify(result.body));
  const after = money(id);
  assert.equal(after.complementAmount - before.complementAmount, 12);
  assert.equal(after.balanceAmount, before.balanceAmount);
  assert.equal(orderCollection(seedStay({ start: 5, balancePaid: 0 })), 'unavailable', 'a direct stay with its solde due still orders on site');
});

test('rule 66: the arrival marked — the end-of-stay path, collectAt departure, the arrival money untouched', () => {
  const id = seedStay({ start: -1, checkInDone: 1 });
  assert.equal(orderCollection(id), 'departure');
  const before = money(id);
  const result = commitOrder(id, { ...named(10), lines: [{ kind: 'option', id: 102, quantity: 2 }] });
  assert.deepEqual([result.status, result.byKey, result.collectAt], [200, { 'opt:102': 12 }, 'departure']);
  const after = money(id);
  assert.deepEqual([after.complementAmount, after.endOfStayComplementAmount], [before.complementAmount, 12]);
  const sas = seedStay({ start: 0 });
  db.prepare("UPDATE reservations SET arrivalSasDoneAt = datetime('now') WHERE id = ?").run(sas);
  assert.equal(orderCollection(sas), 'departure');
});

test('rule 66: a free unit and a 0 € item before the arrival add nothing to the complement', () => {
  const id = seedStay({ start: 5 });
  const result = commitOrder(id, { ...named(11), lines: [{ kind: 'option', id: 103, quantity: 2 }] });
  assert.deepEqual([result.status, result.byKey, result.total, result.collectAt], [200, {}, 0, 'arrival']);
  assert.equal(money(id).complementAmount, 0);
});

test('rule 66: a resource session before the arrival — the free hour is offered, the second is the complement', { skip: skipWithout(['hourly-resources']) }, () => {
  const id = seedStay({ start: 5 });
  const session = (start, end) => ({ date: isoPlus(6), start, end });
  const free = priceOrder(id, [{ kind: 'resource', id: 202, sessions: [session('18:00', '19:00')] }]);
  assert.deepEqual([free.status, free.total], [200, 0]);
  const paid = commitOrder(id, { ...named(12), lines: [{ kind: 'resource', id: 202, sessions: [session('18:00', '20:00')] }] });
  assert.deepEqual([paid.status, paid.byKey, paid.collectAt], [200, { 'res:202': 30 }, 'arrival']);
  assert.equal(money(id).complementAmount, 30);
});

test('rule 67: orderCollection — arrival / departure / unavailable / closed', () => {
  assert.equal(orderCollection(seedStay({ start: 5 })), 'arrival');
  assert.equal(orderCollection(seedStay({ start: 5, balancePaid: 0 })), 'unavailable');
  assert.equal(orderCollection(seedStay({ start: -1, checkInDone: 1 })), 'departure');
  const closed = seedStay({ start: -1, checkInDone: 1 });
  db.prepare('UPDATE reservations SET endOfStayComplementPaid = 1 WHERE id = ?').run(closed);
  assert.equal(orderCollection(closed), 'closed');
  assert.equal(orderCollection(999999), 'unavailable');
  const devis = seedStay({ start: 5 });
  db.prepare("UPDATE reservations SET kind = 'devis' WHERE id = ?").run(devis);
  assert.equal(orderCollection(devis), 'unavailable');
});

test('rule 66: a percentage line sold by the order is counted in byKey at what the line gains, the sum matches the complement', () => {
  db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (104, 'Assurance', 5, 'percent_of_stay')").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 104)').run();
  const id = seedStay({ start: 5 });
  const result = commitOrder(id, { ...named(13), lines: [{ kind: 'option', id: 104, quantity: 1 }] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.byKey, { 'opt:104': 20 });
  assert.equal(money(id).complementAmount, 20);
});
