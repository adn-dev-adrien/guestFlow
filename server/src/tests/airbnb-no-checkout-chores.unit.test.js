// specs/airbnb-no-checkout-chores.md — Airbnb forbids checkout chores and any request made at arrival:
// the SAS read must never tell the operator to remind an Airbnb guest of the dishes and the trash.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { isAirbnbChannel } = require('../utils/platformNameFormat');

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function readSas({ platform, sold }) {
  const reservation = { id: 1, propertyId: 1, platform, startDate: '2026-12-01', endDate: '2026-12-03', options: [], resources: [], nights: [] };
  const reservationsModelMock = new Proxy({}, { get: (_, k) => {
    if (k === 'getByIdWithDetails') return () => reservation;
    if (k === 'getSasUpsellOptions') return () => ({
      cleaning: { present: sold, sasOrigin: false, optionId: 3, totalPrice: 80 },
      bathLinen: { present: false, sasOrigin: false, optionId: 9, totalPrice: 0 },
    });
    if (k === 'isCleaningSoldForReservation') return () => sold;
    if (k === 'getCleaningPriceForProperty') return () => 80;
    if (k === 'getBathLinenOfferForReservation') return () => ({ available: false, label: 'Linge de toilette' });
    if (k === 'buildArrivalComplementDetail') return () => ({ amount: 0, paid: 0, detail: [] });
    return () => null;
  } });
  const controller = withMocks({
    '../models/reservationsModel': reservationsModelMock,
    '../models/linenItemsModel': { list: () => [] },
    '../models/settingsModel': { read: () => ({ portalCode: '' }) },
    '../models/breakfastModel': { getForReservation: () => ({ applicable: false }) },
    '../models/repairAmountsModel': { list: () => [] },
    '../models/resourceSchedulingModel': { getSchedulingPayload: () => ({ applicable: false, resources: [] }) },
  }, () => {
    delete require.cache[require.resolve('../controllers/sasController')];
    return require('../controllers/sasController');
  });
  delete require.cache[require.resolve('../controllers/sasController')];
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.getSas({ params: { id: 1 }, query: {}, user: { roles: ['admin'] } }, res);
  return res.body;
}

// specs/airbnb-no-checkout-chores.md rule 1
test('Airbnb stay with the ménage included: no guest reminder', () => {
  const body = readSas({ platform: 'Airbnb', sold: true });
  assert.equal(body.cleaning.included, true);
  assert.equal(body.cleaning.guestReminder, false);
});

// specs/airbnb-no-checkout-chores.md rule 4
test('Booking stay with the ménage included: the reminder stays', () => {
  assert.equal(readSas({ platform: 'Booking', sold: true }).cleaning.guestReminder, true);
});

// specs/airbnb-no-checkout-chores.md rule 5
test('Airbnb stay without the ménage: no reminder (the ménage offer page is unchanged)', () => {
  const body = readSas({ platform: 'Airbnb', sold: false });
  assert.equal(body.cleaning.included, false);
  assert.equal(body.cleaning.guestReminder, false);
});

test('no recorded platform counts as direct: the reminder stays', () => {
  assert.equal(readSas({ platform: null, sold: true }).cleaning.guestReminder, true);
});

// specs/airbnb-no-checkout-chores.md rule 2
test('isAirbnbChannel ignores case and whitespace, and nothing else is Airbnb', () => {
  assert.equal(isAirbnbChannel('Airbnb'), true);
  assert.equal(isAirbnbChannel(' airbnb '), true);
  assert.equal(isAirbnbChannel('AIRBNB'), true);
  assert.equal(isAirbnbChannel('Booking'), false);
  assert.equal(isAirbnbChannel(null), false);
  assert.equal(isAirbnbChannel(''), false);
});
