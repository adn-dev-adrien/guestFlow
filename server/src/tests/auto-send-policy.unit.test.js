/**
 * utils/autoSendPolicy — the single predicate guarding every automatic guest email
 * (specs/no-automatic-email-without-approval.md §3 rule 1).
 *
 * The behaviour that matters here is what happens when the answer is UNCLEAR: a settings model
 * without the accessor, a database missing the column, a read that throws. All of those must read
 * as « not allowed ». A wrong `false` delays an email; a wrong `true` mails a guest behind the
 * operator's back.
 */

const { test } = require('node:test');
const assert = require('node:assert');

const { autoSendAllowed } = require('../utils/autoSendPolicy');

test('the accessor decides when it exists', () => {
  assert.equal(autoSendAllowed({ emailAutoSendEnabled: () => true }), true);
  assert.equal(autoSendAllowed({ emailAutoSendEnabled: () => false }), false);
});

test('a model without the accessor falls back to the raw column', () => {
  assert.equal(autoSendAllowed({ read: () => ({ emailAutoSendEnabled: 1 }) }), true);
  assert.equal(autoSendAllowed({ read: () => ({ emailAutoSendEnabled: 0 }) }), false);
});

test('anything short of an explicit yes reads as no', () => {
  // A partially-migrated database: the column simply is not there yet.
  assert.equal(autoSendAllowed({ read: () => ({}) }), false);
  assert.equal(autoSendAllowed({ read: () => ({ emailAutoSendEnabled: null }) }), false);
  // A truthy-but-not-1 value is not an authorisation either.
  assert.equal(autoSendAllowed({ read: () => ({ emailAutoSendEnabled: 'yes' }) }), false);
  assert.equal(autoSendAllowed({}), false);
  assert.equal(autoSendAllowed(null), false);
  assert.equal(autoSendAllowed(undefined), false);
});

test('a settings model that throws does not mail the guest', () => {
  assert.equal(autoSendAllowed({ read: () => { throw new Error('db is gone'); } }), false);
  assert.equal(autoSendAllowed({ emailAutoSendEnabled: () => { throw new Error('boom'); } }), false);
});

test('the accessor must return a real boolean, not something truthy', () => {
  // Guards against a model returning the raw 0/1 column from the accessor: `1` is truthy but this
  // predicate demands an unambiguous `true`, so a sloppy accessor fails closed rather than open.
  assert.equal(autoSendAllowed({ emailAutoSendEnabled: () => 1 }), false);
});
