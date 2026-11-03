// specs/public-api.md rule 22 (audit R21, public finding 1 and R14 L-1) — the parts of the public refusal that live
// in the core: the language of a refusal reads strings only (`langOf` « never throws »), the site's return path
// reads strings only, and a body the JSON parser refuses answers the nested envelope on /public/, the flat one
// elsewhere (specs/express-5-upgrade.md rules 7 and 8).
process.env.DB_PATH = ':memory:';
const { listenLocal } = require('./listenLocal');
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { bodyParserRefusal } = require('../utils/bodyParserRefusal');
const { normalisePublicLang, statesLang, labels } = require('../utils/publicLabels');
const { langOf, langStated, answerBodyRefusal } = require('../controllers/public/publicHttp');
const settingsModel = require('../models/settingsModel');
const { __test: { buildReturnUrl } } = require('../controllers/public/publicPaymentController');

const EVIL = JSON.parse('{"toString":1}');

test('specs/public-api.md rule 22 — a language that is not a string reads as French and is not « stated »', () => {
  for (const value of [EVIL, {}, [], ['en'], true, 1]) {
    assert.equal(normalisePublicLang(value), 'fr', JSON.stringify(value));
    assert.equal(statesLang(value), false, JSON.stringify(value));
    assert.equal(langOf({ body: { lang: value }, query: {} }), 'fr');
    assert.equal(langStated({ body: { lang: value }, query: {} }), false);
  }
  assert.equal(normalisePublicLang('en_GB'), 'en');
  assert.equal(statesLang('fr'), true);
  assert.equal(statesLang(undefined), false);
});

test('specs/public-api.md rule 22 — a return path that is not a string gives no redirect, never a throw', (t) => {
  t.mock.method(settingsModel, 'publicSiteOrigin', () => 'https://site.example.test');
  for (const value of [EVIL, {}, [], ['/merci'], true, 1]) assert.equal(buildReturnUrl(value), '', JSON.stringify(value));
  assert.equal(buildReturnUrl('/merci'), 'https://site.example.test/merci');
  assert.equal(buildReturnUrl(undefined), 'https://site.example.test/');
  assert.equal(buildReturnUrl(null), 'https://site.example.test/');
  assert.equal(buildReturnUrl('//evil.example.test'), '');
});

function appWith(logs) {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  const answer = (req, res) => res.json({ ok: true });
  app.post('/public/v1/quote', answer);
  app.post('/PUBLIC/v1/quote', answer);
  app.post('/api/x', answer);
  // Same terminal middleware as `src/index.js`.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const refusal = bodyParserRefusal(err);
    if (refusal && !res.headersSent) return answerBodyRefusal(req, res, refusal);
    logs.push(String(err));
    return res.status(500).json({ error: 'Erreur interne du serveur' });
  });
  return app;
}

async function post(path, body, headers = {}) {
  const logs = [];
  const server = await listenLocal(appWith(logs));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body, signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, json: await res.json(), logs };
  } finally { server.closeAllConnections(); server.close(); }
}

// R14 L-1
test('specs/express-5-upgrade.md rule 8, specs/public-api.md rule 22 — a body the parser refuses on /public/ answers the nested envelope, in the caller\'s language', async () => {
  const bad = await post('/public/v1/quote', '{bad');
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json, { error: { code: 'INVALID_JSON', message: labels('fr').errors.bodyMalformed } });
  assert.deepEqual(bad.logs, []);

  const en = await post('/public/v1/quote?lang=en', '{bad');
  assert.deepEqual(en.json, { error: { code: 'INVALID_JSON', message: labels('en').errors.bodyMalformed } });

  const big = await post('/public/v1/quote', JSON.stringify({ a: 'x'.repeat(2000) }));
  assert.equal(big.status, 413);
  assert.deepEqual(big.json, { error: { code: 'PAYLOAD_TOO_LARGE', message: labels('fr').errors.bodyTooLarge } });

  const charset = await post('/public/v1/quote', '{}', { 'Content-Type': 'application/json; charset=klingon' });
  assert.equal(charset.status, 415);
  assert.deepEqual(charset.json, { error: { code: 'UNSUPPORTED_CHARSET', message: labels('fr').errors.bodyUnsupported } });

  const upper = await post('/PUBLIC/v1/quote', '{bad');
  assert.equal(upper.json.error.code, 'INVALID_JSON', 'Express routes ignore the case');
});

test('specs/express-5-upgrade.md rule 7 — the internal API keeps its flat refusal', async () => {
  const bad = await post('/api/x', '{bad');
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json, { error: 'Requête invalide : le corps JSON est mal formé.', code: 'INVALID_JSON' });
});

test('index.js answers the parser\'s refusal through the same function', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.js'), 'utf8');
  assert.match(src, /answerBodyRefusal\(req, res, refusal\)/);
});
