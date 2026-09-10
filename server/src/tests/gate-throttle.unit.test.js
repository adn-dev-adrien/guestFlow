const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

// specs/guest-gate-access.md §3.3 rule 12 — the throttle on the unlock form.
//
// This one is an integration test on purpose. The limiter is middleware with its own store and its
// own notion of a "failed" request; asserting its configuration object would prove nothing about
// what a browser actually meets.

function loadLimiters(env) {
  const previous = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  delete require.cache[require.resolve('../middleware/rateLimiters')];
  const limiters = require('../middleware/rateLimiters');
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return limiters;
}

async function withApp(limiter, handler, run) {
  const app = express();
  app.set('trust proxy', false);
  app.post('/session', limiter, handler);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const post = () => new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/session', method: 'POST' }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
  try {
    await run(post);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[require.resolve('../middleware/rateLimiters')];
  }
}

test('five wrong codes, then the door stops answering', async () => {
  const { gateCodeLimiter } = loadLimiters({
    GATE_CODE_RATELIMIT_MAX: '5',
    GATE_CODE_RATELIMIT_WINDOW_MS: '600000',
  });

  await withApp(gateCodeLimiter, (req, res) => res.status(401).json({ error: { code: 'INVALID_CODE' } }), async (post) => {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      assert.equal(await post(), 401, `attempt ${attempt} is answered, not throttled`);
    }
    assert.equal(await post(), 429, 'the sixth is refused outright');
    assert.equal(await post(), 429, 'and it stays refused');
  });
});

test('a family typing the SAME right code on four phones is never throttled', async () => {
  const { gateCodeLimiter } = loadLimiters({
    GATE_CODE_RATELIMIT_MAX: '5',
    GATE_CODE_RATELIMIT_WINDOW_MS: '600000',
  });

  // They share one household connection, so every phone shows up as the same IP. Counting
  // successes would lock the family out of their own gate — hence skipSuccessfulRequests.
  await withApp(gateCodeLimiter, (req, res) => res.json({ ok: true }), async (post) => {
    for (let phone = 1; phone <= 10; phone += 1) {
      assert.equal(await post(), 200, `phone ${phone} must get in`);
    }
  });
});

test('the open route has its own, looser bound in front of the real ceilings', async () => {
  const { gateOpenLimiter } = loadLimiters({
    GATE_OPEN_RATELIMIT_MAX: '3',
    GATE_OPEN_RATELIMIT_WINDOW_MS: '600000',
  });

  await withApp(gateOpenLimiter, (req, res) => res.json({ ok: true }), async (post) => {
    assert.equal(await post(), 200);
    assert.equal(await post(), 200);
    assert.equal(await post(), 200);
    const refused = await post();
    assert.equal(refused, 429, 'this one counts successes — a press that worked still costs a slot');
  });
});

test('the refusal never says whether the code exists', async () => {
  const { gateCodeLimiter } = loadLimiters({ GATE_CODE_RATELIMIT_MAX: '1' });
  await withApp(gateCodeLimiter, (req, res) => res.status(401).json({ error: { code: 'INVALID_CODE' } }), async (post) => {
    assert.equal(await post(), 401);
    assert.equal(await post(), 429);
    // Both shapes are `{ error: { code } }` with no hint of a stay, a lodging or a name.
  });
});
