// specs/terms-acceptance-record.md rules 17-18 — the outdated-plugin warning and the closed-booking
// alert of the « Réservation en ligne » card. Moved from terms-publishing.unit.test.js with the card
// (specs/plugins-phase-2-hosts.md rule 25): the verdicts are now computed by the plugin.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildEnforcementController, isVersionBelow } = require('../enforcementController');

function controllerWith({ requireTermsAcceptance = true, lastSeenPluginVersion = '', current = { version: 1 } } = {}) {
  const state = { requireTermsAcceptance, lastSeenPluginVersion };
  return buildEnforcementController({
    settings: {
      termsSettings: () => ({ ...state }),
      setRequireTermsAcceptance: (on) => { state.requireTermsAcceptance = on; },
    },
    currentTerms: () => current,
  });
}

test('rule 18 — plugin version comparison drives the outdated-plugin warning', () => {
  assert.equal(isVersionBelow('1.7.0', '1.8.0'), true);
  assert.equal(isVersionBelow('1.8.0', '1.8.0'), false);
  assert.equal(isVersionBelow('1.10.0', '1.8.0'), false);
  assert.equal(isVersionBelow('0.9.9', '1.8.0'), true);
  assert.equal(controllerWith().view().pluginOutdated, false, 'never seen → no warning');
  assert.equal(controllerWith({ lastSeenPluginVersion: '1.7.0' }).view().pluginOutdated, true);
});

test('rules 16-17 — no published version closes the booking only while the enforcement is on', () => {
  assert.equal(controllerWith({ current: null }).view().bookingClosed, true);
  assert.equal(controllerWith({ current: null, requireTermsAcceptance: false }).view().bookingClosed, false);
  assert.equal(controllerWith().view().bookingClosed, false);
});

test('rule 17 — the switch takes a boolean and answers the refreshed card', () => {
  const controller = controllerWith({ lastSeenPluginVersion: '1.7.0' });
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.update({ body: { requireTermsAcceptance: 'no' } }, res);
  assert.equal(res.statusCode, 400);
  controller.update({ body: { requireTermsAcceptance: false } }, res);
  assert.equal(res.body.requireTermsAcceptance, false);
  assert.equal(res.body.outdatedPluginBlocks, false, 'an outdated plugin no longer blocks once the switch is off');
  assert.equal(res.body.pluginOutdated, true);
});
