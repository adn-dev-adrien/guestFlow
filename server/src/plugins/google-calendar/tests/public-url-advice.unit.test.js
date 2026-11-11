// specs/settings-one-save-and-automatic-webhook.md rule 16 (audit R25-C3, 2026-11-06) — the Google consent refused for a
// missing public address names the page that holds it, Paramètres → Système, never « Paramètres » alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.GUESTFLOW_ENCRYPTION_KEY = process.env.GUESTFLOW_ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
const { buildController } = require('../controller');

test('rule 16 — no public address: the refusal names Paramètres → Système', () => {
  const oauthFactory = () => ({ isConfigured: () => true, resolveRedirectUri: () => '' });
  const c = buildController({ settings: {}, oauthFactory, sync: {} });
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  c.oauthAuthorize({ session: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PUBLIC_URL_MISSING');
  assert.match(res.body.message, /\(Paramètres → Système\)/);
});
