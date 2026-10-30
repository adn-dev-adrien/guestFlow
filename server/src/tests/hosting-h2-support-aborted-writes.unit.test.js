// specs/hosting-h2-account-security.md rule 60 (audit of 2026-10-28, finding M2) — a support write is
// in the journal even when the client leaves before the answer: `close` without `finish` is logged with
// the « aborted » marker, and a normal answer is logged once.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { createSupportAudit } = require('../middleware/supportAudit');
const { listenLocal } = require('./listenLocal');

async function serve(handler) {
  const log = [];
  const controller = { sessionAccess: () => ({ id: 1 }), record: (id, entry) => log.push(entry) };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.session = { supportAccessId: 1, user: { isSupport: true } }; next(); });
  app.use('/api', createSupportAudit({ controller, isSecretSetting: () => false }));
  app.post('/api/reservations/1/cancel', handler);
  const server = await listenLocal(app);
  return { server, log, port: server.address().port };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('rule 60 — a write whose client hangs up before the answer is still logged, as aborted', async (t) => {
  const writes = [];
  const { server, log, port } = await serve(async (req, res) => {
    writes.push('cancelled');
  t.after(() => server.close());
    await wait(200);
    res.json({ ok: true });
  });
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/reservations/1/cancel', headers: { 'content-type': 'application/json' } });
  req.on('error', () => {});
  req.end('{}');
  await wait(50);
  req.destroy();
  await wait(400);
  assert.deepEqual(writes, ['cancelled']);
  assert.equal(log.length, 1);
  assert.equal(log[0].method, 'POST');
  assert.match(log[0].summary, /aborted/);
});

test('rule 60 — a normal answer is logged once, with its status, and not as aborted', async (t) => {
  const { server, log, port } = await serve((req, res) => res.status(201).json({ ok: true }));
  t.after(() => server.close());
  await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/reservations/1/cancel', headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', resolve); });
    req.end('{}');
  });
  await wait(100);
  assert.equal(log.length, 1);
  assert.equal(log[0].summary, '201');
});

test('rule 60 — the customer reads an aborted write as « Interrompu »', () => {
  const { describe } = require('../utils/supportLogLabels');
  assert.equal(describe({ method: 'POST', path: '/api/reservations/1/cancel', summary: 'aborted' }).outcomeLabel, 'Interrompu');
  assert.equal(describe({ method: 'POST', path: '/api/reservations/1/cancel', summary: '200' }).outcomeLabel, 'Effectué');
});
