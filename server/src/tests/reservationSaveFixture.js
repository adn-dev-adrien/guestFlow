// Shared fixture of the reservation-save suites of the 2026-10-27 spec review: an in-memory GuestFlow
// database (the real schema), the real reservations controller, and helpers that create a stay and
// save it back the way the fiche does — GET the reservation, change what the operator changed, PUT.
//
// Requires `process.env.DB_PATH = ':memory:'` to be set by the test file BEFORE requiring this module.

const db = require('../database');
const controller = require('../controllers/reservationsController');

const ADMIN = { role: 'admin' };

function respond() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

/**
 * Property 1 « Gîte »: 100 € a night, check-in 16:00 / check-out 11:00, 3 h of cleaning, acompte 30 %,
 * caution 500 €, a 80 € « Ménage » option (id 50) and a bed-linen option (id 51) offered.
 * Option 52 is a bed-linen option NOT offered on the property.
 */
function seed() {
  if (db.prepare('SELECT 1 FROM properties WHERE id = 1').get()) return;
  db.prepare(`INSERT INTO properties (id, name, maxGuests, maxBabies, singleBeds, doubleBeds,
      defaultCheckIn, defaultCheckOut, cleaningHours, depositEnabled, depositPercent, defaultCautionAmount, balanceDaysBefore)
    VALUES (1, 'Gîte', 6, 2, 2, 2, '16:00', '11:00', 3, 1, 30, 500, 30)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (50, 'Ménage', 'per_stay', 80)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price, countsAsBedLinen) VALUES (51, 'Linge de lit', 'per_stay', 0, 1)").run();
  db.prepare("INSERT INTO options (id, title, priceType, price, countsAsBedLinen) VALUES (52, 'Draps luxe', 'per_stay', 20, 1)").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 50), (1, 51)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Fiche')").run();
}

function stayBody(over = {}) {
  return {
    propertyId: 1, clientId: 1, startDate: '2027-07-20', endDate: '2027-07-23',
    checkInTime: '16:00', checkOutTime: '11:00', platform: 'direct',
    adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    depositDisabled: 0, options: [], customPrice: '', discountPercent: 0, depositAmountOverride: '',
    ...over,
  };
}

function create(body, user = ADMIN) {
  seed();
  const res = respond();
  controller.create({ body, user }, res);
  return res;
}

function createStay(over = {}) {
  const res = create(stayBody(over));
  if (res.statusCode !== 200) throw new Error(`create failed: ${JSON.stringify(res.body)}`);
  return Number(res.body.id);
}

const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));

function getFiche(id) {
  const res = respond();
  controller.getById({ params: { id: String(id) }, user: ADMIN, query: {} }, res);
  if (res.statusCode !== 200) throw new Error(`get failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

/** The PUT body the fiche sends back for a reservation it just loaded, with `over` applied on top. */
function ficheBody(id, over = {}) {
  const r = getFiche(id);
  return {
    ...r,
    options: (r.options || []).map((o) => ({ optionId: o.optionId, quantity: o.quantity, inComplement: o.inComplement })),
    customOptions: r.customOptions || [],
    resources: [],
    customPrice: r.customPrice == null ? '' : r.customPrice,
    ...over,
  };
}

async function save(id, over = {}, { unlockPast = false } = {}) {
  const res = respond();
  await controller.update({ params: { id: String(id) }, body: { ...ficheBody(id, over), ...(unlockPast ? { unlockPast: true } : {}) }, user: ADMIN }, res);
  return res;
}

function history(id) {
  return db.prepare('SELECT eventType, changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id')
    .all(Number(id))
    .map((h) => ({ eventType: h.eventType, changes: JSON.parse(h.changedFields || '[]') }));
}

module.exports = { db, controller, respond, seed, stayBody, create, createStay, rowOf, getFiche, ficheBody, save, history, ADMIN };
