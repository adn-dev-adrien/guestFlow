const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

// Security coverage for the PUBLIC booking-request controller (specs/public-api.md). The pure
// security logic (API key, anti-leak projections, input validation) is unit-tested elsewhere; this
// pins the CONTROLLER orchestration that previously had only manual (curl) coverage:
//   - honeypot → respond like success but PERSIST NOTHING (anti-spam);
//   - a request creates a DRAFT DEVIS (never a confirmed reservation), flagged requestOrigin='public';
//   - price-override / non-whitelisted fields from the body NEVER reach the persisted record;
//   - server-side re-checks reject blocked dates / min-nights / over-capacity / unknown property.
//
// Real modules used: publicInputValidation (the validation IS the security boundary) + publicHttp.
// Mocked: the DB, the catalog/quote helpers (availability + engine), and the persistence models —
// so we assert exactly what the controller decides to write.

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

function buildController({
  property = { maxAdults: 10, maxChildren: 5, maxBabies: 2 },
  blockedNight = false,
  engineQuote = { error: null, minNightsBreached: false, requiredMinNights: 1, finalPrice: 300 },
  optError = null,
  clientFound = false,
  captures,
} = {}) {
  const dbMock = {
    prepare(sql) {
      const s = String(sql || '');
      return {
        get() {
          if (/FROM properties/i.test(s)) return property; // null → 404
          return undefined;
        },
        run(...args) {
          if (/UPDATE reservations SET requestOrigin/i.test(s)) captures.requestOriginUpdateId = args[0];
          return { changes: 1 };
        },
      };
    },
  };
  const clientsModelMock = {
    findByEmail: () => (clientFound ? { id: 7, firstName: 'Jean', lastName: 'Dupont' } : undefined),
    insert: (payload) => { captures.clientInsert = payload; return { id: 7 }; },
  };
  const devisModelMock = {
    create: (payload) => { captures.devisCreate = payload; return { ok: true, status: 201, data: { id: 99, devisNumber: '2026-06-00042', finalPrice: 300 } }; },
  };
  const catalogMock = {
    computeBlockedDates: () => (blockedNight ? ['BLOCKED'] : []),
    rangeHasBlockedNight: () => blockedNight,
  };
  const quoteMock = {
    buildEngineQuote: () => engineQuote,
    checkOptionApplicability: () => optError,
  };

  const controllerModule = '../controllers/public/publicBookingRequestController';
  return withMocks({
    '../../database': dbMock,
    '../../models/clientsModel': clientsModelMock,
    '../../models/devisModel': devisModelMock,
    './publicCatalogController': catalogMock,
    './publicQuoteController': quoteMock,
    // publicInputValidation + publicHttp load for real (the security validation + the envelope).
  }, () => {
    delete require.cache[require.resolve(controllerModule)];
    return require(controllerModule);
  });
}

function validBody(over = {}) {
  return {
    propertyId: 1,
    startDate: '2026-09-10', endDate: '2026-09-17',
    adults: 2, children: 0, teens: 0, babies: 0,
    options: [],
    guest: { firstName: 'Marie', lastName: 'Durand', email: 'marie@example.com', phone: '+33612345678' },
    message: 'Bonjour',
    ...over,
  };
}

test('honeypot filled → 201 fake success, NOTHING persisted', () => {
  const captures = {};
  const controller = buildController({ captures });
  const res = fakeRes();
  controller.create({ body: validBody({ _hp: 'i-am-a-bot' }) }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { data: { status: 'pending' } });
  assert.equal(captures.devisCreate, undefined, 'no devis created');
  assert.equal(captures.clientInsert, undefined, 'no client created');
});

test('valid request → creates a DRAFT DEVIS (platform direct), marks requestOrigin=public, never a reservation', () => {
  const captures = {};
  const controller = buildController({ captures });
  const res = fakeRes();
  controller.create({ body: validBody() }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.status, 'pending');
  assert.equal(res.body.data.reference, '2026-06-00042');
  // The ONLY persistence path is devisModel.create — there is no reservation-create call in scope.
  assert.ok(captures.devisCreate, 'devis created');
  assert.equal(captures.devisCreate.platform, 'direct', 'forced to direct');
  assert.equal(captures.devisCreate.clientId, 7);
  // requestOrigin marked on the freshly-created devis row.
  assert.equal(captures.requestOriginUpdateId, 99);
});

test('price-override / non-whitelisted fields from the body never reach the persisted devis', () => {
  const captures = {};
  const controller = buildController({ captures });
  const res = fakeRes();
  controller.create({ body: validBody({
    customPrice: 1, discountPercent: 90, depositPaid: true, offeredOptionIds: [1], platform: 'airbnb',
  }) }, res);
  assert.equal(res.statusCode, 201);
  const sent = captures.devisCreate;
  assert.equal('customPrice' in sent, false, 'customPrice dropped');
  assert.equal('discountPercent' in sent, false, 'discountPercent dropped');
  assert.equal('depositPaid' in sent, false);
  assert.equal('offeredOptionIds' in sent, false);
  assert.equal(sent.platform, 'direct', 'platform forced to direct, body value ignored');
});

test('blocked dates → 409 DATES_UNAVAILABLE, nothing persisted', () => {
  const captures = {};
  const controller = buildController({ blockedNight: true, captures });
  const res = fakeRes();
  controller.create({ body: validBody() }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'DATES_UNAVAILABLE');
  assert.equal(captures.devisCreate, undefined);
});

test('min-nights breached → 409 MIN_NIGHTS, nothing persisted', () => {
  const captures = {};
  const controller = buildController({ engineQuote: { error: null, minNightsBreached: true, requiredMinNights: 3 }, captures });
  const res = fakeRes();
  controller.create({ body: validBody() }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'MIN_NIGHTS');
  assert.equal(captures.devisCreate, undefined);
});

test('over capacity → 409 OVER_CAPACITY, nothing persisted', () => {
  const captures = {};
  const controller = buildController({ property: { maxAdults: 1, maxChildren: 0, maxBabies: 0 }, captures });
  const res = fakeRes();
  controller.create({ body: validBody({ adults: 5 }) }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'OVER_CAPACITY');
  assert.equal(captures.devisCreate, undefined);
});

test('unknown property → 404 PROPERTY_NOT_FOUND', () => {
  const captures = {};
  const controller = buildController({ property: null, captures });
  const res = fakeRes();
  controller.create({ body: validBody() }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, 'PROPERTY_NOT_FOUND');
  assert.equal(captures.devisCreate, undefined);
});

test('invalid guest (bad email / missing fields) → 422 VALIDATION_FAILED, nothing persisted', () => {
  const captures = {};
  const controller = buildController({ captures });
  const res = fakeRes();
  controller.create({ body: validBody({ guest: { firstName: 'X', email: 'not-an-email' } }) }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  assert.equal(captures.devisCreate, undefined);
});

test('existing client by email is reused, not duplicated', () => {
  const captures = {};
  const controller = buildController({ clientFound: true, captures });
  const res = fakeRes();
  controller.create({ body: validBody() }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(captures.clientInsert, undefined, 'no new client inserted');
  assert.equal(captures.devisCreate.clientId, 7, 'reused existing client');
});
