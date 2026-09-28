// The outcomes Sowel posts back, and the alerts they raise — specs/gate-access-sowel-connector.md
// §3.2 and §3.3.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');

const { freshDb, addStay, addUser, fakePush, silent } = require('./gateKeysFixtures');
const { receiveResults, runStaleReadCheck, dashboardAlerts, MAX_RESULTS } = require('../results');
const { errorReason, ERROR_REASONS } = require('../keys');
const { buildController } = require('../controller');
const { buildRequireGateConnector, canonicalString } = require('../requireConnector');
const { buildSignGateResponse, responseSignature } = require('../signResponse');

const NOW = new Date('2026-09-27T18:00:00.000Z');

function setup() {
  const { db, model } = freshDb();
  addUser(db, { id: 1, roles: ['admin'] });
  addUser(db, { id: 2, roles: ['admin', 'reception'] });
  addUser(db, { id: 3, roles: ['reception'] });
  addUser(db, { id: 4, roles: ['accountant'] });
  addUser(db, { id: 5, roles: ['admin'], isActive: 0 });
  const push = fakePush();
  const deps = (now = NOW) => ({ model, pushService: push, logger: silent, now });
  return { db, model, push, deps };
}

const created = (reservationId, over = {}) => ({
  reservationId: String(reservationId), action: 'create', ok: true,
  state: 'not_yet', code: '4K7M-9QT2', url: 'https://acces.domainesolio.com/#i=4K7M9QT2', ...over,
});
const failed = (reservationId, error = 'unknown_profile', over = {}) => ({
  reservationId: String(reservationId), action: 'create', ok: false,
  error, message: 'The default profile is not granted to this plugin', ...over,
});

// specs/gate-access-sowel-connector.md §3.2 rule 11
test('the request is refused without results[], and above 500 entries', async () => {
  const { deps } = setup();
  assert.equal((await receiveResults(deps(), {})).status, 400);
  assert.equal((await receiveResults(deps(), { results: 'x' })).status, 400);
  const tooMany = Array.from({ length: MAX_RESULTS + 1 }, (_, i) => created(i + 1));
  assert.equal((await receiveResults(deps(), { results: tooMany })).status, 413);
  const exactly = Array.from({ length: MAX_RESULTS }, (_, i) => created(i + 1));
  assert.deepEqual(await receiveResults(deps(), { results: exactly }), { status: 200, body: { stored: 500 } });
});

// specs/gate-access-sowel-connector.md §3.2 rule 11 — what cannot be filed is skipped, not counted.
test('entries that cannot be filed are skipped and not counted', async () => {
  const { deps, model } = setup();
  const { body } = await receiveResults(deps(), {
    results: [
      created(10),
      { reservationId: 'abc', action: 'create', ok: true },
      { reservationId: '0', action: 'create', ok: true },
      { reservationId: '11', action: 'extend', ok: true },
      { reservationId: '12', action: 'create', ok: 'yes' },
      null,
    ],
  });
  assert.deepEqual(body, { stored: 1 });
  assert.equal(model.all().length, 1);
});

// specs/gate-access-sowel-connector.md §3.2 rules 9-10 — the latest result wins, the link is opaque.
test('the latest result replaces the previous one, code and link stored as handed', async () => {
  const { db, deps, model } = setup();
  const stay = addStay(db, { reservationNumber: 'R-2026-041' });
  await receiveResults(deps(), { results: [created(stay.id)] });
  await receiveResults(deps(), { results: [created(stay.id, { code: null, url: 'https://sowel.local/p/x#i=OPAQUE', state: 'live' })] });

  const rows = model.all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code, null);
  assert.equal(rows[0].url, 'https://sowel.local/p/x#i=OPAQUE');
  assert.equal(rows[0].state, 'live');
  // The window listed with the key is kept on the row (rule 9).
  assert.equal(rows[0].label, 'Gîte · R-2026-041 · Marie');
  assert.equal(rows[0].startsAt, '2026-10-01T10:00:00.000Z');
  assert.equal(rows[0].endsAt, '2026-10-04T10:00:00.000Z');
});

// specs/gate-access-sowel-connector.md §3.2 rule 9 — a result for a deleted stay keeps the window.
test('a result for a stay deleted since keeps the window stored before', async () => {
  const { db, deps, model } = setup();
  const stay = addStay(db);
  await receiveResults(deps(), { results: [created(stay.id)] });
  db.prepare('DELETE FROM reservations WHERE id = ?').run(stay.id);
  await receiveResults(deps(), { results: [{ reservationId: String(stay.id), action: 'revoke', ok: true, state: 'revoked' }] });
  const row = model.get(stay.id);
  assert.equal(row.action, 'revoke');
  assert.equal(row.endsAt, '2026-10-04T10:00:00.000Z');
  assert.equal(row.code, null);
});

// specs/gate-access-sowel-connector.md §3.3 rule 14 — every active admin, nobody else.
test('a failure pushes every active admin, and nobody else', async () => {
  const { db, deps, push } = setup();
  const stay = addStay(db);
  await receiveResults(deps(), { results: [failed(stay.id)] });
  assert.deepEqual(push.calls.map((c) => c.userId), [1, 2]);
});

// specs/gate-access-sowel-connector.md §3.3 rule 15 + §3.2 rule 12 — the French text, and one push only.
test('the push is short and in French, and the same failure an hour later pushes nothing', async () => {
  const { db, deps, push } = setup();
  const stay = addStay(db, { reservationNumber: 'R-2026-041' });
  await receiveResults(deps(), { results: [failed(stay.id)] });
  assert.deepEqual(push.calls[0].payload, {
    title: 'Clé portail non créée',
    body: "R-2026-041 · Marie — le profil par défaut n'est pas accordé au plugin",
    url: '/',
  });
  const before = push.calls.length;
  await receiveResults(deps(new Date('2026-09-27T19:00:00Z')), { results: [failed(stay.id)] });
  await receiveResults(deps(new Date('2026-09-27T20:00:00Z')), { results: [failed(stay.id)] });
  assert.equal(push.calls.length, before);
});

// specs/gate-access-sowel-connector.md §3.3 rule 14 — a different error speaks again.
test('a different error on the same reservation pushes again', async () => {
  const { db, deps, push } = setup();
  const stay = addStay(db);
  await receiveResults(deps(), { results: [failed(stay.id, 'unknown_profile')] });
  await receiveResults(deps(), { results: [failed(stay.id, 'profile_incomplete')] });
  const bodies = push.calls.filter((c) => c.userId === 1).map((c) => c.payload.body);
  assert.equal(bodies.length, 2);
  assert.match(bodies[1], /ne liste aucun portail/);
});

// specs/gate-access-sowel-connector.md §3.3 rules 13-14 — a success clears the alert.
test('a success clears the alert, and the failure coming back pushes again', async () => {
  const { db, deps, push, model } = setup();
  const stay = addStay(db);
  await receiveResults(deps(), { results: [failed(stay.id)] });
  assert.equal(dashboardAlerts({ model, now: NOW }).failures.length, 1);

  await receiveResults(deps(), { results: [created(stay.id)] });
  assert.equal(model.get(stay.id).alertedError, null);
  assert.deepEqual(dashboardAlerts({ model, now: NOW }).failures, []);

  const before = push.calls.length;
  await receiveResults(deps(), { results: [failed(stay.id)] });
  assert.equal(push.calls.length, before + 2);
});

// specs/gate-access-sowel-connector.md §3.3 rule 15 — a revoke, and an unknown code.
test('a failed revoke says so, and an unknown code shows Sowel’s message', async () => {
  const { db, deps, push } = setup();
  const stay = addStay(db, { kind: 'cancelled', reservationNumber: 'R-2026-030', clientId: 2 });
  await receiveResults(deps(), {
    results: [{ reservationId: String(stay.id), action: 'revoke', ok: false, error: 'gate_on_fire', message: 'The gate is on fire' }],
  });
  assert.deepEqual(push.calls[0].payload, {
    title: 'Clé portail non révoquée',
    body: 'R-2026-030 · Paul — The gate is on fire',
    url: '/',
  });
  for (const code of Object.keys(ERROR_REASONS)) {
    assert.equal(errorReason({ error: code, message: 'ignored' }), ERROR_REASONS[code], code);
  }
  assert.equal(errorReason({ error: 'unknown_thing' }), 'unknown_thing');
  assert.equal(errorReason({ error: 'implausible_stay' }), 'séjour de plus de 31 jours refusé par Sowel');
});

// specs/gate-access-sowel-connector.md §3.3 rule 13 — the dashboard payload, and ended stays leave it.
test('the dashboard lists failures with number, first name and reason, until the stay ends', async () => {
  const { db, deps, model } = setup();
  const stay = addStay(db, { reservationNumber: 'R-2026-041' });
  await receiveResults(deps(), { results: [failed(stay.id)] });

  const { failures } = dashboardAlerts({ model, now: NOW });
  assert.deepEqual(failures, [{
    reservationId: stay.id,
    reservationNumber: 'R-2026-041',
    guestFirstName: 'Marie',
    name: 'R-2026-041 · Marie',
    action: 'create',
    title: 'Clé portail non créée',
    reason: "le profil par défaut n'est pas accordé au plugin",
    exists: true,
  }]);
  assert.deepEqual(dashboardAlerts({ model, now: new Date('2026-10-04T10:00:00.000Z') }).failures, []);
});

// specs/gate-access-sowel-connector.md §3.3 rule 17 — never read → nothing; > 3 h → once.
test('Sowel late by more than 3 hours pushes the admins once; never read raises nothing', async () => {
  const { deps, push, model } = setup();
  assert.deepEqual(await runStaleReadCheck(deps()), { alerted: false });
  assert.equal(dashboardAlerts({ model, now: NOW }).stale, false);

  model.recordRead('2026-09-27T15:00:00.000Z');
  // Exactly 3 h: not late yet.
  assert.deepEqual(await runStaleReadCheck(deps(new Date('2026-09-27T18:00:00.000Z'))), { alerted: false });
  assert.equal(push.calls.length, 0);

  const late = new Date('2026-09-27T18:00:01.000Z');
  assert.deepEqual(await runStaleReadCheck(deps(late)), { alerted: true });
  assert.deepEqual(push.calls.map((c) => c.userId), [1, 2]);
  assert.equal(push.calls[0].payload.title, 'Clés portail : Sowel ne lit plus');
  assert.match(push.calls[0].payload.body, /17:00/);
  assert.equal(dashboardAlerts({ model, now: late }).stale, true);

  assert.deepEqual(await runStaleReadCheck(deps(new Date('2026-09-27T19:00:00.000Z'))), { alerted: false });
  assert.equal(push.calls.length, 2);
});

// specs/gate-access-sowel-connector.md §3.3 rule 18 — a read clears it, the next outage pushes again.
test('a read clears the stale warning, and the next outage pushes again', async () => {
  const { deps, push, model } = setup();
  model.recordRead('2026-09-27T10:00:00.000Z');
  await runStaleReadCheck(deps());
  assert.equal(push.calls.length, 2);

  model.recordRead('2026-09-27T18:30:00.000Z');
  assert.equal(model.readState().staleAlertedAt, null);
  assert.equal(dashboardAlerts({ model, now: new Date('2026-09-27T19:00:00.000Z') }).stale, false);

  await runStaleReadCheck(deps(new Date('2026-09-27T22:00:00.000Z')));
  assert.equal(push.calls.length, 4);
});

// specs/gate-access-sowel-connector.md §3.1 rule 8 + §3.4 rules 19 + 22b — the real channel, end to end.
test('over HTTP: a signed read stamps lastReadAt, a refused one stamps nothing, results are filed', async () => {
  const { db, model, push } = setup();
  const stay = addStay(db);
  const env = { GATE_API_KEY: 'k', GATE_SIGNING_SECRET: 's' };
  const clock = () => NOW;
  const controller = buildController({ model: () => model, pushService: push, clock });

  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  const router = express.Router();
  router.use(buildRequireGateConnector({ env, now: () => NOW.getTime() }));
  router.use(buildSignGateResponse({ env }));
  router.get('/keys', controller.keys);
  router.post('/results', controller.results);
  app.use('/public/v1/gate', router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  const signed = (method, url, body = '', secret = 's') => ({
    authorization: 'Bearer k',
    'x-gate-timestamp': String(NOW.getTime()),
    'x-gate-signature': crypto.createHmac('sha256', secret)
      .update(canonicalString(method, url, NOW.getTime(), body)).digest('hex'),
    ...(body ? { 'content-type': 'application/json' } : {}),
  });

  try {
    const refused = await fetch(`${base}/public/v1/gate/keys`, { headers: signed('GET', '/public/v1/gate/keys', '', 'wrong') });
    assert.equal(refused.status, 401);
    assert.equal(model.readState().lastReadAt, null);

    const readHeaders = signed('GET', '/public/v1/gate/keys');
    const read = await fetch(`${base}/public/v1/gate/keys`, { headers: readHeaders });
    assert.equal(read.status, 200);
    const raw = Buffer.from(await read.arrayBuffer());
    assert.equal(read.headers.get('x-gate-response-signature'), responseSignature('s', readHeaders['x-gate-signature'], raw));
    const list = JSON.parse(raw.toString('utf8'));
    assert.deepEqual(list.keys.map((k) => k.reservationId), [String(stay.id)]);
    assert.equal(model.readState().lastReadAt, NOW.toISOString());

    const body = JSON.stringify({ results: [created(stay.id)] });
    const postHeaders = signed('POST', '/public/v1/gate/results', body);
    const posted = await fetch(`${base}/public/v1/gate/results`, { method: 'POST', body, headers: postHeaders });
    assert.equal(posted.status, 200);
    const postedRaw = Buffer.from(await posted.arrayBuffer());
    assert.equal(posted.headers.get('x-gate-response-signature'), responseSignature('s', postHeaders['x-gate-signature'], postedRaw));
    assert.deepEqual(JSON.parse(postedRaw.toString('utf8')), { stored: 1 });
    assert.equal(model.get(stay.id).code, '4K7M-9QT2');
  } finally {
    server.close();
  }
});
