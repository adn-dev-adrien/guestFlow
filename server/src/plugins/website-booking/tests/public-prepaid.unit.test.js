// SDK 2.33.0 (specs/mixed-method-payments.md rule 51, specs/gift-vouchers.md rules 36-38) — what this plugin does with the opaque
// `prepaid` field of the public quote and booking request: it reads it, never interprets it, and shapes what the page shows. The
// plugin names no instrument (a made-up « storedCredit » below); the amounts are the server's, acompte first.
require('./isolatedDb');
const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('../../sdk/registry');
const { createContext } = require('../../sdk/createContext');
const publicPrepaid = require('../publicPrepaid');

function liveSource() {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  createContext('credit-plugin', {}).prepaid({
    source: 'storedCredit', label: 'Crédit', apply: () => ({ ok: true }), held: () => null, settle: () => null, release: () => {},
  });
}

test('read: absent is null, a kind nobody declared is refused, a declared kind is passed on untouched', () => {
  liveSource();
  assert.equal(publicPrepaid.read({}), null);
  assert.equal(publicPrepaid.read({ prepaid: null }), null);
  assert.deepEqual(publicPrepaid.read({ prepaid: { kind: 'other', code: 'x' } }), { error: 'PREPAID_UNAVAILABLE' });
  assert.deepEqual(publicPrepaid.read({ prepaid: 'storedCredit' }), { error: 'PREPAID_UNAVAILABLE' });
  assert.deepEqual(publicPrepaid.read({ prepaid: [{ kind: 'storedCredit' }] }), { error: 'PREPAID_UNAVAILABLE' });
  const field = { kind: 'storedCredit', code: 'ABC', anything: 1 };
  assert.equal(publicPrepaid.read({ prepaid: field }), field);
  registry.configure({ isActive: () => false, allows: () => true });
  assert.deepEqual(publicPrepaid.read({ prepaid: field }), { error: 'PREPAID_UNAVAILABLE' }, 'a plugin switched off is no means of payment');
});

test('amounts: the earliest amounts first — 50 € on an 80,40 € acompte leaves 30,40 € today; in total mode the whole stay less the hold', () => {
  const stay = { depositCents: 8040, balanceCents: 18760 };
  assert.deepEqual(publicPrepaid.amounts({ ...stay, mode: 'deposit', heldCents: 5000 }), { appliedCents: 5000, dueTodayCents: 3040 });
  assert.deepEqual(publicPrepaid.amounts({ ...stay, mode: 'deposit', heldCents: 8040 }), { appliedCents: 8040, dueTodayCents: 0 });
  assert.deepEqual(publicPrepaid.amounts({ ...stay, mode: 'deposit', heldCents: 30000 }), { appliedCents: 26800, dueTodayCents: 0 }, '300 € on a 268 € stay: 268 € applied');
  assert.deepEqual(publicPrepaid.amounts({ ...stay, mode: 'full', heldCents: 10000 }), { appliedCents: 10000, dueTodayCents: 16800 });
  assert.deepEqual(publicPrepaid.amounts({ ...stay, mode: 'full', heldCents: 0 }), { appliedCents: 0, dueTodayCents: 26800 });
});

test('projection and refusal: what the page shows and the figures that go with a refusal', () => {
  const answer = { label: 'Crédit', display: { label: 'Crédit ····42', balanceCents: 30000 } };
  assert.deepEqual(publicPrepaid.projection(answer, { appliedCents: 26800, dueTodayCents: 0 }), {
    label: 'Crédit ····42', appliedCents: 26800, dueTodayCents: 0, balanceLeftCents: 3200,
  });
  assert.equal(publicPrepaid.projection({ label: 'Crédit' }, { appliedCents: 1, dueTodayCents: 2 }).balanceLeftCents, null);
  const refused = publicPrepaid.refusal({
    code: 'VOUCHER_UNKNOWN', message: 'Code inconnu.', triesLeft: 3, balanceCents: 0, ignored: true,
  });
  assert.deepEqual(refused, {
    code: 'VOUCHER_UNKNOWN', message: 'Code inconnu.', balanceCents: 0, triesLeft: 3,
  });
  assert.deepEqual(publicPrepaid.refusalDetails({ code: 'X', message: 'm' })[0], { field: 'prepaid', issue: 'X', code: 'X', message: 'm' });
});
