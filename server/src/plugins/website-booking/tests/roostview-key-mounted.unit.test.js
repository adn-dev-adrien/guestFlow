require('./isolatedDb');
// specs/roostview-api-key.md rule 6 (fixed at the 2026-10-27 spec review) — the read-only key judged on
// the REAL mounts. Since the chain is mounted once per prefix (routes/index.js), `req.path` alone is
// only what follows the prefix (`/`, `/1`): the key matched none of its reads and answered 403 on every
// route. Its reads answer 200 over HTTP; everything else stays 403.
const test = require('node:test');
const { before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('module');

process.env.PUBLIC_API_KEY = 'site-key-mounted';
process.env.ROOSTVIEW_API_KEY = 'rv-key-mounted';

function withMocks(modules, fn) {
  const orig = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return orig.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = orig; }
}

const answer = (status) => (req, res) => res.status(status).json({ data: {} });
let server;
let base;

before(async () => {
  const mounts = withMocks({
    '../controllers/publicCatalogController': {
      listProperties: answer(200), getProperty: answer(200), listOptions: answer(200), listResources: answer(200), getAvailability: answer(200),
    },
    '../controllers/publicQuoteController': { quote: answer(200) },
    '../controllers/publicBookingRequestController': { create: answer(201) },
  }, () => {
    ['../routes/properties', '../routes/quote', '../routes/bookingRequests', '../routes'].forEach((f) => {
      try { delete require.cache[require.resolve(f)]; } catch { /* not loaded */ }
    });
    return require('../routes').buildPublicMounts();
  });
  const express = require('express');
  const app = express();
  app.use(express.json());
  mounts.forEach(({ path, router }) => app.use(path, router));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

const call = (method, path, key) => fetch(`${base}${path}`, {
  method,
  headers: { 'x-api-key': key, 'content-type': 'application/json' },
  body: method === 'POST' ? '{}' : undefined,
});

test('rule 6: the Roostview key reads the catalogue, a property, its availability and quotes', async () => {
  for (const [method, path] of [
    ['GET', '/public/v1/properties'], ['GET', '/public/v1/properties/1'], ['GET', '/public/v1/properties/1/options'],
    ['GET', '/public/v1/properties/1/resources'], ['GET', '/public/v1/properties/1/availability?from=2027-01-01'],
    ['POST', '/public/v1/quote'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await call(method, path, 'rv-key-mounted')).status, 200, `${method} ${path}`);
  }
});

test('rule 6: everything else answers 403 to it, and the site key keeps the whole tree', async () => {
  for (const [method, path] of [['POST', '/public/v1/booking-requests'], ['GET', '/public/v1/booking-requests/challenge'], ['GET', '/public/v1/terms/current'], ['POST', '/public/v1/properties']]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await call(method, path, 'rv-key-mounted');
    assert.equal(r.status, 403, `${method} ${path}`);
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await r.json()).error.code, 'FORBIDDEN');
  }
  assert.equal((await call('POST', '/public/v1/booking-requests', 'site-key-mounted')).status, 201);
});
