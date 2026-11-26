// specs/gift-vouchers/gift-voucher-campaigns.md rule 51 (§3.O) — how far ahead the public may book is a setting, never a constant:
// the lodging's `bookingHorizonMonths` (12 by default, 1-36) replaces the 730 days of the public API; a resource
// carries its own (3 by default, 1-24). The limit is « today + N months » computed here; the back-office is never bounded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const {
  addMonthsIso, horizonUntil, lodgingMonths, lodgingHorizonUntil, refusalSentence,
} = require('../utils/bookingHorizon');
const { validateBookingHorizonMonths } = require('../utils/settingsValidation');
const { shapeResponse } = require('../utils/settingsResponse');
const resourcesController = require('../controllers/resourcesController');
const settingsModel = require('../models/settingsModel');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const website = optionalPlugin(() => ({
  ...require('../plugins/website-booking/publicInputValidation'),
  ...require('../plugins/website-booking/nextAvailability'),
  ...require('../plugins/website-booking/publicProjections'),
}));
const NEEDS_WEBSITE = { skip: skipWithout(['website-booking']) };

// The suite's today is 2026-11-18: the date window and every « today + N months » read this pinned clock.
test.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-18T12:00:00').getTime() });

const NOON = (iso) => new Date(`${iso}T12:00:00`);
const settingsDb = (months) => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE app_settings (id INTEGER PRIMARY KEY, bookingHorizonMonths INTEGER NOT NULL DEFAULT 12)');
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  if (months !== undefined) db.prepare('UPDATE app_settings SET bookingHorizonMonths = ?').run(months);
  return db;
};

test('« today + N months » clamps to the last day of a shorter month', () => {
  assert.equal(addMonthsIso('2026-11-18', 12), '2027-11-18');
  assert.equal(addMonthsIso('2026-08-31', 6), '2027-02-28');
  assert.equal(addMonthsIso('2027-08-31', 6), '2028-02-29');
  assert.equal(addMonthsIso('2026-11-30', 3), '2027-02-28');
  assert.equal(addMonthsIso('2026-12-15', 1), '2027-01-15');
});

test('the horizon counts from the server\'s day: late evening in Paris is still that day', () => {
  assert.equal(horizonUntil(12, new Date('2026-11-18T23:30:00')), '2027-11-18');
  assert.equal(horizonUntil(3, NOON('2026-11-18')), '2027-02-18');
});

test('the lodging\'s setting reads 12 months by default, the stored value otherwise, 12 when unreadable', () => {
  assert.equal(lodgingMonths(settingsDb()), 12);
  assert.equal(lodgingMonths(settingsDb(6)), 6);
  assert.equal(lodgingMonths(settingsDb(0)), 12);
  assert.equal(lodgingMonths(new Database(':memory:')), 12, 'no table: the default');
  assert.equal(lodgingHorizonUntil(NOON('2026-11-18'), settingsDb(24)), '2028-11-18');
  assert.equal(lodgingHorizonUntil(NOON('2026-11-18'), settingsDb()), '2027-11-18');
});

test('the refusal sentence is « Réservable jusqu\'au <date en français> », in the visitor\'s language', () => {
  assert.equal(refusalSentence('2027-11-18'), 'Réservable jusqu\'au 18 novembre 2027');
  assert.equal(refusalSentence('2027-01-01'), 'Réservable jusqu\'au 1er janvier 2027');
  assert.equal(refusalSentence('2027-11-18', 'en'), 'Bookable until 18 November 2027');
});

test('the setting: default 12 in the settings answer, whole months from 1 to 36, a refusal sentence otherwise', () => {
  assert.equal(shapeResponse({}).booking.horizonMonths, 12);
  assert.equal(shapeResponse({ bookingHorizonMonths: 24 }).booking.horizonMonths, 24);
  assert.equal(settingsModel.COLUMNS.includes('bookingHorizonMonths'), true);
  ['', null, undefined, 1, 12, '36', 36].forEach((ok) => assert.equal(validateBookingHorizonMonths(ok), null, String(ok)));
  [0, 37, 1.5, -2, 'abc', true, {}, []].forEach((bad) => assert.equal(validateBookingHorizonMonths(bad), 'Doit être un nombre entier de mois entre 1 et 36.', JSON.stringify(bad)));
});

test('the resource form refuses a horizon outside 1-24 months on its own field, and keeps one it already stores', () => {
  let stored = null;
  const model = { insert: () => 1, update: () => {}, findById: () => stored };
  const controller = resourcesController.buildController(model, { isOffered: () => true, properties: () => [] });
  const base = { name: 'Bain', priceType: 'per_stay', price: 10, quantity: 1 };
  const answer = (extra, current = null) => {
    stored = current;
    let out;
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { out = { status: this.statusCode, body: b }; return this; } };
    if (current) controller.update({ query: {}, params: { id: 1 }, body: { ...base, ...extra } }, res);
    else controller.create({ query: {}, params: {}, body: { ...base, ...extra } }, res);
    return out;
  };
  [{}, { bookingHorizonMonths: 3 }, { bookingHorizonMonths: '24' }].forEach((ok) => assert.equal(answer(ok).status, 200));
  [0, 25, 1.5, 'abc'].forEach((bad) => {
    const refused = answer({ bookingHorizonMonths: bad });
    assert.equal(refused.status, 422, String(bad));
    assert.deepEqual(refused.body.details, [{ field: 'bookingHorizonMonths', message: 'Nombre entier de mois entre 1 et 24' }]);
  });
  assert.equal(answer({ bookingHorizonMonths: 30 }, { ...base, bookingHorizonMonths: 30 }).status, 200, 'a value already stored is not judged again');
});

test('a resource stores 3 months by default and the column exists in the schema and the migration', () => {
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  const column = db.prepare('PRAGMA table_info(resources)').all().find((c) => c.name === 'bookingHorizonMonths');
  assert.deepEqual([column.type, column.notnull, column.dflt_value], ['INTEGER', 1, '3']);
  db.prepare("INSERT INTO resources (name, priceType, price, quantity) VALUES ('Bain', 'per_hour', 30, 1)").run();
  const model = require('../models/resourcesModel').create(db);
  assert.equal(model.findById(1).bookingHorizonMonths, 3);
  const id = model.insert({ name: 'Sauna', priceType: 'per_hour', price: 10, quantity: 1, bookingHorizonMonths: 6 });
  assert.equal(model.findById(id).bookingHorizonMonths, 6);
  model.update(id, { name: 'Sauna', priceType: 'per_hour', price: 10, quantity: 1 });
  assert.equal(model.findById(id).bookingHorizonMonths, 6, 'a save that does not send it keeps the stored value');
  model.update(id, { name: 'Sauna', priceType: 'per_hour', price: 10, quantity: 1, bookingHorizonMonths: 12 });
  assert.equal(model.findById(id).bookingHorizonMonths, 12);
});

const TODAY = '2026-11-18';
const HORIZON = '2027-11-18';
const stay = (startDate, endDate) => ({ propertyId: 1, startDate, endDate, adults: 2 });

test('a public stay ending on the horizon is accepted, one day past it is refused with the sentence and the date', NEEDS_WEBSITE, () => {
  const { validateStayInput, withHorizonMessages } = website;
  const day = { todayIso: TODAY, horizonUntil: HORIZON };
  assert.equal(validateStayInput(stay('2027-11-11', HORIZON), day).ok, true);
  const refused = validateStayInput(stay('2027-11-12', '2027-11-19'), day);
  assert.equal(refused.ok, false);
  assert.deepEqual(withHorizonMessages(refused.errors, 'fr'), [{
    field: 'endDate', issue: 'must be within the booking horizon', reason: 'beyondHorizon', horizonUntil: HORIZON, message: 'Réservable jusqu\'au 18 novembre 2027',
  }]);
  assert.equal(withHorizonMessages(refused.errors, 'en')[0].message, 'Bookable until 18 November 2027');
  // The 730 days it replaces are no longer a limit of their own: the setting alone decides.
  assert.equal(validateStayInput(stay('2028-11-01', '2028-11-08'), { todayIso: TODAY, horizonUntil: '2029-11-18' }).ok, true);
});

test('the availability window never reaches past the horizon and says until when; one opening past it is refused', NEEDS_WEBSITE, () => {
  const { validateAvailabilityQuery, toPublicAvailability } = website;
  const day = { todayIso: TODAY, horizonUntil: HORIZON };
  assert.deepEqual(validateAvailabilityQuery(day).value, { from: TODAY, to: HORIZON });
  assert.equal(validateAvailabilityQuery({ ...day, from: '2027-10-01', to: '2030-01-01' }).value.to, HORIZON);
  assert.equal(validateAvailabilityQuery({ ...day, from: HORIZON }).ok, false);
  assert.equal(toPublicAvailability({ propertyId: 1, from: TODAY, to: HORIZON, horizonUntil: HORIZON, blockedDates: [] }).horizonUntil, HORIZON);
});

test('the next-availability search stops at the horizon, and no stay may end after it', NEEDS_WEBSITE, () => {
  const { findNextAvailableDate } = website;
  const search = (horizonUntil, isStayAllowed) => findNextAvailableDate({
    from: TODAY, to: '2026-12-18', todayIso: TODAY, horizonUntil, isStayAllowed, blockedDates: [], loadBlocked: () => [],
  });
  const blockedUntilHorizon = (horizonUntil) => findNextAvailableDate({
    from: TODAY, to: '2026-11-20', todayIso: TODAY, horizonUntil, blockedDates: ['2026-11-18', '2026-11-19'],
    loadBlocked: () => ['2026-11-20', '2026-11-21'],
  });
  assert.equal(search(HORIZON), TODAY);
  assert.equal(blockedUntilHorizon('2026-11-22'), null, 'the first free night, the 22nd, lies on the horizon');
  assert.equal(blockedUntilHorizon('2026-11-23'), '2026-11-22');
  assert.equal(search('2026-11-20', (start, end) => end > start && (new Date(end) - new Date(start)) / 86400000 >= 3), null, 'a 3-night minimum cannot end by the 20th');
});

test('the back-office is never bounded: only the public API and the slots of the public side read a horizon', () => {
  const readers = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['tests', 'node_modules', 'sdk'].includes(entry.name)) walk(file); return; }
    if (entry.name.endsWith('.js') && /bookingHorizon\b|lodgingHorizonUntil/.test(fs.readFileSync(file, 'utf8'))) readers.push(path.relative(path.join(__dirname, '..'), file));
  });
  walk(path.join(__dirname, '..'));
  const publicSide = (file) => file === 'utils/bookingHorizon.js' || file.startsWith('plugins/website-booking/') || /^plugins\/hourly-[a-z]+\/horizon\.js$/.test(file);
  assert.deepEqual(readers.filter((file) => !publicSide(file)), []);
  assert.equal(readers.some((file) => file.startsWith('routes/') || file.startsWith('controllers/reservations')), false);
});
