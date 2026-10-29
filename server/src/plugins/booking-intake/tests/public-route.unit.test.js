// specs/booking-extranet-intake.md rules 1, 2 and 7 — the public door authenticates itself, in constant
// time, before reading anything; it is rate-limited, size-limited and never logs the page; an inactive
// plugin answers 404; the admin routes hand out the script and rotate the secret.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const { publicRouter, adminRouter, secretMatches, MAX_PAGE_BYTES } = require('../routes');
const requirePlugin = require('../../../middleware/requirePlugin');

const SECRET = 's3cret-value';

async function serve({ live = true, perMinute = 100, secret = () => SECRET, handlePage = () => ({ status: 'applied', message: 'ok' }), log } = {}) {
  const app = express();
  // The same body parser as index.js: capped at 256 kB, raw bytes kept.
  app.use(express.json({ limit: '256kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/public/booking-intake', requirePlugin('booking-intake', { isActive: () => live }), publicRouter({ secret, handlePage, perMinute, log }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/public/booking-intake/page`;
  const post = (body, headers = { 'X-Booking-Intake-Key': SECRET }) => fetch(base, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { post, close: () => new Promise((resolve) => server.close(resolve)) };
}

const PAGE = { v: 1, hotelId: '14407976', resId: '6300000001', text: 'Numéro de réservation' };

test('specs/booking-extranet-intake.md rule 7: the right secret reaches the handler and its answer comes back', async () => {
  const s = await serve({ handlePage: (page) => ({ status: 'applied', message: `fiche pour ${page.resId}` }) });
  const res = await s.post(PAGE);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'applied', message: 'fiche pour 6300000001' });
  await s.close();
});

test('specs/booking-extranet-intake.md rule 7: a wrong or missing secret is a bare 401 and the handler is never called', async () => {
  let called = 0;
  const s = await serve({ handlePage: () => { called += 1; return {}; } });
  for (const headers of [{ 'X-Booking-Intake-Key': 'nope' }, {}]) {
    const res = await s.post(PAGE, headers);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'UNAUTHORIZED' });
  }
  assert.equal(called, 0);
  await s.close();
});

test('specs/booking-extranet-intake.md rule 7: with no secret generated yet nobody gets in', async () => {
  const s = await serve({ secret: () => '' });
  assert.equal((await s.post(PAGE, { 'X-Booking-Intake-Key': '' })).status, 401);
  await s.close();
});

test('specs/booking-extranet-intake.md rule 7: the comparison is constant-time on equal-length digests', () => {
  assert.equal(secretMatches('abc', 'abc'), true);
  assert.equal(secretMatches('abc', 'abd'), false);
  assert.equal(secretMatches('a', 'abcdefghijklmnop'), false);
  const source = require('fs').readFileSync(require.resolve('../routes'), 'utf8');
  assert.match(source, /timingSafeEqual/);
});

test('specs/booking-extranet-intake.md rule 7: 30 requests a minute, counted before the secret is checked', async () => {
  const s = await serve({ perMinute: 3 });
  const codes = [];
  for (let i = 0; i < 5; i += 1) codes.push((await s.post(PAGE, { 'X-Booking-Intake-Key': 'guess' })).status);
  assert.deepEqual(codes, [401, 401, 401, 429, 429]);
  assert.equal(require('../routes').REQUESTS_PER_MINUTE, 30);
  await s.close();
});

test('specs/booking-extranet-intake.md rule 7: a page over 128 kB is refused, an incomplete request is a 400', async () => {
  const s = await serve();
  const big = await s.post({ ...PAGE, text: 'x'.repeat(MAX_PAGE_BYTES + 10) });
  assert.equal(big.status, 413);
  assert.equal((await s.post({ v: 1, hotelId: '1' })).status, 400);
  await s.close();
});

test('specs/booking-extranet-intake.md rule 7: an error inside the handler is a 500 with no detail, and the log never holds the page', async () => {
  const lines = [];
  const s = await serve({ handlePage: () => { throw new Error('boom'); }, log: (line) => lines.push(line) });
  const res = await s.post({ ...PAGE, text: 'Détails de la réservation PRIVATE-GUEST-NAME' });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { status: 'refused', message: 'Erreur interne de GuestFlow' });
  assert.deepEqual(lines, ['intake failed: boom']);
  assert.doesNotMatch(lines.join(''), /PRIVATE-GUEST-NAME/);
  await s.close();
});

test('specs/booking-extranet-intake.md rule 1: an inactive plugin answers 404 on the public route, secret or not', async () => {
  const s = await serve({ live: false });
  const res = await s.post(PAGE);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'PLUGIN_INACTIVE', plugin: 'booking-intake' });
  await s.close();
});

test('specs/booking-extranet-intake.md rule 2: the admin routes serve the script, refuse it without a public URL, and rotate the secret', async () => {
  let regenerated = 0;
  const app = express();
  app.use('/api/booking-intake', adminRouter({
    service: () => ({}), pending: () => [], dismissFiche: () => {}, intakeLog: () => [],
    userscript: () => (process.env.NO_URL ? { ok: false, error: 'URL publique non renseignée' } : { ok: true, source: '// ==UserScript==' }),
    regenerateSecret: () => { regenerated += 1; },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/booking-intake`;
  const ok = await fetch(`${base}/userscript.user.js`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /javascript/);
  process.env.NO_URL = '1';
  assert.equal((await fetch(`${base}/userscript.user.js`)).status, 409);
  delete process.env.NO_URL;
  assert.equal((await fetch(`${base}/secret/regenerate`, { method: 'POST' })).status, 200);
  assert.equal(regenerated, 1);
  await new Promise((resolve) => server.close(resolve));
});
