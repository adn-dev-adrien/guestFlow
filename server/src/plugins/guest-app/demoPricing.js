/**
 * Prices a demo session's cart with the core's own sale service (specs/guest-app/guest-app-demo-mode.md rules 9, 10). The fictitious stay
 * has no reservation, and the sale service plays its quote on a stored one: so the stay is written inside a transaction that is always
 * rolled back, the quote (or the collection moment) is asked of it there, and nothing is left behind. `sell` is deliberately absent:
 * a demo order is never committed.
 */

const { parisDate } = require('./currentStay');

const ROLLBACK = Symbol('demo-pricing-rollback');

function buildDemoPricing({ db, sale }) {
  /** Runs `fn(reservationId)` on a transient copy of the demo stay; whatever it wrote is rolled back. */
  function onTransientStay(stay, at, fn) {
    let result;
    try {
      db().transaction(() => {
        const clientId = Number(db().prepare('INSERT INTO clients (firstName, lastName, email) VALUES (?, ?, ?)')
          .run(stay.clientFirstName, stay.clientLastName, 'demo@example.invalid').lastInsertRowid);
        const started = stay.startDate <= parisDate(at);
        const reservationId = Number(db().prepare(`
          INSERT INTO reservations
            (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice,
             discountPercent, finalPrice, depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind,
             checkInDone, checkInTime, checkOutTime, singleBeds, doubleBeds, babyBeds, endOfStayComplementPaid,
             cautionAmount, balanceDueDate, balancePaid, reservationNumber)
          VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, 0, 0, 0, 0, 0, 1, 0, 'reservation', ?, ?, ?, 0, 0, 0, 0, 0, ?, 1, ?)
        `).run(stay.propertyId, clientId, stay.startDate, stay.endDate, stay.adults, stay.platform, started ? 1 : 0,
          stay.checkInTime || '15:00', stay.checkOutTime || '11:00', stay.startDate, `DEMO-${Date.now()}`).lastInsertRowid);
        const nights = db().prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 0)");
        for (let day = Date.parse(`${stay.startDate}T00:00:00Z`); day < Date.parse(`${stay.endDate}T00:00:00Z`); day += 86400000) {
          nights.run(reservationId, new Date(day).toISOString().slice(0, 10));
        }
        result = fn(reservationId);
        throw ROLLBACK;
      })();
    } catch (err) {
      if (err !== ROLLBACK) throw err;
    }
    return result;
  }

  return {
    /** The sale service's quote for the demo stay: `{ status: 200, lines, totalCents, … }` or `{ status, body }`. */
    quote: (stay, requests, options) => onTransientStay(stay, options.now, (id) => sale().quote(id, requests, options)),
    /** Where a sale taken now is collected for the demo stay: `arrival` | `departure` | `closed`. */
    collectionOf: (stay, at) => onTransientStay(stay, at, (id) => sale().collectionOf(id, at)),
  };
}

module.exports = { buildDemoPricing };
