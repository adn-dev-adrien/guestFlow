require('./isolatedDb');
// specs/public-online-payment.md rule 12 — the public quote says whether the site can take a payment
// now (`payment.onlineReady`), so a block set to « payer en ligne » sends a plain request while no
// provider is connected instead of creating a devis the payment then fails on. A field added to
// /public/v1, nothing removed: `payment.mode` is unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { localIsoDate } = require('../../../utils/localDate');

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

const fakeRes = () => ({
  statusCode: 200, body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

const ENGINE = {
  property: { id: 1 }, nights: 3, persons: 2, requiredMinNights: 1, minNightsBreached: false,
  nightlyBreakdown: [], totalPrice: 300, extraGuestSurcharge: 0, optionLines: [], optionsTotal: 0,
  touristTaxTotal: 0, touristTaxLabel: null, touristTaxCollectedOnArrival: false,
  finalPrice: 300, depositAmount: 0, depositDueDate: null, balanceAmount: 300, balanceDueDate: null,
  complementAmount: 0, error: null,
};

function controller(provider) {
  return withMocks({
    '../../database': {},
    '../../utils/pricing': { calculateReservationQuote: () => ENGINE },
    '../../models/optionsModel': { listForProperty: () => [], getCancellationInsurance: () => null },
    '../../models/resourcesModel': { list: () => [] },
    '../../models/propertyOptionDefaultsModel': { listForProperty: () => [] },
    '../../utils/paymentProviders': { active: () => provider },
    './publicCatalogController': { computeBlockedDates: () => [], rangeHasBlockedNight: () => false },
  }, () => {
    const m = '../controllers/publicQuoteController';
    delete require.cache[require.resolve(m)];
    return require(m);
  });
}

// Relative to the clock: the controller refuses a past arrival, so a literal date turns this red.
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };
const BODY = { propertyId: 1, startDate: inDays(30), endDate: inDays(33), adults: 2 };

test('rule 12: a connected provider → payment.onlineReady true, the mode untouched', async () => {
  const res = fakeRes();
  await controller({ id: 'qonto' }).quote({ body: BODY }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.payment, { mode: 'full', onlineReady: true });
});

test('rule 12: no provider ready → payment.onlineReady false', async () => {
  const res = fakeRes();
  await controller(null).quote({ body: BODY }, res);
  assert.deepEqual(res.body.data.payment, { mode: 'full', onlineReady: false });
});
