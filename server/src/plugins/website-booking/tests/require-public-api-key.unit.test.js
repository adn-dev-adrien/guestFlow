const test = require('node:test');
const assert = require('node:assert/strict');

const requirePublicApiKey = require('../requirePublicApiKey');

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

// --- specs/roostview-api-key.md — a second, read-only key for Roostview ---

function runAs(headers, { method = 'GET', path = '/properties', site = 'site-key', roostview = 'rv-key' } = {}) {
  const prev = { site: process.env.PUBLIC_API_KEY, rv: process.env.ROOSTVIEW_API_KEY };
  if (site === null) delete process.env.PUBLIC_API_KEY; else process.env.PUBLIC_API_KEY = site;
  if (roostview === null) delete process.env.ROOSTVIEW_API_KEY; else process.env.ROOSTVIEW_API_KEY = roostview;
  const req = { ...mockReq(headers), method, path };
  const res = mockRes();
  let nextCalled = false;
  requirePublicApiKey(req, res, () => { nextCalled = true; });
  for (const [name, v] of [['PUBLIC_API_KEY', prev.site], ['ROOSTVIEW_API_KEY', prev.rv]]) {
    if (v === undefined) delete process.env[name]; else process.env[name] = v;
  }
  return { req, res, nextCalled };
}

test('specs/roostview-api-key.md rule 1 + 2: roostview key reads the catalogue, availability and quotes', () => {
  for (const [method, path] of [['GET', '/properties'], ['GET', '/properties/2'], ['GET', '/properties/2/availability'], ['POST', '/quote'], ['POST', '/quote/']]) {
    const { req, nextCalled, res } = runAs(method === 'GET' ? { Authorization: 'Bearer rv-key' } : { 'X-API-Key': 'rv-key' }, { method, path });
    assert.equal(nextCalled, true, `${method} ${path}`);
    assert.equal(res.statusCode, null);
    assert.equal(req.publicApiCaller, 'roostview');
  }
});

test('specs/roostview-api-key.md rule 2: roostview key is read-only: booking requests, terms and plugin updates answer 403', () => {
  for (const [method, path] of [['POST', '/booking-requests'], ['GET', '/terms'], ['GET', '/plugin/update'], ['POST', '/properties']]) {
    const { nextCalled, res } = runAs({ 'X-API-Key': 'rv-key' }, { method, path });
    assert.equal(nextCalled, false, `${method} ${path}`);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  }
});

test('specs/roostview-api-key.md rule 3: the site key keeps the whole tree and is told apart from roostview', () => {
  const { req, nextCalled } = runAs({ Authorization: 'Bearer site-key' }, { method: 'POST', path: '/booking-requests' });
  assert.equal(nextCalled, true);
  assert.equal(req.publicApiCaller, 'site');
});

test('specs/roostview-api-key.md rule 5: roostview key fails closed when not configured, and never stands in for the site key', () => {
  assert.equal(runAs({ 'X-API-Key': 'rv-key' }, { roostview: null }).res.statusCode, 401);
  assert.equal(runAs({ 'X-API-Key': '' }, { roostview: '' }).res.statusCode, 401);
  assert.equal(runAs({ 'X-API-Key': 'site-key' }, { site: null }).res.statusCode, 401);
});

test('specs/roostview-api-key.md rule 4: a roostview call never takes a relayed visitor identity', () => {
  const visitorContext = require('../visitorContext');
  const req = { ...mockReq({ 'X-GuestFlow-Visitor-IP': '203.0.113.9' }), publicApiCaller: 'roostview' };
  visitorContext(req, {}, () => {});
  assert.equal(req.visitor.ip, '');
  const site = { ...mockReq({ 'X-GuestFlow-Visitor-IP': '203.0.113.9' }), publicApiCaller: 'site' };
  visitorContext(site, {}, () => {});
  assert.equal(site.visitor.ip, '203.0.113.9');
});
