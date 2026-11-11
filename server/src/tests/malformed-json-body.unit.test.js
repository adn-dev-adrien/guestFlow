// specs/express-5-upgrade.md rule 7 (spec review 2026-10-27) — a body the JSON parser refuses is a
// 400 with a French message, not « Erreur interne du serveur » logged as a crash.
const { listenLocal } = require('./listenLocal');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { bodyParserRefusal } = require('../utils/bodyParserRefusal');

// Same terminal middleware as `src/index.js`.
function appWith(logs) {
  const app = express();
  app.use(express.json());
  app.post('/api/x', (req, res) => res.json({ ok: true }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const refusal = bodyParserRefusal(err);
    if (refusal && !res.headersSent) return res.status(refusal.status).json(refusal.body);
    logs.push(String(err));
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  });
  return app;
}

async function post(app, body) {
  const server = await listenLocal(app);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/x`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, json: await res.json() };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test('a malformed JSON body answers 400 INVALID_JSON in French, and is not logged as a crash', async () => {
  const logs = [];
  const res = await post(appWith(logs), '{bad json');
  assert.equal(res.status, 400);
  assert.equal(res.json.code, 'INVALID_JSON');
  assert.match(res.json.error, /mal formé/);
  assert.equal(logs.length, 0);
});

test('an oversized body maps to 413', () => {
  const refusal = bodyParserRefusal({ type: 'entity.too.large', status: 413 });
  assert.equal(refusal.status, 413);
  assert.equal(refusal.body.code, 'PAYLOAD_TOO_LARGE');
});

test('any other error is not mistaken for a bad body', () => {
  assert.equal(bodyParserRefusal(new Error('boom')), null);
  assert.equal(bodyParserRefusal(null), null);
});

test('index.js mounts the refusal in its global error handler', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(src, /bodyParserRefusal\(err\)/);
});
