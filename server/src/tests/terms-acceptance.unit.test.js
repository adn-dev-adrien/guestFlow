// specs/terms-acceptance-record.md §3.3-§3.5 — the public booking request and the CGV: refused without
// acceptance (422), with an outdated version (409), while nothing is published (503); the emergency
// switch; the acceptance written with the server clock and the relayed visitor, in the same
// transaction as the devis.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

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

// A transaction mock that behaves like better-sqlite3: a throw undoes what ran inside it.
function buildController({ require: requireTerms = true, current = { id: 3, version: 2 }, devisError = null, captures }) {
  captures.writes = [];
  const dbMock = {
    transaction: (fn) => (...args) => {
      const before = captures.writes.length;
      try { return fn(...args); } catch (e) { captures.writes.length = before; throw e; }
    },
    prepare(sql) {
      const s = String(sql || '');
      return {
        get: () => (/FROM properties/i.test(s) ? { maxGuests: 10, maxBabies: 2 } : undefined),
        run: () => { captures.writes.push('update-origin'); return { changes: 1 }; },
      };
    },
  };
  const controllerModule = '../controllers/public/publicBookingRequestController';
  return withMocks({
    '../../database': dbMock,
    '../../models/clientsModel': {
      findByEmail: () => undefined,
      insert: () => { captures.writes.push('client'); return { id: 7 }; },
    },
    '../../models/devisModel': {
      create: () => {
        if (devisError) return { error: devisError, status: 400 };
        captures.writes.push('devis');
        return { ok: true, data: { id: 99, devisNumber: 'D-1', finalPrice: 300 } };
      },
    },
    '../../models/settingsModel': {
      termsSettings: () => ({ requireTermsAcceptance: requireTerms }),
      upsert: (p) => { captures.settingsUpsert = p; },
    },
    '../../models/termsModel': {
      getCurrent: () => current,
      insertAcceptance: (row) => { captures.writes.push('acceptance'); captures.acceptance = row; },
    },
    '../../utils/notificationService': { notifyNewSiteDevis: () => {} },
    './publicCatalogController': { computeBlockedDates: () => [], rangeHasBlockedNight: () => false },
    './publicQuoteController': {
      buildEngineQuote: () => ({ error: null, minNightsBreached: false, finalPrice: 300 }),
      checkOptionApplicability: () => null,
      checkResourceApplicability: () => null,
    },
  }, () => {
    delete require.cache[require.resolve(controllerModule)];
    return require(controllerModule);
  });
}

function body(over = {}) {
  return {
    propertyId: 1, startDate: '2026-10-12', endDate: '2026-10-15',
    adults: 2, children: 0, teens: 0, babies: 0, options: [],
    guest: { firstName: 'Camille', lastName: 'Martin', email: 'camille@example.com', phone: '+33612345678' },
    ...over,
  };
}

const VISITOR = { ip: '86.242.17.203', userAgent: 'Mozilla/5.0 (iPhone)', pluginVersion: '1.8.0' };

test('rule 15 — no termsVersion → 422 TERMS_NOT_ACCEPTED, nothing written', () => {
  const captures = {};
  const res = fakeRes();
  buildController({ captures }).create({ body: body(), visitor: VISITOR }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.error.code, 'TERMS_NOT_ACCEPTED');
  assert.deepEqual(captures.writes, []);
});

test('rule 13 — an outdated version → 409 TERMS_OUTDATED naming the current one, nothing written', () => {
  const captures = {};
  const res = fakeRes();
  buildController({ captures }).create({ body: body({ termsVersion: 1 }), visitor: VISITOR }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error.code, 'TERMS_OUTDATED');
  assert.equal(res.body.error.details[0].currentVersion, 2);
  assert.deepEqual(captures.writes, []);
});

test('rule 16 — no published version → 503 TERMS_NOT_CONFIGURED, nothing written', () => {
  const captures = {};
  const res = fakeRes();
  buildController({ captures, current: null }).create({ body: body({ termsVersion: 1 }), visitor: VISITOR }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'TERMS_NOT_CONFIGURED');
  assert.deepEqual(captures.writes, []);
});

test('rules 1, 18 — current version accepted → 201, acceptance with server clock + relayed visitor', () => {
  const captures = {};
  const res = fakeRes();
  const before = Date.now();
  buildController({ captures }).create({ body: body({ termsVersion: 2 }), visitor: VISITOR }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(captures.writes, ['client', 'devis', 'update-origin', 'acceptance']);
  const a = captures.acceptance;
  assert.equal(a.reservationId, 99);
  assert.equal(a.termsVersionId, 3);
  assert.equal(a.version, 2);
  assert.equal(a.ip, VISITOR.ip);
  assert.equal(a.userAgent, VISITOR.userAgent);
  assert.equal(a.pluginVersion, '1.8.0');
  const at = Date.parse(a.acceptedAt);
  assert.ok(at >= before && at <= Date.now(), 'server clock, never a client-supplied time');
  assert.deepEqual(captures.settingsUpsert, { lastSeenPluginVersion: '1.8.0' });
});

test('rule 12 — a client-supplied acceptedAt or termsAcceptance never reaches the record', () => {
  const captures = {};
  const res = fakeRes();
  buildController({ captures }).create({
    body: body({ termsVersion: 2, acceptedAt: '2020-01-01T00:00:00Z', termsAcceptance: { ip: '1.1.1.1' } }),
    visitor: VISITOR,
  }, res);
  assert.equal(res.statusCode, 201);
  assert.notEqual(captures.acceptance.acceptedAt, '2020-01-01T00:00:00Z');
  assert.equal(captures.acceptance.ip, VISITOR.ip);
});

test('rule 17 — emergency switch off: a request without acceptance is created, without a record', () => {
  const captures = {};
  const res = fakeRes();
  buildController({ captures, require: false }).create({ body: body(), visitor: {} }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(captures.writes, ['client', 'devis', 'update-origin']);
  assert.equal(captures.settingsUpsert, undefined, 'no plugin version relayed → nothing stored');
});

test('rule 17 — switch off still records an acceptance that is sent', () => {
  const captures = {};
  const res = fakeRes();
  buildController({ captures, require: false }).create({ body: body({ termsVersion: 2 }), visitor: VISITOR }, res);
  assert.equal(res.statusCode, 201);
  assert.ok(captures.acceptance);
});

test('edge case — devis creation fails → the client insert is rolled back, no acceptance', () => {
  const captures = {};
  const res = fakeRes();
  buildController({ captures, devisError: 'Tarif introuvable.' }).create({ body: body({ termsVersion: 2 }), visitor: VISITOR }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'BOOKING_REQUEST_FAILED');
  assert.deepEqual(captures.writes, []);
});

test('edge case — honeypot: fake success, nothing checked nor written', () => {
  const captures = {};
  const res = fakeRes();
  buildController({ captures, current: null }).create({ body: body({ _hp: 'bot' }), visitor: VISITOR }, res);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(captures.writes, []);
});
