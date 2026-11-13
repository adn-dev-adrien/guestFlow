// specs/plugins-phase-1-sdk.md rule 47, reading of 2026-11-10 (audit R36-M-H1, first used by specs/guest-app.md rule 55)
// — the core commit refuses an order asking more persons than the stay can still be served: the engine serves a
// per-person line at most max(1, party, capacity) persons, so the persons above it were written and never billed (the
// auditor's core probe: a second order of 5 billed 30 €, a third 0 €). Refused by `priceOrder` and `commitOrder` alike,
// nothing written. The boot schema and stays around today.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { priceOrder, commitOrder } = require('../utils/midStayOrderCommit');

const named = (ref) => ({ source: 'shopOrder', ref, history: { field: 'shopOrder', label: 'Commande boutique', text: `Commande boutique #${ref}` } });

const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (301, 'Planche', 10, 'per_person'), (302, 'Cidre', 6, 'per_stay')").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 301), (1, 302)').run();

function seedStay() {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice, discountPercent, finalPrice,
       depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind, checkInDone, checkInTime, checkOutTime, singleBeds,
       doubleBeds, babyBeds, endOfStayComplementPaid, cautionAmount, balanceDueDate, balancePaid)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, 'direct', 400, 0, 400, 0, 400, 1, 0, 'reservation', 1, '16:00', '10:00', 0, 0, 0, 0, 0, ?, 1)`)
    .run(isoPlus(-1), isoPlus(3), isoPlus(-1)).lastInsertRowid);
  for (let i = -1; i < 3; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)").run(id, isoPlus(i));
  }
  return id;
}

const persons = (quantity) => [{ kind: 'option', id: 301, quantity }];
const line = (id) => db.prepare('SELECT billedUnits, cardPersons, totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = 301').get(id);

test('rule 47 reading: a per-person order beyond max(party, capacity) is refused, never billed short nor at 0 € (the auditor’s core probe)', () => {
  const id = seedStay();
  const first = commitOrder(id, { ...named(1), lines: persons(5) });
  assert.equal(first.status, 200);
  assert.equal(first.total, 50);
  const quoted = priceOrder(id, persons(5));
  assert.equal(quoted.status, 409);
  assert.deepEqual(quoted.body, {
    error: 'Plus assez de personnes à servir pour cet article.', code: 'ORDER_PERSONS_EXCEEDED', key: 'opt:301', left: 3,
  });
  const written = commitOrder(id, { ...named(2), lines: persons(5) });
  assert.equal(written.status, 409);
  assert.deepEqual(line(id), { billedUnits: 5, cardPersons: 5, totalPrice: 50 }, 'nothing written');
  assert.equal(priceOrder(id, persons(3)).total, 30, 'up to the persons left, billed whole');
  assert.equal(commitOrder(id, { ...named(3), lines: persons(3) }).total, 30);
  assert.equal(priceOrder(id, persons(1)).body.left, 0);
});

test('rule 47 reading: other price types are not judged', () => {
  const id = seedStay();
  assert.equal(priceOrder(id, persons(4)).total, 40);
  assert.equal(priceOrder(id, [{ kind: 'option', id: 302, quantity: 30 }]).status, 200, 'a unit item has no persons');
});
