// specs/guest-app.md rule 1 — « Régénérer le code QR » issues a new lodging code and the old one is dead at once (it
// answers like an unknown code); rule 48 — the A4 poster of the current code is served as a PDF; rule 11quater — a
// lodging off has no QR code. The code never travels in the JSON.
const test = require('node:test');
const assert = require('node:assert/strict');

const { enable, freshDb, startApi } = require('./guestAppFixtures');
const { lodgingUrl } = require('../qrPoster');

async function withApi(fn, options = { guestHost: 'sejour.example.test' }) {
  const db = freshDb();
  const ctx = await startApi(db, options);
  try {
    await fn({ db, ...ctx });
  } finally {
    await ctx.close();
  }
}

const codeOf = (db, propertyId = 1) => db.prepare('SELECT lodgingCode FROM guest_app_lodgings WHERE propertyId = ?').get(propertyId).lodgingCode;

test('rule 1: regenerating kills the old code at once, the new one opens the lodging', () => withApi(async ({ db, api, call }) => {
  const old = enable(api, db);
  assert.equal((await call('POST', '/public/v1/guest/sessions', { lodgingCode: old })).status, 200);
  const res = await call('POST', '/api/guest-app/lodgings/1/regenerate-qr');
  assert.equal(res.status, 200);
  assert.equal(res.body.hasLodgingCode, true);
  assert.equal(JSON.stringify(res.body).includes(codeOf(db)), false, 'the code is not in the answer');
  const fresh = codeOf(db);
  assert.notEqual(fresh, old);
  assert.match(fresh, /^[A-Za-z0-9_-]{22}$/, '128 bits, base64url');
  const stale = await call('POST', '/public/v1/guest/sessions', { lodgingCode: old }, { cookie: null });
  assert.equal(stale.status, 404);
  assert.equal(stale.body.error.code, 'LODGING_NOT_FOUND', 'like an unknown code');
  assert.equal((await call('GET', `/public/v1/guest/booklet?lodgingCode=${old}`, undefined, { cookie: null })).status, 401, 'the visitor booklet too');
  assert.equal((await call('POST', '/public/v1/guest/sessions', { lodgingCode: fresh }, { cookie: null })).status, 200);
}));

test('rule 11quater: a lodging off or unknown has no code to regenerate nor poster to print', () => withApi(async ({ call }) => {
  assert.equal((await call('POST', '/api/guest-app/lodgings/1/regenerate-qr')).status, 409);
  assert.equal((await call('GET', '/api/guest-app/lodgings/1/qr-poster.pdf')).status, 409);
  assert.equal((await call('POST', '/api/guest-app/lodgings/99/regenerate-qr')).status, 404);
  assert.equal((await call('POST', '/api/guest-app/lodgings/abc/regenerate-qr')).status, 400);
}));

test('rule 48: the poster is an A4 PDF of the lodging\'s current code', () => withApi(async ({ db, api, base }) => {
  enable(api, db);
  const res = await fetch(`${base}/api/guest-app/lodgings/1/qr-poster.pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /attachment; filename="qr-la-granja\.pdf"/);
  const pdf = Buffer.from(await res.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/, 'A4');
  assert.equal(lodgingUrl('sejour.example.test', 'abc'), 'https://sejour.example.test/l/abc', 'the URL the code opens (rule 1)');
}));

test('rule 48: without the guest host the poster cannot say where to go', () => withApi(async ({ db, api, call }) => {
  enable(api, db);
  const res = await call('GET', '/api/guest-app/lodgings/1/qr-poster.pdf');
  assert.equal(res.status, 409);
  assert.match(res.body.error, /adresse de l’application/);
}, { guestHost: null }));
