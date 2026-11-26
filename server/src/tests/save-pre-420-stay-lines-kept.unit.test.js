// specs/pricing/pricing-components.md §3 rules 13 and 82, owner 2026-11-15 (existing stays keep their figures) — stabilisation loop t7, S7-3
// (2026-11-16): a save that moves nothing on a stay booked before 4.2.0 keeps its lines and its price, even when the engine would derive an
// automatic option the stay never stored (an early arrival) and one of its lines is of an article its lodging no longer offers. Before: the
// missing automatic option re-priced the save, which dropped the unlinked « Ménage » 80 € and stored « Arrivée anticipée » instead (prod stay
// 14: 807,20 → 777,70); master left it intact. A stay booked once 4.2.0 is installed still stores the line on its next save (rule 82).
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FAR_YEAR } = require('./farYearFixture');

const db = require('../database');
const controller = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled, defaultCheckIn)
            VALUES (1, 'Gîte', 8, 'per_day_per_person', 1, 0, '16:00')`).run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
const earlyId = Number(db.prepare(`INSERT INTO options (title, priceType, price, autoOptionType, autoEnabled, autoPricingMode)
  VALUES ('Arrivée anticipée', 'per_stay', 40, 'early_check_in', 1, 'fixed')`).run().lastInsertRowid);
const cleaningId = Number(db.prepare("INSERT INTO options (title, priceType, price, autoOptionType) VALUES ('Ménage', 'per_stay', 80, 'cleaning')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(earlyId);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(cleaningId);

let slot = 0;
const lines = (id) => db.prepare('SELECT optionId, totalPrice, offered FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(id);
const stored = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

// A stay sold with the ménage, stored without its early-arrival line, whose lodging no longer offers the ménage: stay 14's shape.
function stayWithUnlinkedCleaning({ readsSaleLines }) {
  slot += 1;
  const day = String(slot * 4).padStart(2, '0');
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.create({
    body: {
      propertyId: 1, clientId: 1, startDate: `${FAR_YEAR}-06-${day}`, endDate: `${FAR_YEAR}-06-${String(slot * 4 + 2).padStart(2, '0')}`, checkInTime: '14:00', checkOutTime: '10:00',
      platform: 'direct', adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1, options: [{ optionId: cleaningId, quantity: 1 }],
    },
    user: { role: 'admin' },
  }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const id = res.body.id;
  const early = db.prepare('SELECT totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, earlyId);
  db.prepare('DELETE FROM reservation_options WHERE reservationId = ? AND optionId = ?').run(id, earlyId);
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - ?, totalPrice = totalPrice - ?, readsSaleLines = ? WHERE id = ?')
    .run(early ? early.totalPrice : 0, early ? early.totalPrice : 0, readsSaleLines, id);
  db.prepare('DELETE FROM property_options WHERE propertyId = 1 AND optionId = ?').run(cleaningId);
  return id;
}

test.afterEach(() => {
  db.prepare('INSERT OR IGNORE INTO property_options (propertyId, optionId) VALUES (1, ?)').run(cleaningId);
});

test('S7-3 — a stay booked before 4.2.0: « Enregistrer » with nothing changed keeps the unlinked ménage and the price', () => {
  const id = stayWithUnlinkedCleaning({ readsSaleLines: 0 });
  const before = { lines: lines(id), row: stored(id) };
  assert.deepEqual(before.lines.map((line) => [line.optionId, line.totalPrice]), [[cleaningId, 80]]);
  const saved = controller.performUpdate(id, storedBody(id));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(lines(id), before.lines, 'no sold line replaced');
  for (const field of ['finalPrice', 'balanceAmount', 'depositAmount', 'complementAmount']) assert.equal(stored(id)[field], before.row[field], field);
});

test('S7-3 — rule 82 still holds on a stay booked once 4.2.0 is installed: its next save stores the early-arrival line', () => {
  const id = stayWithUnlinkedCleaning({ readsSaleLines: 1 });
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(cleaningId);
  const saved = controller.performUpdate(id, storedBody(id));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.ok(lines(id).some((line) => line.optionId === earlyId && line.totalPrice === 40), JSON.stringify(lines(id)));
  assert.ok(lines(id).some((line) => line.optionId === cleaningId && line.totalPrice === 80));
});
