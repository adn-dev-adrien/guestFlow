// Shared fixture of the outside-visit suites (specs/outside-booking-sas.md §7): the core database in memory with the plugin's tables, one « Bain fictif »
// (10:00-22:00, slot 30 min, minimum 60 min, external 50 €/h, 70 €/h from 19:00, one per booking), two drinks sellable outside a stay and one article that needs a stay,
// the visit model and its controller bound to a clock standing on the session's day. A walk-in 10:00-11:00 costs 50 €, one 18:00-20:00 120 € (50 + 70).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const db = require('../../../database');
const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const plugin = require('..');
const {
  createTables, bookingsV2, bookingsV3, bookingsV4, bookingsV5, bookingsV6,
} = require('../migrations');
const bookingsModel = require('../bookingsModel');
const { createVisitModel } = require('../visitModel');
const { createVisitController } = require('../visitController');
const { createInvoicing } = require('../invoicing');
const sales = require('../../../models/standaloneSalesModel');
const { FAR_YEAR } = require('../../../tests/farYearFixture');

const DAY = `${FAR_YEAR}-02-13`;
const NEXT_DAY = `${FAR_YEAR}-02-14`;

createTables(db);
bookingsV2(db);
bookingsV3(db, () => 20);
bookingsV4(db);
bookingsV5(db);
bookingsV6(db);
registry.reset();
registry.configure({ isActive: () => true, allows: () => true });
plugin.register(createContext(plugin.id, { db }));

const newResource = () => Number(db.prepare(`INSERT INTO resources (name, quantity, price, priceType, turnoverMinutes, minimumUsageMinutes, slotDuration, isComplex, openTime, closeTime,
  showsPlanningCard, hourlyEveningStart, hourlyEveningRate, hourlyExternalDayRate, hourlyExternalEveningRate)
  VALUES ('Bain fictif', 1, 25, 'per_hour', 0, 60, 30, 1, '10:00', '22:00', 1, '19:00', 35, 50, 70)`).run().lastInsertRowid);
const resourceId = newResource();
const option = (title, price, extra = {}) => Number(db.prepare('INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, ?, ?, ?)')
  .run(title, price, extra.priceType || 'per_stay', extra.sellable === false ? 0 : 1, extra.vatClass || 'drinks').lastInsertRowid);
const beer = option('Bière locale', 6.5);
const lemonade = option('Limonade', 4);
const breakfast = option('Petit-déjeuner', 12, { priceType: 'per_person_per_night', vatClass: 'catering' });
sales.setExternalRate('drinks', 20);
sales.setExternalRate('resources', 20);

let clock = new Date(`${DAY}T15:00:00Z`);
const now = () => clock;
const setNow = (iso) => { clock = new Date(iso); };

let issuer = null;
const setIssuer = (next) => { issuer = next; };

let visits = null;
const bookings = bookingsModel.create(db, { standaloneVatRate: () => 20, now, visits: () => visits });
visits = createVisitModel({ db, bookings: () => bookings, now });
const invoicing = createInvoicing({
  bookings: () => bookings, visits: () => visits, issuers: () => issuer, logger: { error() {}, warn() {} },
});
const controller = createVisitController({ bookings: () => bookings, visits: () => visits, invoicing: () => invoicing });

// A walk-in on DAY, each on a resource of its own (one slot per resource): 10:00-11:00 by default, one day hour = 50 €.
function book(extra = {}) {
  const out = bookings.createBooking({
    resourceId: extra.resourceId || newResource(), date: DAY, startTime: '10:00', endTime: '11:00', clientName: 'Client fictif', ...extra,
  });
  if (!out.ok) throw new Error(`book: ${out.error}`);
  return Number(out.id);
}
// The evening walk-in of the spec: 18:00-20:00 = 50 + 70 = 120 €.
const bookEvening = (extra = {}) => book({ startTime: '18:00', endTime: '20:00', ...extra });

const ADMIN = { id: 1, role: 'admin', roles: ['admin'] };
const RECEPTION = { id: 2, role: 'reception', roles: ['reception'] };

// Calls one handler of the visit controller as the given user: `{ code, body }`.
async function call(handler, { id, lineId, linkId, body = {}, query = {}, user = ADMIN }) {
  const res = {
    code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; },
  };
  await controller[handler]({
    params: { id: String(id), lineId: lineId == null ? undefined : String(lineId), linkId: linkId == null ? undefined : String(linkId) }, body, query, user,
  }, res);
  return res;
}

const card = (amountCents) => [{ method: 'card', amountCents, internal: false }];
const cash = (amountCents, internal = false) => [{ method: 'cash', amountCents, internal }];
const extra = (articleId, quantity, more = {}) => ({ articleRef: `option:${articleId}`, quantity, ...more });
const row = (id) => bookings.rawById(id);

module.exports = {
  db, bookings, visits, invoicing, controller, call, book, bookEvening, row, card, cash, extra, beer, lemonade, breakfast, resourceId, DAY, NEXT_DAY, setNow, setIssuer, ADMIN, RECEPTION, sales,
};
