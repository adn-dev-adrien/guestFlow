// specs/self-update-and-releases.md rule 44 (audit r2 N1): an unset release public key is announced at
// boot and kept as a host alert until it is configured.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeContext } = require('./helpers');
const { checkReleaseSigning, ALERT_KEY } = require('../utils/releaseSigningCheck');

test('rule 44: no release public key → a [security] log line and an open host alert shown on the home page', () => {
  const { ctx } = makeContext();
  const lines = [];
  assert.equal(checkReleaseSigning({ env: {}, hostAlerts: ctx.hostAlerts, log: (m) => lines.push(m) }), false);
  assert.match(lines.join('\n'), /^\[security\] GUESTFLOW_RELEASE_PUBLIC_KEY is not set/);
  assert.deepEqual(ctx.hostAlerts.list().map((a) => a.key), [ALERT_KEY]);
  assert.ok(ctx.controllers.alerts.list().alerts.some((a) => /Versions non signées/.test(a.text)));
  checkReleaseSigning({ env: { GUESTFLOW_RELEASE_PUBLIC_KEY: '   ' }, hostAlerts: ctx.hostAlerts, log: () => {} });
  assert.equal(ctx.hostAlerts.list().length, 1, 'opening twice keeps one alert');
});

test('rule 44: configuring the key closes the alert and logs nothing', () => {
  const { ctx } = makeContext();
  checkReleaseSigning({ env: {}, hostAlerts: ctx.hostAlerts, log: () => {} });
  const lines = [];
  assert.equal(checkReleaseSigning({ env: { GUESTFLOW_RELEASE_PUBLIC_KEY: 'MCow' }, hostAlerts: ctx.hostAlerts, log: (m) => lines.push(m) }), true);
  assert.deepEqual(lines, []);
  assert.deepEqual(ctx.hostAlerts.list(), []);
});
