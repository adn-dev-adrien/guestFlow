const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// Security coverage for the PUBLIC quote controller (specs/public-api.md): a malicious proxy must
// NOT be able to manipulate the price. Real validation; the pricing engine is mocked only to capture
// exactly what input it receives.

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// Minimal engine output, enough for toPublicQuote to project without throwing.
function minimalQuote() {
  return {
    property: { id: 1 }, nights: 7, persons: 2, requiredMinNights: 1, minNightsBreached: false,
    nightlyBreakdown: [{ date: '2026-09-10', price: 100 }],
    totalPrice: 700, extraGuestSurcharge: 0, optionLines: [], optionsTotal: 0,
    touristTaxTotal: 0, touristTaxLabel: null, touristTaxCollectedOnArrival: false,
    finalPrice: 700, depositAmount: 0, depositDueDate: null, balanceAmount: 700, balanceDueDate: null,
    complementAmount: 0, error: null,
  };
}

function buildController({ captures, applicableOptionIds = [7], applicableResourceIds = [3] } = {}) {
  return withMocks({
    '../../database': {},
    '../../utils/pricing': { calculateReservationQuote: (input) => { captures.engineInput = input; return minimalQuote(); } },
    '../../models/optionsModel': { listForProperty: () => applicableOptionIds.map((id) => ({ id })) },
    '../../models/resourcesModel': { list: () => applicableResourceIds.map((id) => ({ id })) },
    './publicCatalogController': { computeBlockedDates: () => [], rangeHasBlockedNight: () => false },
  }, () => {
    const m = '../controllers/public/publicQuoteController';
    delete require.cache[require.resolve(m)];
    return require(m);
  });
}

test('quote forces platform=direct and drops every price-override field before the engine', () => {
  const captures = {};
  const controller = buildController({ captures });
  const res = fakeRes();
  controller.quote({ body: {
    propertyId: 1, startDate: '2026-09-10', endDate: '2026-09-17', adults: 2,
    options: [{ optionId: 7, quantity: 1 }],
    // hostile overrides — must never reach the engine:
    platform: 'airbnb', customPrice: 1, discountPercent: 90, depositAmount: 0, offeredOptionIds: [7],
    selectedOptions: [{ optionId: 7, quantity: 99, unitPrice: 0 }],
  } }, res);

  assert.equal(res.statusCode, 200);
  const sent = captures.engineInput;
  assert.equal(sent.platform, 'direct', 'platform hard-set to direct');
  assert.equal('customPrice' in sent, false);
  assert.equal('discountPercent' in sent, false);
  assert.equal('depositAmount' in sent, false);
  assert.equal('offeredOptionIds' in sent, false);
  // Options are re-mapped to {optionId, quantity} only — no smuggled unitPrice.
  assert.deepEqual(sent.selectedOptions, [{ optionId: 7, quantity: 1 }]);
});

test('quote rejects an option not applicable to the property (422)', () => {
  const captures = {};
  const controller = buildController({ captures, applicableOptionIds: [99] }); // 7 not applicable
  const res = fakeRes();
  controller.quote({ body: {
    propertyId: 1, startDate: '2026-09-10', endDate: '2026-09-17', adults: 2,
    options: [{ optionId: 7, quantity: 1 }],
  } }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  assert.equal(captures.engineInput, undefined, 'engine not called on invalid option');
});

test('quote passes selected resources to the engine as {resourceId, quantity} only (no smuggled price)', () => {
  const captures = {};
  const controller = buildController({ captures, applicableResourceIds: [3] });
  const res = fakeRes();
  controller.quote({ body: {
    propertyId: 1, startDate: '2026-09-10', endDate: '2026-09-17', adults: 2,
    resources: [{ resourceId: 3, quantity: 2, unitPrice: 0, price: 999, offered: true }],
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(captures.engineInput.selectedResources, [{ resourceId: 3, quantity: 2 }]);
});

test('quote rejects a resource not applicable to the property (422)', () => {
  const captures = {};
  const controller = buildController({ captures, applicableResourceIds: [99] }); // 3 not applicable
  const res = fakeRes();
  controller.quote({ body: {
    propertyId: 1, startDate: '2026-09-10', endDate: '2026-09-17', adults: 2,
    resources: [{ resourceId: 3, quantity: 1 }],
  } }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(captures.engineInput, undefined, 'engine not called on invalid resource');
});

test('quote returns the public projection with an availability flag', () => {
  const captures = {};
  const controller = buildController({ captures });
  const res = fakeRes();
  controller.quote({ body: { propertyId: 1, startDate: '2026-09-10', endDate: '2026-09-17', adults: 2 } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.available, true);
  assert.equal(res.body.data.finalPrice, 700);
  assert.equal(res.body.data.currency, 'EUR');
});
