// specs/plugins-phase-4-registry.md rule 51 (audit r3, N-R3-1) — a plugin whose behaviour rests on a hardening of
// the CORE (the linear e-mail check, the DKIM header refusal, the mailbox reader's caps) asks for the SDK that
// ships it: a core older than that SDK refuses the package instead of running it without the hardening.
const test = require('node:test');
const assert = require('node:assert/strict');

const { readSourceManifest } = require('../plugins/manifest');
const { SDK_VERSION } = require('../plugins/sdk/version');
const { satisfies } = require('../utils/semverRange');
const { skipWithout } = require('../plugins/sdk/testing');

const HARDENED_AT = '2.15.0';
const RELYING = ['website-booking', 'booking-intake', 'airbnb-intake', 'gites-de-france-intake'];

test('rule 51: the SDK that ships the hardenings is at least 2.15.0', () => {
  assert.ok(satisfies(SDK_VERSION, `>=${HARDENED_AT}`), SDK_VERSION);
});

for (const id of RELYING) {
  test(`rule 51: ${id} refuses a core whose SDK predates the hardenings, and loads on this one`, { skip: skipWithout([id]) }, () => {
    const m = readSourceManifest(id);
    assert.equal(satisfies('2.14.0', m.sdk), false, `${id} ${m.sdk} still loads on SDK 2.14.0`);
    assert.equal(satisfies(HARDENED_AT, m.sdk), true, `${id} ${m.sdk}`);
    assert.ok(satisfies(SDK_VERSION, m.sdk));
    assert.ok((m.changelog[m.version] || []).some((line) => /SDK 2\.15/.test(line)), `${id} ${m.version} names SDK 2.15`);
  });
}
