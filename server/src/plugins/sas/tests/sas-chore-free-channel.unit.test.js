// specs/airbnb-no-checkout-chores.md — on a channel that forbids checkout chores (`platforms.forbidsGuestChores`,
// ticked here on Airbnb), the SAS read never tells the operator to remind the guest of the dishes and the
// trash, and never offers to bill an undone ménage at departure.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

require('../../sdk/registry').configure({ isActive: () => true, allows: () => true });
const { setChoreFreeChannels } = require('../../../utils/platformNameFormat');

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function readSas({ platform, sold, mode }) {
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
    '../../models/reservationsModel': reservationsModelMock,
    '../../models/linenItemsModel': { list: () => [] },
    '../../models/settingsModel': { read: () => ({ portalCode: '' }) },
    '../../models/breakfastModel': { getForReservation: () => ({ applicable: false }) },
    '../../models/repairAmountsModel': { list: () => [] },
  }, () => {
    delete require.cache[require.resolve('../controller')];
    return require('../controller');
  });
  delete require.cache[require.resolve('../controller')];
  // After the requires: the database boot re-reads the set from its own platforms.
  setChoreFreeChannels(['Airbnb']);
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.getSas({ params: { id: 1 }, query: mode ? { mode } : {}, user: { roles: ['admin'] } }, res);
  return res.body;
}

// specs/airbnb-no-checkout-chores.md rule 1
test('chore-free channel with the ménage included: no guest reminder', () => {
  const body = readSas({ platform: 'Airbnb', sold: true });
  assert.equal(body.cleaning.included, true);
  assert.equal(body.cleaning.guestReminder, false);
});

// specs/airbnb-no-checkout-chores.md rule 4
test('other channel with the ménage included: the reminder stays', () => {
  assert.equal(readSas({ platform: 'Booking', sold: true }).cleaning.guestReminder, true);
});

// specs/airbnb-no-checkout-chores.md rule 5
test('chore-free channel without the ménage: no reminder', () => {
  const body = readSas({ platform: 'Airbnb', sold: false });
  assert.equal(body.cleaning.included, false);
  assert.equal(body.cleaning.guestReminder, false);
});

// specs/airbnb-no-checkout-chores.md edge case — no platform counts as direct
test('no recorded platform counts as direct: the reminder stays', () => {
  assert.equal(readSas({ platform: null, sold: true }).cleaning.guestReminder, true);
});

// specs/airbnb-no-checkout-chores.md rule 7
test('departure read: the ménage is never billable on a chore-free channel', () => {
  assert.equal(readSas({ platform: 'Airbnb', sold: false, mode: 'departure' }).cleaning.billableAtDeparture, false);
  assert.equal(readSas({ platform: 'Booking', sold: false, mode: 'departure' }).cleaning.billableAtDeparture, true);
  assert.equal(readSas({ platform: 'Booking', sold: true, mode: 'departure' }).cleaning.billableAtDeparture, false, 'already sold');
});
