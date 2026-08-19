const test = require('node:test');
const assert = require('node:assert/strict');

const enforceRoleAccess = require('../middleware/enforceRoleAccess');

// specs/reception-role-checkin-only.md §3.6 rule 11 — pins the exact reachable set for the
// `reception` role, plus the combined-role edge cases.

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function call({ roles, method = 'GET', path }) {
  const req = { user: roles ? { roles } : null, method, path };
  const res = fakeRes();
  let nextCalled = false;
  enforceRoleAccess(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

const ALLOWED = [
  ['GET', '/reservations'],
  ['GET', '/reservations/42'],
  ['GET', '/reservations/42/sas'],
  ['GET', '/reservations/42/weather-alerts'],
  ['POST', '/reservations/42/sas/arrival'],
  ['POST', '/reservations/42/sas/departure'],
  ['PATCH', '/reservations/42/payment'],
  ['GET', '/properties'],
  ['GET', '/properties/platform-colors'],
  ['GET', '/planning/laundry'],
  ['GET', '/planning/linen-inventory'],
  ['GET', '/planning/breakfast'],
  ['GET', '/planning/option-cards'],
  ['GET', '/planning/resource-cards'],
  ['POST', '/planning/option-cards/done'],
  ['POST', '/planning/resource-cards/done'],
  ['GET', '/laundry/skips'],
  ['POST', '/laundry/skips'],
  ['DELETE', '/laundry/skips/2026-07-22'],
  ['GET', '/laundry/manual-additions'],
  ['PUT', '/laundry/manual-additions/2026-07-22'],
  // Extra laundry trips — READ only (specs/laundry-extra-trip.md §3.4 rule 16).
  ['GET', '/laundry/extra-trips'],
  ['GET', '/laundry/extra-trips/preview'],
  ['GET', '/resource-bookings/planning-events'],
  // Self endpoints — reachable by every role.
  ['GET', '/auth/me'],
  ['POST', '/auth/logout'],
  ['POST', '/auth/change-password'],
  ['GET', '/users/me'],
  ['GET', '/users/me/email-status'],
  ['GET', '/version'],
];

const FORBIDDEN = [
  ['GET', '/clients'],
  ['GET', '/clients/9'],
  ['GET', '/finance'],
  ['GET', '/finance/tourist-tax'],
  ['GET', '/accounting/sales.csv'],
  ['GET', '/settings'],
  ['PUT', '/settings'],
  ['GET', '/devis'],
  ['GET', '/emails'],
  // Reservation surface OUTSIDE the allowlist.
  ['GET', '/reservations/search'],
  ['GET', '/reservations/42/history'],
  ['POST', '/reservations'],
  ['PUT', '/reservations/42'],
  ['DELETE', '/reservations/42'],
  // Resource-booking CRUD (only planning-events is allowed).
  ['GET', '/resource-bookings'],
  ['GET', '/resource-bookings/7'],
  ['POST', '/resource-bookings'],
  // A financial write disguised on an allowed-looking sibling.
  ['DELETE', '/properties/1'],
  ['POST', '/properties'],
  // Extra laundry trips are admin-only to create / edit / delete (specs/laundry-extra-trip.md §3.4).
  ['PUT', '/laundry/extra-trips/2026-08-21'],
  ['DELETE', '/laundry/extra-trips/2026-08-21'],
];

test('reception: every allowlisted method+path passes', () => {
  for (const [method, path] of ALLOWED) {
    assert.equal(call({ roles: ['reception'], method, path }).nextCalled, true, `${method} ${path}`);
  }
});

test('reception: everything outside the allowlist → 403 FORBIDDEN_ROLE', () => {
  for (const [method, path] of FORBIDDEN) {
    const { res, nextCalled } = call({ roles: ['reception'], method, path });
    assert.equal(nextCalled, false, `${method} ${path} should be blocked`);
    assert.equal(res.statusCode, 403, `${method} ${path}`);
    assert.equal(res.body.error, 'FORBIDDEN_ROLE');
  }
});

test('reception: method matters — GET-only paths reject other verbs', () => {
  assert.equal(call({ roles: ['reception'], method: 'POST', path: '/reservations' }).nextCalled, false);
  assert.equal(call({ roles: ['reception'], method: 'DELETE', path: '/reservations/42' }).nextCalled, false);
  assert.equal(call({ roles: ['reception'], method: 'GET', path: '/reservations/42/sas/arrival' }).nextCalled, false);
});

test('reception + admin → admin wins (unrestricted)', () => {
  assert.equal(call({ roles: ['reception', 'admin'], method: 'DELETE', path: '/clients/9' }).nextCalled, true);
  assert.equal(call({ roles: ['reception', 'admin'], method: 'GET', path: '/finance' }).nextCalled, true);
});

test('reception + accountant → union of both branches', () => {
  // Reception operational surface…
  assert.equal(call({ roles: ['reception', 'accountant'], method: 'GET', path: '/reservations/42/sas' }).nextCalled, true);
  // …plus the accountant read-only accounting.
  assert.equal(call({ roles: ['reception', 'accountant'], method: 'GET', path: '/accounting/sales.csv' }).nextCalled, true);
  // But neither branch grants clients.
  assert.equal(call({ roles: ['reception', 'accountant'], method: 'GET', path: '/clients' }).nextCalled, false);
});

test('unknown / no role → fail-closed 403 (unchanged)', () => {
  assert.equal(call({ roles: ['ghost'], method: 'GET', path: '/reservations' }).nextCalled, false);
  assert.equal(call({ roles: null, method: 'GET', path: '/reservations' }).nextCalled, false);
});
