// Shared fixtures for the order suites (specs/guest-app.md rules 24-38, 43-45). Not a test file. The order is
// written by the core's own save (`performUpdate`) on the boot schema, so these suites run on the app's database
// (DB_PATH=:memory:) and on stays dated around today: the fiche's mid-stay window is the core's, read on today's date.

process.env.DB_PATH = ':memory:';

const { ORDER_SOURCE, ORDER_REFUND_LABELS } = require('../controllers/ordersController');
const { applyPluginSchema, optionalPlugin } = require('../../sdk/testing');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const { startApi } = require('./guestAppFixtures');

const { createHourlyContributor } = optionalPlugin(() => require('../../hourly-resources/pricing'));
const { createHourlyFamily } = optionalPlugin(() => require('../../hourly-resources/hourlyFamily'));
const { createScheduler } = optionalPlugin(() => require('../../hourly-resources/scheduler'));

const db = require('../../../database');

applyPluginSchema(db, 'guest-app');
if (createScheduler) applyPluginSchema(db, 'hourly-resources');
db.prepare("INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled) VALUES (1, 'La Granja', 8, 'per_day_per_person', 0, 0), (2, 'L''Estiva', 6, 'per_day_per_person', 0, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Marie', 'Le Goff-Durand', 'marie@example.test')").run();

/** A local ISO day `days` from today: the core reads its window on today's date. */
function isoPlus(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let stayNumber = 0;

/** A direct stay that started yesterday and ends in three days, 4 nights at 100 €, checked in (`checkedIn: 0`: not arrived). */
function seedStay({
  propertyId = 1, start = -1, end = 3, platform = 'direct', adults = 2, endOfStayPaid = 0, checkedIn = 1, balancePaid = 1,
} = {}) {
  stayNumber += 1;
  // The stored price is the nights' own: a stay whose stored price disagrees with its nights reads as re-priced by every sale.
  const price = (end - start) * 100;
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice,
       discountPercent, finalPrice, depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind,
       checkInDone, checkInTime, checkOutTime, singleBeds, doubleBeds, babyBeds, endOfStayComplementPaid,
       cautionAmount, balanceDueDate, balancePaid, reservationNumber)
      VALUES (?, 1, ?, ?, ?, 0, 0, 0, ?, ?, 0, ?, 0, ?, 1, 0, 'reservation', ?, '16:00', '10:00', 0, 0, 0, ?, 0, ?, ?, ?)`)
    .run(propertyId, isoPlus(start), isoPlus(end), adults, platform, price, price, price, checkedIn, endOfStayPaid, isoPlus(start), balancePaid, `GO-${stayNumber}`).lastInsertRowid);
  for (let i = start; i < end; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)")
      .run(id, isoPlus(i));
  }
  return id;
}

/** An option of the catalogue on both lodgings, with a per-lodging price where one is given. */
function addOption({ id, title, priceType = 'per_stay', price = 10, category = 'Boissons', prices = {}, ...over }) {
  db.prepare(`INSERT INTO options (id, title, priceType, price, category, autoOptionType, showsPlanningCard, breakfastTime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, title, priceType, price, category, over.autoOptionType || null, over.showsPlanningCard || 0, over.breakfastTime || '09:00');
  [1, 2].forEach((propertyId) => db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(propertyId, id));
  Object.entries(prices).forEach(([propertyId, value]) => {
    db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (?, ?, ?, 0)').run(Number(propertyId), id, value);
  });
  return id;
}

/** The nordic bath: 1 h slots 08:00-22:00, 30 €/h, linked to both lodgings; `freeMinutes` per lodging. */
function addBath({ id = 6, price = 30, freeMinutes = {} } = {}) {
  db.prepare(`INSERT INTO resources (id, name, priceType, price, quantity, openTime, closeTime, slotDuration, minimumUsageMinutes)
    VALUES (?, 'Bain nordique', 'per_hour', ?, 1, '08:00', '22:00', 60, 60)`).run(id, price);
  [1, 2].forEach((propertyId) => db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (?, ?)').run(id, propertyId));
  Object.entries(freeMinutes).forEach(([propertyId, minutes]) => {
    db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (?, ?, ?, ?)').run(Number(propertyId), id, price, minutes);
  });
  return id;
}

/** The sell switch on, with the plugin fields given. */
function sell(kind, itemId, fields = {}) {
  const row = { maxQuantity: 10, needsStaff: 0, leadMinutes: 30, ...fields };
  db.prepare(`INSERT OR REPLACE INTO guest_app_items (kind, itemId, sold, maxQuantity, needsStaff, leadMinutes) VALUES (?, ?, 1, ?, ?, ?)`)
    .run(kind, itemId, row.maxQuantity, row.needsStaff, row.leadMinutes);
}

/** A fake card provider: nothing leaves the machine; `pay(linkId)` makes the next read report it paid. */
function fakeProvider() {
  const paid = new Map();
  const created = [];
  let n = 0;
  return {
    created,
    pay: (providerLinkId, at = new Date().toISOString()) => paid.set(providerLinkId, at),
    provider: {
      id: 'qonto',
      label: 'Qonto',
      errorCode: 'QONTO_ERROR',
      isReady: () => true,
      createLink: async (args) => {
        n += 1;
        created.push(args);
        return { id: `pl_${n}`, url: `https://pay.example.test/${n}`, status: 'open' };
      },
      getPayment: async (providerLinkId) => (paid.has(providerLinkId)
        ? { paid: true, paymentId: `pay_${providerLinkId}`, paidAt: paid.get(providerLinkId) }
        : { paid: false, pending: false }),
      getLinkStatus: async () => 'open',
      cancelLink: async () => {},
    },
  };
}

/**
 * The plugins live around the guest app: `hourly-resources` (its price contributor and scheduler, when shipped),
 * a payment provider when `card` is given, and the guest app's own holds and paid basket, as its `register` declares.
 */
function livePlugins(api, { card = null } = {}) {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  if (createHourlyContributor) {
    const context = createContext('hourly-resources', {});
    const contributor = createHourlyContributor();
    context.priceLineContributor(contributor);
    context.articleFamily('hourly', createHourlyFamily(contributor));
    registry.ensure('hourly-resources').resourceScheduler = createScheduler(db);
  }
  if (card) registry.ensure('online-payment').paymentProvider = card.provider;
  const own = registry.ensure('guest-app');
  own.resourceHolds = api.heldSessions;
  own.paymentBaskets.push({ source: ORDER_SOURCE, paid: api.orderPaid, labels: ORDER_REFUND_LABELS });
  own.handlers.set('extraSale.sold', [api.orderSold]);
  return () => registry.reset();
}

/** The guest app's routes on the app's database, its clock on now, and a stay session on `reservationId`. */
async function openOrdering(reservationId, { propertyId = 1, card = null, ...options } = {}) {
  const pushes = [];
  const ctx = await startApi(db, {
    commit: require('../../../utils/extraSale'),
    push: () => ({ sendToPref: async (key, payload) => { pushes.push({ key, payload }); return { sent: 1 }; } }),
    ...options,
  });
  ctx.clock.now = new Date();
  const teardown = livePlugins(ctx.api, { card });
  require('../models/lodgingsModel')(db).save(propertyId, { enabled: true });
  const token = require('../models/stayLinksModel')(db).ensure(reservationId, new Date()).token;
  const opened = await ctx.call('POST', '/public/v1/guest/sessions', { stayToken: token });
  const cookie = opened.setCookie.split(';')[0];
  const call = (method, url, body) => ctx.call(method, url, body, { cookie });
  return {
    ...ctx, call, pushes, close: async () => { await ctx.close(); teardown(); },
  };
}

const optionLine = (reservationId, optionId) => db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(reservationId, optionId);
const endOfStayDetail = (reservationId) => JSON.parse(db.prepare('SELECT endOfStayComplementDetail FROM reservations WHERE id = ?').get(reservationId).endOfStayComplementDetail || '[]');
const notesOf = (reservationId) => JSON.parse(db.prepare('SELECT midStaySettledNotes FROM reservations WHERE id = ?').get(reservationId).midStaySettledNotes || '[]');
const historyOf = (reservationId) => db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id').all(reservationId)
  .flatMap((row) => JSON.parse(row.changedFields || '[]'));

module.exports = {
  addBath, addOption, db, endOfStayDetail, fakeProvider, historyOf, isoPlus, livePlugins, notesOf, openOrdering, optionLine, seedStay, sell,
  hasHourly: Boolean(createScheduler),
};
