// specs/pricing-components.md §3 rules 20, 74 and 82 — an automatic option (« Arrivée anticipée ») that a stay never stored:
// a stay whose departure is over is not billed it after the fact, a current or future stay is billed it at its price (unless the
// operator offered it) and the next save stores the line, whose fixed price is then the one it was sold at.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FAR_YEAR } = require('./farYearFixture');

const db = require('../database');
const controller = require('../controllers/reservationsController');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');

db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled, defaultCheckIn)
            VALUES (1, 'Gîte', 8, 'per_day_per_person', 1, 0, '16:00')`).run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
const earlyId = Number(db.prepare(`INSERT INTO options (title, priceType, price, autoOptionType, autoEnabled, autoPricingMode)
  VALUES ('Arrivée anticipée', 'per_stay', 40, 'early_check_in', 1, 'fixed')`).run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(earlyId);

let slot = 0;
const body = (startDate, endDate, extra = {}) => ({
  propertyId: 1, clientId: 1, startDate, endDate, checkInTime: '14:00', checkOutTime: '10:00', platform: 'direct',
  adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1, options: [], ...extra,
});
const earlyRow = (id) => db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(id, earlyId);
const earlyLine = (quote) => (quote.optionLines || []).find((line) => Number(line.optionId) === earlyId);
const stored = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

// A stay of the future, saved through the create path, then stripped of its early line: the shape of a stay that never stored it.
function futureStayWithoutLine(extra = {}) {
  slot += 1;
  const day = String(slot * 4).padStart(2, '0');
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.create({ body: body(`${FAR_YEAR}-05-${day}`, `${FAR_YEAR}-05-${String(slot * 4 + 2).padStart(2, '0')}`, extra), user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body.id;
}

function pastStayWithoutLine() {
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, checkOutTime, sourceType)
    VALUES (1, 1, '2026-04-13', '2026-04-16', 'direct', 2, 300, 300, 'reservation', '14:00', '10:00', 'manual')`).run().lastInsertRowid);
  db.prepare('INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, ?, ?, 100)').run(id, '2026-04-13', 'Standard', 'fixed');
  return id;
}

test('rule 82 — a past stay is not billed at departure an automatic option its lines do not hold', () => {
  const id = pastStayWithoutLine();
  assert.equal(earlyRow(id), undefined);
  const quote = quoteStoredReservation(db, stored(id));
  assert.equal(earlyLine(quote).totalPrice, 40, 'the line stays in the stay total, as it always was');
  assert.deepEqual(quote.midStayExtrasLines, [], 'it is no sale of the stay');
  assert.equal(quote.endOfStayComplementTotal || 0, 0, 'nothing owed at departure');
});

test('rule 82 — a catalogue line stored with no price is not a sale of the stay either', () => {
  const id = pastStayWithoutLine();
  const extra = Number(db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Panier', 'per_stay', 25)").run().lastInsertRowid);
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, ?, 1, 0, 1, ?, 0, 0)')
    .run(id, extra, 'per_stay');
  const quote = quoteStoredReservation(db, stored(id));
  assert.deepEqual((quote.midStayExtrasLines || []).filter((line) => /Panier/.test(line.label || line.title || '')), []);
  assert.equal(quote.endOfStayComplementTotal || 0, 0);
});

test('rule 82 — a past stay that STORED the line keeps it', () => {
  const id = pastStayWithoutLine();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, ?, 1, 40, 1, ?, 40, 0)')
    .run(id, earlyId, 'per_stay');
  assert.equal(earlyLine(quoteStoredReservation(db, stored(id))).totalPrice, 40);
});

test('rule 82 — a future stay without the line is billed it at its price', () => {
  const id = futureStayWithoutLine();
  db.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(id);
  const quote = quoteStoredReservation(db, stored(id));
  assert.equal(earlyLine(quote).totalPrice, 40);
  assert.equal(quote.optionsTotal, 40);
});

test('rule 82 — a future stay whose operator offered the option is not billed it', () => {
  const id = futureStayWithoutLine({ offeredOptionIds: [earlyId] });
  const row = earlyRow(id);
  assert.ok(row && row.offered === 1, 'the offered line is stored');
  const quote = quoteStoredReservation(db, stored(id));
  assert.equal(earlyLine(quote).totalPrice, 0);
  assert.equal(quote.optionsTotal, 0);
});

test('rule 82 — a booking saved with an early arrival stores the line, priced', () => {
  const id = futureStayWithoutLine();
  const row = earlyRow(id);
  assert.ok(row, 'the create path stores the automatic line');
  assert.deepEqual([row.totalPrice, row.unitPrice, row.offered], [40, 40, 0]);
});

test('rule 82 — the next save of a future stay materialises the missing line', () => {
  const id = futureStayWithoutLine();
  db.prepare('DELETE FROM reservation_options WHERE reservationId = ?').run(id);
  const row0 = stored(id);
  const saved = controller.performUpdate(id, body(row0.startDate, row0.endDate, { notes: 'Note', options: [] }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const row = earlyRow(id);
  assert.ok(row, 'the line is stored');
  assert.equal(row.totalPrice, 40);
});

test('rule 74 — a stored fixed price is not re-priced when the catalogue moves', () => {
  const id = futureStayWithoutLine();
  assert.equal(earlyRow(id).unitPrice, 40);
  db.prepare('UPDATE options SET price = 90 WHERE id = ?').run(earlyId);
  try {
    assert.equal(earlyLine(quoteStoredReservation(db, stored(id))).totalPrice, 40);
  } finally {
    db.prepare('UPDATE options SET price = 40 WHERE id = ?').run(earlyId);
  }
});
