// specs/reservation-save-keeps-pricing.md rule 1 — review of #847, finding 1: the replay returns an
// engine-derived auto-option (early check-in, cot) as a plain locked line, the save returns it as a
// derived one. Only what the line BILLS may decide whether the save moved a pricing input: 14 of 52
// fiches were re-priced by a note.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

let seeded = false;
let slot = 0;
function fixture(overrides = {}) {
  const db = require('../database');
  const controller = require('../controllers/reservationsController');
  if (!seeded) {
    db.prepare(`INSERT INTO properties (id, name, maxGuests, maxBabies, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled, defaultCheckIn)
                VALUES (1, 'Gîte', 8, 2, 'per_day_per_person', 1, 0, '16:00')`).run();
    db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
    db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Revue')").run();
    const early = db.prepare(`INSERT INTO options (title, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
                VALUES ('Arrivée anticipée', 'per_stay', 40, 'early_check_in', 1, 'proportional', '10:00')`).run().lastInsertRowid;
    db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(early);
    db.prepare("INSERT INTO resources (name, quantity, price, priceType) VALUES ('Lit bébé', 3, 0, 'per_stay')").run();
    db.prepare("UPDATE options SET price = 5, priceType = 'per_stay', autoEnabled = 1 WHERE autoOptionType = 'baby_bed'").run();
    db.prepare("INSERT INTO property_options (propertyId, optionId) SELECT 1, id FROM options WHERE autoOptionType = 'baby_bed'").run();
    seeded = true;
  }
  slot += 1;
  const body = (extra = {}) => ({
    propertyId: 1, clientId: 1, startDate: `2099-03-${String(slot * 5).padStart(2, '0')}`, endDate: `2099-03-${String(slot * 5 + 2).padStart(2, '0')}`,
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct', adults: 2, children: 0, teens: 0, babies: 0,
    singleBeds: 0, doubleBeds: 0, babyBeds: 0, depositDisabled: 1, options: [], ...overrides, ...extra,
  });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.create({ body: body(), user: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return { db, controller, id: res.body.id, body };
}

const historyCount = (db, id) => db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(id).n;

function untouchedSaveKeepsMoney({ db, controller, id, body }) {
  db.prepare('UPDATE reservations SET finalPrice = finalPrice - 5, balanceAmount = balanceAmount - 5 WHERE id = ?').run(id);
  const before = db.prepare('SELECT finalPrice, balanceAmount FROM reservations WHERE id = ?').get(id);
  const history = historyCount(db, id);
  const saved = controller.performUpdate(id, body({ notes: 'Note' }));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual({ ...db.prepare('SELECT finalPrice, balanceAmount FROM reservations WHERE id = ?').get(id) }, { ...before });
  assert.equal(historyCount(db, id), history + 1, 'only the note is logged');
}

test('rule 1 — a stay with an early check-in line, saved with a note, keeps its money', () => {
  const stay = fixture({ checkInTime: '13:00' });
  const line = stay.db.prepare("SELECT totalPrice FROM reservation_options ro JOIN options o ON o.id = ro.optionId WHERE ro.reservationId = ? AND o.autoOptionType = 'early_check_in'").get(stay.id);
  assert.ok(line && line.totalPrice > 0, 'the early check-in is billed');
  untouchedSaveKeepsMoney(stay);
});

test('rule 1 — a stay with a cot, saved with a note, keeps its money', () => {
  const stay = fixture({ babies: 1, babyBeds: 1 });
  const line = stay.db.prepare("SELECT 1 AS x FROM reservation_options ro JOIN options o ON o.id = ro.optionId WHERE ro.reservationId = ? AND o.autoOptionType = 'baby_bed'").get(stay.id);
  assert.ok(line, 'the cot line is stored');
  untouchedSaveKeepsMoney(stay);
});

test('rule 1 — an offered auto-option whose catalogue price moved does not count as a pricing change', () => {
  const stay = fixture({ checkInTime: '13:00' });
  const option = stay.db.prepare("SELECT id FROM options WHERE autoOptionType = 'early_check_in'").get();
  stay.db.prepare('UPDATE reservation_options SET offered = 1, totalPrice = 0 WHERE reservationId = ? AND optionId = ?').run(stay.id, option.id);
  stay.db.prepare('UPDATE options SET price = 55 WHERE id = ?').run(option.id);
  untouchedSaveKeepsMoney({ ...stay, body: (extra) => stay.body({ offeredOptionIds: [option.id], ...extra }) });
});
