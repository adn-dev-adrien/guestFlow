// specs/security-hardening.md rule 12 — the production CSP lets the client forms reach the commune
// lookup they use, and nothing else (review 2026-10-18, F7: the city list stayed empty in production).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildHelmetOptions } = require('../utils/securityConfig');

test('rule 12 — connect-src is self plus the exact commune lookup origin', () => {
  const { directives } = buildHelmetOptions({ isProduction: true, httpsEnabled: false }).contentSecurityPolicy;
  assert.deepEqual(directives.connectSrc, ["'self'", 'https://geo.api.gouv.fr']);
});

test('rule 12 — every cross-origin fetch of the client forms targets an allowed origin', () => {
  const { directives } = buildHelmetOptions({ isProduction: true, httpsEnabled: true }).contentSecurityPolicy;
  const allowed = directives.connectSrc.filter((o) => o.startsWith('https://'));
  for (const page of ['ReservationPage.jsx', 'ClientsPage.jsx']) {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'client', 'src', 'pages', page), 'utf8');
    const origins = [...source.matchAll(/fetch\(`(https:\/\/[^/`]+)/g)].map((m) => m[1]);
    assert.ok(origins.length > 0, `${page} still fetches the commune lookup`);
    for (const origin of origins) assert.ok(allowed.includes(origin), `${page}: ${origin} is allowed by connect-src`);
  }
});
