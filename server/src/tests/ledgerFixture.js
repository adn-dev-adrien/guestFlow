// Shared fixture of the specs/reservation-payment-ledger.md suites: an in-memory GuestFlow database
// (the real schema), one property, and helpers that drive the real reservations controller — create,
// save, live quote, payment PATCH — the way the fiche does.
//
// Requires `process.env.DB_PATH = ':memory:'` to be set by the test file BEFORE requiring this module.

const db = require('../database');
const controller = require('../controllers/reservationsController');

function respond() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const ADMIN = { role: 'admin' };

let seeded = false;
/**
 * Property 1: 100 € a night, acompte 30 %, caution 400 €, tourist tax 1,20 € per adult and night.
 * Property 2: same, tourist tax as a percentage of the accommodation (it follows the price in steps),
 * and a 4 % cancellation insurance (option 10, priced on the stay).
 */
function seed() {
  if (seeded) return;
  seeded = true;
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled,
      depositPercent, defaultCautionAmount, balanceDaysBefore)
    VALUES (1, 'Gîte', 8, 'per_day_per_person', 1.2, 1, 30, 400, 30)`).run();
  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPercentage, depositEnabled,
      depositPercent, defaultCautionAmount, balanceDaysBefore)
    VALUES (2, 'Lodge', 8, 'percentage_accommodation', 5, 1, 30, 0, 30)`).run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (1, 'Standard', 100)").run();
  db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (2, 'Standard', 100)").run();
  db.prepare(`INSERT INTO options (id, title, priceType, price, isCancellationInsurance)
    VALUES (10, 'Assurance annulation', 'percent_of_stay', 4, 1)`).run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (2, 10)').run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Camille', 'Registre')").run();
}

/** The fiche's save body for a 3-night stay of two adults, far enough ahead to carry an acompte. */
function stayBody(over = {}) {
  return {
    propertyId: 1, clientId: 1, startDate: '2027-07-20', endDate: '2027-07-23',
    checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct',
    adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 0, babyBeds: 0,
    depositDisabled: 0, options: [], selectedOptions: [], customPrice: '', discountPercent: 0,
    depositAmountOverride: '',
    ...over,
  };
}

// Each stay gets its own week, so the suites never collide on availability.
let slot = 0;
function nextWeek() {
  const start = new Date(Date.UTC(2027, 6, 5 + 7 * slot));
  slot += 1;
  const end = new Date(start.getTime() + 3 * 86400000);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function createStay(over = {}) {
  seed();
  const res = respond();
  controller.create({ body: stayBody({ ...nextWeek(), ...over }), user: ADMIN }, res);
  if (res.statusCode !== 200) throw new Error(`create failed: ${JSON.stringify(res.body)}`);
  return Number(res.body.id);
}

const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(Number(id));

/** The live quote the fiche asks for (calculate-price), with the stored paid flags. */
async function liveQuote(id, over = {}) {
  seed();
  const row = id ? rowOf(id) : null;
  const res = respond();
  await controller.calculatePrice({
    body: {
      ...stayBody(row ? { propertyId: row.propertyId, platform: row.platform, startDate: row.startDate, endDate: row.endDate } : {}),
      ...(id ? { reservationId: id } : {}),
      depositPaid: row ? Boolean(row.depositPaid) : false,
      balancePaid: row ? Boolean(row.balancePaid) : false,
      depositAmount: row ? row.depositAmount : 0,
      balanceAmount: row ? row.balanceAmount : 0,
      ...over,
    },
    user: ADMIN,
  }, res);
  if (res.statusCode !== 200) throw new Error(`calculate-price failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function save(id, over = {}) {
  const row = rowOf(id);
  const res = respond();
  await controller.update({ params: { id }, body: stayBody({
    propertyId: row.propertyId, platform: row.platform, startDate: row.startDate, endDate: row.endDate, ...over,
  }), user: ADMIN }, res);
  return res;
}

function mark(id, body) {
  const res = respond();
  controller.updatePayment({ params: { id }, body, user: ADMIN }, res);
  return res;
}

module.exports = { db, controller, respond, seed, stayBody, createStay, rowOf, liveQuote, save, mark, ADMIN };
