// publicPaymentController (specs/public-online-payment.md §3) — the return-URL allowlist is the
// security-relevant pure bit (open-redirect prevention). The link-creation logic itself is covered by
// payment-request-service.unit.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../controllers/public/publicPaymentController');
const { buildReturnUrl } = __test;

test('buildReturnUrl: builds origin + path when the site origin is configured', () => {
  const prev = process.env.PUBLIC_SITE_ORIGIN;
  process.env.PUBLIC_SITE_ORIGIN = 'https://domainesolio.com/';
  assert.equal(buildReturnUrl('/reservation/merci'), 'https://domainesolio.com/reservation/merci');
  assert.equal(buildReturnUrl(undefined), 'https://domainesolio.com/'); // defaults to '/'
  if (prev === undefined) delete process.env.PUBLIC_SITE_ORIGIN; else process.env.PUBLIC_SITE_ORIGIN = prev;
});

test('buildReturnUrl: rejects a full foreign URL (open-redirect guard) → empty', () => {
  const prev = process.env.PUBLIC_SITE_ORIGIN;
  process.env.PUBLIC_SITE_ORIGIN = 'https://domainesolio.com';
  assert.equal(buildReturnUrl('https://evil.example/phish'), '', 'only a leading-slash path is accepted');
  assert.equal(buildReturnUrl('//evil.example'), '');
  if (prev === undefined) delete process.env.PUBLIC_SITE_ORIGIN; else process.env.PUBLIC_SITE_ORIGIN = prev;
});

test('buildReturnUrl: no configured origin → empty (no redirect)', () => {
  const prev = process.env.PUBLIC_SITE_ORIGIN;
  delete process.env.PUBLIC_SITE_ORIGIN;
  assert.equal(buildReturnUrl('/merci'), '');
  if (prev !== undefined) process.env.PUBLIC_SITE_ORIGIN = prev;
});
