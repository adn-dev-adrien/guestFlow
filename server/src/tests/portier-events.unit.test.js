// specs/gate-access-portier.md §3.6 — `POST /internal/portier/v1/events`, the one request Portier sends.
//
// It must come from the loopback socket (403 otherwise) and carry a valid signature (401 otherwise).
// The signed body is Portier `specs/contract-vectors.json` « evt », so this also proves guestFlow
// accepts exactly what Portier signs.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const { buildController } = require('../controllers/portierController');

const K_GF = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8';
const TS = '1789999200000';
const BODY = '{"type":"devices_over_six","accessId":"6f1c2a9e-3b7d-4c55-9a10-2e8f4b6d7c01","label":"Camille (Gîte · 202609042)","count":7,"at":"2026-09-22T18:03:00.000Z"}';
const SIG = '6ed21fa0ee69f5fde24a0c59bf1351f8e5a3108457f21aa2f98aed41c4470c78';

function harness({ env = { PORTIER_KEY_GF: K_GF }, nowMs = Number(TS) + 5000 } = {}) {
  const pushes = [];
  const controller = buildController({
    env,
    now: () => new Date(nowMs),
    notifyAdmins: async (payload) => { pushes.push(payload); return { admins: 1, sent: 1 }; },
    logger: { warn() {} },
  });
  return { controller, pushes };
}

// An override set to undefined means « absent » — a default must not put the header back.
function eventRequest(over = {}) {
  const pick = (name, fallback) => (Object.prototype.hasOwnProperty.call(over, name) ? over[name] : fallback);
  const body = pick('body', BODY);
  const headers = { 'x-portier-ts': pick('ts', TS), 'x-portier-sig': pick('sig', SIG) };
  return {
    socket: { remoteAddress: pick('remoteAddress', '127.0.0.1') },
    get: (name) => headers[String(name).toLowerCase()],
    rawBody: Buffer.from(body, 'utf8'),
    body: JSON.parse(body),
  };
}

function fakeRes() {
  return {
    statusCode: 200, body: undefined, ended: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

test('signed, from the loopback: 204, and ONE push to the admins with the owner\'s sentence', async () => {
  const { controller, pushes } = harness();
  for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const res = fakeRes();
    await controller.receiveEvent(eventRequest({ remoteAddress }), res);
    assert.equal(res.statusCode, 204);
    assert.equal(res.ended, true);
  }
  assert.equal(pushes.length, 3, 'one push per event');
  assert.deepEqual(pushes[0], {
    title: 'Accès portail',
    body: "7 téléphones sur l'accès de Camille (Gîte · 202609042)",
    url: '/portail',
    tag: 'guestflow-portier-devices-6f1c2a9e-3b7d-4c55-9a10-2e8f4b6d7c01',
  });
});

test('from another machine: 403, even with a valid signature, and no push', async () => {
  const { controller, pushes } = harness();
  for (const remoteAddress of ['192.168.0.22', '10.0.0.5', undefined]) {
    const res = fakeRes();
    await controller.receiveEvent(eventRequest({ remoteAddress }), res);
    assert.equal(res.statusCode, 403);
  }
  assert.equal(pushes.length, 0);
});

test('unsigned, mis-signed, tampered, stale, or no key configured: 401, and no push', async () => {
  const cases = [
    [harness(), eventRequest({ sig: undefined }), 'bad_signature'],
    [harness(), eventRequest({ ts: undefined }), 'bad_signature'],
    [harness(), eventRequest({ sig: SIG.replace(/^6/, '7') }), 'bad_signature'],
    [harness(), eventRequest({ body: BODY.replace('"count":7', '"count":70') }), 'bad_signature'],
    [harness({ nowMs: Number(TS) + 120001 }), eventRequest(), 'stale'],
    [harness({ env: {} }), eventRequest(), 'bad_signature'],
  ];
  for (const [{ controller, pushes }, req, error] of cases) {
    const res = fakeRes();
    await controller.receiveEvent(req, res);
    assert.deepEqual([res.statusCode, res.body], [401, { error }]);
    assert.equal(pushes.length, 0);
  }
});

test('over HTTP: the raw bytes Express keeps are the bytes Portier signed, and the /api guard is not in the way', async () => {
  const { controller, pushes } = harness({ nowMs: Number(TS) });
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api', (req, res) => res.status(401).json({ error: 'UNAUTHENTICATED' }));
  app.post('/internal/portier/v1/events', controller.receiveEvent);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/internal/portier/v1/events',
        headers: { 'Content-Type': 'application/json', 'X-Portier-Ts': TS, 'X-Portier-Sig': SIG },
      }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      req.end(Buffer.from(BODY, 'utf8'));
    });
    assert.equal(status, 204);
    assert.equal(pushes.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
