const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { publicGuestCap, checkGuestCapacity } = require('../../../utils/capacity');
const { toPublicQuote, toPublicProperty, toPublicPropertyDetail } = require('../publicProjections');

// specs/site-extra-guest-line.md — the site shows the extra-guest supplement as its own line, and the
// public path never accepts an uncapped party.

// ── publicGuestCap (rule 6) ────────────────────────────────────────────────────────────────────────

test('publicGuestCap: a configured maxGuests wins', () => {
  assert.equal(publicGuestCap({ maxGuests: 15, basePriceIncludedGuests: 2 }), 15);
});

test('publicGuestCap: maxGuests 0 falls back to the included guests', () => {
  assert.equal(publicGuestCap({ maxGuests: 0, basePriceIncludedGuests: 4 }), 4);
});

test('publicGuestCap: nothing configured falls back to 2, never to "no cap"', () => {
  assert.equal(publicGuestCap({ maxGuests: 0, basePriceIncludedGuests: 0 }), 2);
  assert.equal(publicGuestCap({}), 2);
});

// specs/site-extra-guest-line.md rule 8 — the back-office keeps « maxGuests = 0 → guard off »: only the
// public path falls back to a cap.
test('specs/site-extra-guest-line.md rule 8: checkGuestCapacity still tolerates an unconfigured cap', () => {
  assert.equal(checkGuestCapacity({ maxGuests: 0, maxBabies: 0 }, { adults: 9 }), null);
});

// ── toPublicProperty (rule 7) ──────────────────────────────────────────────────────────────────────

test('toPublicProperty advertises the effective cap, never 0 (maxAdults alias included)', () => {
  const p = toPublicProperty({ id: 1, name: 'La Granja', maxGuests: 0, basePriceIncludedGuests: 2 });
  assert.equal(p.maxGuests, 2);
  assert.equal(p.maxAdults, 2);
  assert.equal(toPublicProperty({ id: 1, name: 'x', maxGuests: 15 }).maxGuests, 15);
});

test('toPublicPropertyDetail advertises the same effective cap', () => {
  assert.equal(toPublicPropertyDetail({ id: 1, name: 'x', maxGuests: 0, basePriceIncludedGuests: 4, pricingRules: [] }).maxGuests, 4);
});

// ── toPublicQuote extraGuests (rules 1-2) ──────────────────────────────────────────────────────────

function engineQuote(over = {}) {
  return {
    property: { id: 1 }, nights: 7, persons: 3, requiredMinNights: 1, minNightsBreached: false,
    nightlyBreakdown: [{ date: '2026-09-10', price: 100 }],
    totalPrice: 700, optionLines: [], optionsTotal: 0,
    touristTaxTotal: 0, touristTaxLabel: null, touristTaxCollectedOnArrival: false,
    finalPrice: 725, totalStayPrice: 725, depositAmount: 0, depositDueDate: null,
    balanceAmount: 725, balanceDueDate: null, complementAmount: 0, error: null,
    ...over,
  };
}

test('a billed supplement yields an extraGuests row and keeps extraGuestSurcharge', () => {
  const q = toPublicQuote(engineQuote({
    extraGuestSurcharge: 25, extraGuestSurchargeOriginal: 25, extraGuestSurchargeOffered: false, extraGuestCount: 1,
  }), { available: true });
  assert.deepEqual(q.extraGuests, { count: 1, total: 25, originalTotal: 25, offered: false });
  assert.equal(q.extraGuestSurcharge, 25);
});

test('an offered supplement is flagged and bills 0', () => {
  const q = toPublicQuote(engineQuote({
    extraGuestSurcharge: 0, extraGuestSurchargeOriginal: 25, extraGuestSurchargeOffered: true, extraGuestCount: 1,
  }), { available: true });
  assert.deepEqual(q.extraGuests, { count: 1, total: 0, originalTotal: 25, offered: true });
});

test('a tiered multi-guest supplement carries the full billed amount and the guest count', () => {
  const q = toPublicQuote(engineQuote({
    extraGuestSurcharge: 69, extraGuestSurchargeOriginal: 69, extraGuestSurchargeOffered: false, extraGuestCount: 3,
    extraGuestTiersLabel: '15,00 € la 1ʳᵉ nuit, puis 8,00 €/nuit',
  }), { available: true });
  assert.deepEqual(q.extraGuests, { count: 3, total: 69, originalTotal: 69, offered: false });
});

test('a sub-cent supplement is treated as none', () => {
  const q = toPublicQuote(engineQuote({ extraGuestSurcharge: 0.004, extraGuestSurchargeOriginal: 0.004, extraGuestCount: 1 }), { available: true });
  assert.equal(q.extraGuests, null);
});

test('no supplement → extraGuests is null', () => {
  const none = toPublicQuote(engineQuote({
    extraGuestSurcharge: 0, extraGuestSurchargeOriginal: 0, extraGuestCount: 0,
  }), { available: true });
  assert.equal(none.extraGuests, null);
  const absent = toPublicQuote(engineQuote({ extraGuestSurcharge: 0 }), { available: true });
  assert.equal(absent.extraGuests, null);
});

// ── booking request cap fallback (rule 6) ──────────────────────────────────────────────────────────

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

function buildController(property, captures) {
  const dbMock = {
    transaction: (fn) => (...args) => fn(...args),
    prepare(sql) {
      const s = String(sql || '');
      return {
        get() { return /FROM properties/i.test(s) ? property : undefined; },
        run() { return { changes: 1 }; },
      };
    },
  };
  const controllerModule = '../controllers/publicBookingRequestController';
  return withMocks({
    '../../database': dbMock,
    '../../models/clientsModel': { findByEmail: () => undefined, insert: () => ({ id: 7 }) },
    '../../models/devisModel': {
      create: (payload) => { captures.devisCreate = payload; return { ok: true, status: 201, data: { id: 99, devisNumber: '2026-06-00042', finalPrice: 300 } }; },
    },
    './publicCatalogController': { computeBlockedDates: () => [], rangeHasBlockedNight: () => false },
    './publicQuoteController': {
      buildEngineQuote: () => ({ error: null, minNightsBreached: false, requiredMinNights: 1, finalPrice: 300 }),
      checkOptionApplicability: () => null,
      checkResourceApplicability: () => null,
    },
    '../settings': { termsSettings: () => ({ requireTermsAcceptance: true }), recordPluginVersion: () => {} },
    '../../models/termsModel': { getCurrent: () => ({ id: 1, version: 1 }), insertAcceptance: () => {} },
  }, () => {
    delete require.cache[require.resolve(controllerModule)];
    return require(controllerModule);
  });
}

function body(over = {}) {
  return {
    propertyId: 1, startDate: '2026-09-10', endDate: '2026-09-17',
    adults: 2, children: 0, teens: 0, babies: 0, options: [],
    guest: { firstName: 'Marie', lastName: 'Durand', email: 'marie@example.com', phone: '+33612345678' },
    message: 'Bonjour', termsVersion: 1,
    ...over,
  };
}

test('maxGuests 0 no longer means uncapped on the public path: 5 guests on a 2-included property → 409', () => {
  const captures = {};
  const controller = buildController({ maxGuests: 0, maxBabies: 0, basePriceIncludedGuests: 2 }, captures);
  const res = fakeRes();
  controller.create({ body: body({ adults: 5 }) }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'OVER_CAPACITY');
  assert.equal(captures.devisCreate, undefined);
});

test('maxGuests 0: a party within the included guests still books', () => {
  const captures = {};
  const controller = buildController({ maxGuests: 0, maxBabies: 0, basePriceIncludedGuests: 2 }, captures);
  const res = fakeRes();
  controller.create({ body: body({ adults: 2 }) }, res);
  assert.notEqual(res.statusCode, 409);
  assert.ok(captures.devisCreate);
});

test('a configured maxGuests above the included guests lets extra guests book', () => {
  const captures = {};
  const controller = buildController({ maxGuests: 15, maxBabies: 0, basePriceIncludedGuests: 2 }, captures);
  const res = fakeRes();
  controller.create({ body: body({ adults: 6 }) }, res);
  assert.notEqual(res.statusCode, 409);
  assert.ok(captures.devisCreate);
});

test('children and teens count towards the cap; babies do not', () => {
  const property = { maxGuests: 4, maxBabies: 1, basePriceIncludedGuests: 2 };
  const refused = buildController(property, {});
  const r1 = fakeRes();
  refused.create({ body: body({ adults: 2, children: 2, teens: 1 }) }, r1);
  assert.equal(r1.statusCode, 409);

  const captures = {};
  const accepted = buildController(property, captures);
  const r2 = fakeRes();
  accepted.create({ body: body({ adults: 2, children: 1, teens: 1, babies: 1 }) }, r2); // exactly the cap
  assert.notEqual(r2.statusCode, 409);
  assert.ok(captures.devisCreate);
});

test('maxBabies is still enforced on the fallback cap', () => {
  const controller = buildController({ maxGuests: 0, maxBabies: 0, basePriceIncludedGuests: 2 }, {});
  const res = fakeRes();
  controller.create({ body: body({ adults: 2, babies: 1 }) }, res);
  assert.equal(res.statusCode, 409);
});
