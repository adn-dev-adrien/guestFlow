/**
 * utils/autoSendPolicy — the single predicate guarding every automatic guest email
 * (specs/no-automatic-email-without-approval.md §3 rule 1, specs/settings-rationalization.md
 * rule 17b: a template's own mode is the only switch).
 *
 * The behaviour that matters here is what happens when the answer is UNCLEAR: a missing template, a
 * partially-migrated row, a read that throws. All of those must read as « not allowed ». A wrong
 * `false` delays an email; a wrong `true` mails a guest behind the operator's back.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { templateAutoSends, stableKeyAutoSends, anyTemplateAutoSends } = require('../utils/autoSendPolicy');

test('an enabled « auto » template sends by itself', () => {
  assert.equal(templateAutoSends({ enabled: 1, sendMode: 'auto' }), true);
  assert.equal(templateAutoSends({ enabled: true, sendMode: 'auto' }), true);
});

test('« manual », disabled or missing templates never send by themselves', () => {
  assert.equal(templateAutoSends({ enabled: 1, sendMode: 'manual' }), false);
  assert.equal(templateAutoSends({ enabled: 0, sendMode: 'auto' }), false);
  assert.equal(templateAutoSends({ enabled: false, sendMode: 'auto' }), false);
  assert.equal(templateAutoSends({ sendMode: 'auto' }), false, 'no enabled flag reads as disabled');
  assert.equal(templateAutoSends(null), false);
  assert.equal(templateAutoSends(undefined), false);
});

test('a template looked up by stable key: auto → yes, manual / unknown / throwing → no', () => {
  const model = {
    findByStableKey: (key) => ({
      reservation_confirmation: { enabled: 1, sendMode: 'auto' },
      arrival_reminder_7d: { enabled: 1, sendMode: 'manual' },
    })[key] || null,
  };
  assert.equal(stableKeyAutoSends(model, 'reservation_confirmation'), true);
  assert.equal(stableKeyAutoSends(model, 'arrival_reminder_7d'), false);
  assert.equal(stableKeyAutoSends(model, 'unknown'), false);
  assert.equal(stableKeyAutoSends({ findByStableKey: () => { throw new Error('boom'); } }, 'x'), false);
});

test('the daily pass has work only while one enabled template is « auto »', () => {
  assert.equal(anyTemplateAutoSends({ listEnabled: () => [{ enabled: 1, sendMode: 'manual' }] }), false);
  assert.equal(anyTemplateAutoSends({ listEnabled: () => [] }), false);
  assert.equal(anyTemplateAutoSends({
    listEnabled: () => [{ enabled: 1, sendMode: 'manual' }, { enabled: 1, sendMode: 'auto' }],
  }), true);
  assert.equal(anyTemplateAutoSends({ listEnabled: () => { throw new Error('boom'); } }), false);
  assert.equal(anyTemplateAutoSends(null), false);
});
