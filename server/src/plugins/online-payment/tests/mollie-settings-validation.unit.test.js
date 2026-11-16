// specs/mollie-rolling-reserve-and-incoming-payments.md rules 3, 14 and 15 — the reserve settings and the optional Mollie
// account: what the settings endpoint refuses (and says), and what « Tester » reports. The token is a secret that never
// leaves the server. No network: « Tester » talks to a local stand-in for Mollie (`MOLLIE_API_BASE`).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { mollieDeclared, SECRET_KEYS } = require('../settingsStore');
const { tokenMessage, NOT_A_TOKEN } = require('../mollieConnection');
const { mountReconciliation } = require('../reconciliation');
const { dayAt } = require('./mollieFixture');
const { capturingCtx } = require('./mollieCtxFixture');

const declared = mollieDeclared();
const entry = (key) => declared.find((d) => d.key === key);
const validate = (key, value) => entry(key).validate(value);

test('rule 3 — the reserve rate is a number from 0 to 50 with at most 2 decimals, refused in words', () => {
  assert.equal(validate('mollieReservePercent', '20'), null);
  assert.equal(validate('mollieReservePercent', '0'), null, 'a rate of 0 disables the reserve');
  assert.equal(validate('mollieReservePercent', '50'), null);
  assert.equal(validate('mollieReservePercent', '12.25'), null);
  ['51', '-5', '20.123', 'vingt'].forEach((v) => assert.equal(validate('mollieReservePercent', v), 'Le taux doit être compris entre 0 et 50 %', v));
  assert.equal(entry('mollieReservePercent').default, '20');
});

test('rule 3 — the hold is a whole number of days from 1 to 365', () => {
  assert.equal(validate('mollieReserveHoldDays', '90'), null);
  assert.equal(validate('mollieReserveHoldDays', '365'), null);
  ['0', '366', '45.5', '-3', 'trois'].forEach((v) => assert.equal(validate('mollieReserveHoldDays', v), 'La durée est un nombre de jours entre 1 et 365', v));
  assert.equal(entry('mollieReserveHoldDays').default, '90');
});

test('rule 3 — « Retenue appliquée depuis » is a real day that is not in the future; empty means the reconciliation start date', () => {
  assert.equal(validate('mollieReserveSince', dayAt(-30)), null);
  assert.equal(validate('mollieReserveSince', ''), null);
  assert.ok(validate('mollieReserveSince', dayAt(2)));
  assert.ok(validate('mollieReserveSince', '31/10/2026'));
});

test('rule 14 — the token is a plugin secret (encrypted at rest, read back as « set »), the profile id a pfl_ identifier', () => {
  assert.equal(entry('mollieAccessToken').secret, true);
  assert.equal(SECRET_KEYS.has('mollieAccessToken'), false, 'the Qonto secrets are another list');
  assert.equal(validate('mollieProfileId', 'pfl_abc123'), null);
  assert.equal(validate('mollieProfileId', ''), null);
  assert.match(validate('mollieProfileId', 'abc'), /pfl_/);
  assert.match(validate('mollieLastRead', '{}'), /Réglé/);
  assert.match(validate('mollieLastError', ''), /Réglé/);
});

test('rule 15 — a token that does not start with access_ is refused before any call', () => {
  assert.equal(validate('mollieAccessToken', 'access_abc'), null);
  assert.equal(validate('mollieAccessToken', ''), null, 'empty keeps the stored token');
  assert.equal(validate('mollieAccessToken', null), null, 'null clears it');
  assert.equal(validate('mollieAccessToken', 'live_abcdef'), 'Ce n\'est pas un jeton d\'accès Mollie : il commence par access_');
  assert.equal(tokenMessage('test_abc'), NOT_A_TOKEN);
});

// A stand-in for Mollie: answers from a table, records the requests.
function standIn(table) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, authorization: req.headers.authorization });
    const hit = Object.entries(table).find(([k]) => req.url.startsWith(k));
    res.statusCode = hit ? hit[1].status : 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(hit ? hit[1].body : {}));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ seen, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

async function testEndpoint(values, body, table) {
  const mollie = await standIn(table);
  process.env.MOLLIE_API_BASE = mollie.base;
  const { ctx, store } = capturingCtx(values);
  mountReconciliation(ctx, { store: {} });
  const route = ctx.mounts.find((m) => m.path === '/api/plugins/online-payment/mollie');
  assert.ok(route, 'POST /api/plugins/online-payment/mollie/test is mounted');
  const app = express();
  app.use(express.json());
  app.use(route.path, route.router);
  const app$ = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${app$.address().port}${route.path}/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json(), store, mollie };
  } finally {
    app$.close();
    mollie.close();
    delete process.env.MOLLIE_API_BASE;
  }
}

test('rule 15 — « Tester » reads one settlement, reports it, and fills the profile of an organisation token; the token is never returned', async () => {
  const token = 'access_SECRET_TOKEN_VALUE';
  const answer = await testEndpoint({ mollieAccessToken: token }, {}, {
    '/v2/settlements': { status: 200, body: { _embedded: { settlements: [{ id: 'stl_1', reference: 'T19274230.2611.01' }] } } },
    '/v2/profiles': { status: 200, body: { _embedded: { profiles: [{ id: 'pfl_test', name: 'Test', mode: 'test' }, { id: 'pfl_live', name: 'Solio', mode: 'live' }] } } },
  });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { ok: true, settlements: 1, profileId: 'pfl_live' });
  assert.ok(!JSON.stringify(answer.body).includes(token));
  assert.equal(answer.store.get('mollieProfileId'), 'pfl_live');
  assert.ok(answer.mollie.seen[0].url.startsWith('/v2/settlements?limit=1'));
  assert.equal(answer.mollie.seen[0].authorization, `Bearer ${token}`);
});

test('rule 15 — a profile-restricted token is told in words how to recreate it', async () => {
  const answer = await testEndpoint({ mollieAccessToken: 'access_x' }, {}, {
    '/v2/settlements': { status: 403, body: { detail: 'This API endpoint is only available with an access token not restricted to a specific profile' } },
  });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body, { ok: false, settlements: 0, error: 'Ce jeton est limité à un profil : le recréer sans restriction de profil pour lire les règlements' });
});

test('rule 15 — a refused token is worded; a token without the access_ prefix is refused before any call', async () => {
  const refused = await testEndpoint({ mollieAccessToken: 'access_x' }, {}, { '/v2/settlements': { status: 401, body: { detail: 'Unauthorized' } } });
  assert.equal(refused.body.ok, false);
  assert.match(refused.body.error, /invalide ou révoqué/);
  const wrongPrefix = await testEndpoint({}, { token: 'live_notanaccesstoken' }, {});
  assert.equal(wrongPrefix.status, 400);
  assert.deepEqual(wrongPrefix.body, { ok: false, settlements: 0, error: 'Ce n\'est pas un jeton d\'accès Mollie : il commence par access_' });
  assert.deepEqual(wrongPrefix.mollie.seen, [], 'no call was made');
  const none = await testEndpoint({}, {}, {});
  assert.equal(none.status, 400);
  assert.match(none.body.error, /Aucun jeton/);
});

test('rule 14 — the plugin declares what the core reads: ledger tranches, incoming payments, journal entries, two attention subjects', () => {
  const { ctx, declared: provided } = capturingCtx();
  mountReconciliation(ctx, { store: {} });
  ['ledgerBankTranches', 'incomingPayments', 'journalEntries'].forEach((name) => assert.equal(typeof provided[name], 'function', name));
  assert.deepEqual(ctx.attentions.map((a) => a.key), ['bank-reconciliation', 'mollie-reserve-late']);
  assert.deepEqual(ctx.migrationList.map((m) => m.name), ['reconciliation_v1', 'reconciliation_v2', 'reconciliation_v3']);
});
