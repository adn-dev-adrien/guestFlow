const test = require('node:test');
const assert = require('node:assert/strict');

const requirePublicApiKey = require('../middleware/requirePublicApiKey');

function mockReq(headers = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { get: (name) => lower[String(name).toLowerCase()] };
}

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function run(headers, configuredKey) {
  const prev = process.env.PUBLIC_API_KEY;
  if (configuredKey === undefined) delete process.env.PUBLIC_API_KEY;
  else process.env.PUBLIC_API_KEY = configuredKey;
  const req = mockReq(headers);
  const res = mockRes();
  let nextCalled = false;
  requirePublicApiKey(req, res, () => { nextCalled = true; });
  if (prev === undefined) delete process.env.PUBLIC_API_KEY;
  else process.env.PUBLIC_API_KEY = prev;
  return { res, nextCalled };
}

test('401 when no key configured server-side (fail closed)', () => {
  const { res, nextCalled } = run({ 'X-API-Key': 'whatever' }, undefined);
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error.code, 'UNAUTHENTICATED');
});

test('401 when no key provided', () => {
  const { res, nextCalled } = run({}, 'secret-key');
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('401 on wrong key', () => {
  const { res, nextCalled } = run({ 'X-API-Key': 'wrong' }, 'secret-key');
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('passes with correct X-API-Key', () => {
  const { res, nextCalled } = run({ 'X-API-Key': 'secret-key' }, 'secret-key');
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('passes with correct Authorization: Bearer', () => {
  const { res, nextCalled } = run({ Authorization: 'Bearer secret-key' }, 'secret-key');
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});
