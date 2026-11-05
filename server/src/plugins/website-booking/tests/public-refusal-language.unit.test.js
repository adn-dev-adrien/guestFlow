require('./isolatedDb');
// specs/site-english-version.md rule 8 (reading of 2026-11-05, audit R23 public finding 2): a limiter's 429, the 404 of
// the public tree and the two key refusals follow `lang`. Only the message moves: code and status do not.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

process.env.PUBLIC_API_RATELIMIT_MAX = '1';
process.env.BOOKING_REQUEST_RATELIMIT_MAX = '1';
process.env.PAYMENT_START_RATELIMIT_MAX = '1';
process.env.PAYMENT_STATUS_RATELIMIT_MAX = '1';

const limiters = require('../../../middleware/rateLimiters');
const { publicTreeNotFound } = require('../../../controllers/public/publicHttp');
const requirePublicApiKey = require('../requirePublicApiKey');
const { listenLocal } = require('../../../tests/listenLocal');
const { labels } = require('../../../utils/publicLabels');

const LIMITERS = [
  ['publicApiLimiter', 'Trop de requêtes, réessayer plus tard.', 'Too many requests, try again later.'],
  ['bookingRequestLimiter', 'Trop de demandes envoyées, réessayer plus tard.', 'Too many requests sent, try again later.'],
  ['paymentStartLimiter', 'Trop de tentatives de paiement, réessayer plus tard.', 'Too many payment attempts, try again later.'],
  ['paymentStatusLimiter', 'Trop de requêtes, réessayer plus tard.', 'Too many requests, try again later.'],
];

async function refusedAnswer(limiter, visitor, { query = '', body = {} }) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.visitor = { ip: visitor }; next(); });
  app.post('/x', limiter, (req, res) => res.json({ ok: true }));
  const server = await listenLocal(app);
  const call = () => fetch(`http://127.0.0.1:${server.address().port}/x${query}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await call()).status, 200);
    const refused = await call();
    return { status: refused.status, retryAfter: refused.headers.get('retry-after'), body: await refused.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

let visitor = 0;
const nextVisitor = () => { visitor += 1; return `198.51.100.${visitor}`; };

for (const [name, french, english] of LIMITERS) {
  test(`rule 8 — ${name}: English on ?lang=en and on a body lang, French otherwise, same code and status`, async () => {
    for (const asked of [{ query: '?lang=en' }, { body: { lang: 'en' } }, { query: '?lang=en_GB' }]) {
      const answer = await refusedAnswer(limiters[name], nextVisitor(), asked);
      assert.equal(answer.status, 429);
      assert.ok(Number(answer.retryAfter) > 0);
      assert.deepEqual(answer.body, { error: { code: 'TOO_MANY_REQUESTS', message: english } });
    }
    for (const asked of [{}, { query: '?lang=fr' }, { body: { lang: JSON.parse('{"toString":1}') } }]) {
      const answer = await refusedAnswer(limiters[name], nextVisitor(), asked);
      assert.equal(answer.status, 429);
      assert.deepEqual(answer.body, { error: { code: 'TOO_MANY_REQUESTS', message: french } });
    }
  });
}

function answerOf(run) {
  const res = { status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  run(res);
  return res;
}

test('rule 8 — a path no plugin owns: 404 NOT_FOUND in the language asked', () => {
  const en = answerOf((res) => publicTreeNotFound({ query: { lang: 'en' } }, res));
  assert.equal(en.statusCode, 404);
  assert.deepEqual(en.body, { error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
  const fr = answerOf((res) => publicTreeNotFound({ query: {}, body: {} }, res));
  assert.deepEqual(fr.body, { error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } });
  const index = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'index.js'), 'utf8');
  assert.match(index, /app\.use\('\/public\/v1', .*publicTreeNotFound/);
});

test('rule 8 — the key refusals: 401 and 403 in the language asked', () => {
  const previous = { site: process.env.PUBLIC_API_KEY, roostview: process.env.ROOSTVIEW_API_KEY };
  process.env.PUBLIC_API_KEY = 'site-key';
  process.env.ROOSTVIEW_API_KEY = 'roostview-key';
  try {
    const call = (key, query) => answerOf((res) => requirePublicApiKey({
      get: (name) => (name === 'x-api-key' ? key : undefined), method: 'POST', baseUrl: '/public/v1/booking-requests', path: '/', query,
    }, res, () => assert.fail('must refuse')));
    const missing = call('', { lang: 'en' });
    assert.equal(missing.statusCode, 401);
    assert.deepEqual(missing.body, { error: { code: 'UNAUTHENTICATED', message: 'Missing or invalid API key.' } });
    assert.equal(call('', {}).body.error.message, "Clé d'API manquante ou invalide.");
    const readOnly = call('roostview-key', { lang: 'en' });
    assert.equal(readOnly.statusCode, 403);
    assert.deepEqual(readOnly.body, { error: { code: 'FORBIDDEN', message: 'This API key is read-only.' } });
    assert.equal(call('roostview-key', {}).body.error.message, "Cette clé d'API est en lecture seule.");
  } finally {
    for (const [name, value] of [['PUBLIC_API_KEY', previous.site], ['ROOSTVIEW_API_KEY', previous.roostview]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('rule 8 — the French sentences carry no « vous »', () => {
  for (const key of ['tooManyRequests', 'tooManyBookingRequests', 'tooManyPayments']) {
    assert.doesNotMatch(labels('fr').errors[key], /réessayez/);
  }
});
