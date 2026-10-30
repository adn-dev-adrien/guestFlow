// specs/payment-link-lifecycle.md rules 1, 2, 13, 16, 22 — the lifecycle pass: one transaction that moves
// every open link whose time is up out of `open` (lapsed → `expired`, withdrawn → `cancelled`), each move
// conditional on `open`; it runs at the start of every poll pass, before the owed deactivations.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, addLink, fakeProvider, spies, HOUR } = require('./paymentLinkLifecycleFixture');
const { retireLapsedAndWithdrawn } = require('../utils/paymentLinkLifecycle');
const { runPaymentPoll } = require('../utils/paymentPollRunner');
const { LINK_REASONS, LAPSED_REASONS } = require('../constants/paymentLinks');

const NOW = new Date('2026-11-02T08:00:00Z');
const pass = (db, links, now = NOW) => retireLapsedAndWithdrawn(db, { now, paymentLinksModel: links });
const stateOf = (links, id) => { const l = links.findById(id); return [l.status, l.cancelReason, Boolean(l.remoteCancelPendingAt)]; };

test('rules 1-2 — two ways out of open: lapsed reasons make `expired`, every other reason `cancelled`', () => {
  assert.deepEqual([...LAPSED_REASONS].sort(), ['stay-started', 'validity']);
  assert.deepEqual(Object.values(LINK_REASONS).sort(), ['amount-changed', 'dates-taken', 'operator', 'orphan', 'settled', 'stay-started', 'superseded', 'validity']);
});

test('rule 13 — an open link of a cancelled stay is withdrawn with no reason (a cancellation), deactivation owed', () => {
  const { db, links } = seedDb();
  const stay = addStay(db, { kind: 'cancelled' });
  const link = addLink(links, db, stay);
  assert.deepEqual(pass(db, links).map((l) => l.id), [link.id]);
  assert.deepEqual(stateOf(links, link.id), ['cancelled', null, true]);
});

test('rule 13 — an open link whose stay row is gone is withdrawn as an orphan', () => {
  const { db, links } = seedDb();
  const link = addLink(links, db, 9999);
  pass(db, links);
  assert.deepEqual(stateOf(links, link.id), ['cancelled', 'orphan', true]);
});

test('rule 13 — a devis link whose converted stay was cancelled is withdrawn', () => {
  const { db, links } = seedDb();
  const cancelled = addStay(db, { kind: 'cancelled' });
  const devis = addStay(db, { kind: 'devis', convertedReservationId: cancelled });
  const link = addLink(links, db, devis, { type: 'full' });
  pass(db, links);
  assert.deepEqual(stateOf(links, link.id), ['cancelled', null, true]);
});

test('rule 13 — a link that never reached the provider is withdrawn without a marker', () => {
  const { db, links } = seedDb();
  const link = addLink(links, db, 9999, { providerLinkId: null });
  pass(db, links);
  assert.deepEqual(stateOf(links, link.id), ['cancelled', 'orphan', false]);
});

test('rule 16 — a withdrawn stay goes first: a past-expiry link of a cancelled stay is withdrawn, not lapsed', () => {
  const { db, links } = seedDb();
  const stay = addStay(db, { kind: 'cancelled', startDate: '2026-10-01' });
  const link = addLink(links, db, stay, { expiresAt: new Date(NOW.getTime() - HOUR) });
  pass(db, links);
  assert.deepEqual(stateOf(links, link.id), ['cancelled', null, true]);
});

test('rule 16 — validity comes before the arrival: a link past both reads `validity`', () => {
  const { db, links } = seedDb();
  const stay = addStay(db, { startDate: '2026-11-01' });
  const link = addLink(links, db, stay, { createdAt: new Date('2026-10-30T08:00:00Z'), expiresAt: new Date('2026-10-31T20:00:00Z') });
  pass(db, links);
  assert.deepEqual(stateOf(links, link.id), ['expired', 'validity', true]);
});

test('rules 16, 22 — only open rows move: a paid, cancelled or expired row is never touched, and a second pass moves nothing', () => {
  const { db, links } = seedDb();
  const stay = addStay(db, { kind: 'cancelled', startDate: '2026-10-01' });
  const paid = addLink(links, db, stay, { status: 'paid', expiresAt: new Date(NOW.getTime() - HOUR) });
  const expired = addLink(links, db, stay, { status: 'expired' });
  const open = addLink(links, db, stay);
  assert.deepEqual(pass(db, links).map((l) => l.id), [open.id]);
  assert.deepEqual(pass(db, links), [], 'idempotent');
  assert.equal(links.findById(paid.id).status, 'paid');
  assert.equal(links.findById(paid.id).remoteCancelPendingAt, null);
  assert.equal(links.findById(expired.id).status, 'expired');
});

test('rule 16 — the moves are one transaction: a failure on the way leaves every link open', () => {
  const { db, links } = seedDb();
  const stay = addStay(db, { kind: 'cancelled' });
  const first = addLink(links, db, stay);
  const second = addLink(links, db, addStay(db), { expiresAt: new Date(NOW.getTime() - HOUR) });
  const broken = { ...links, retireExpired: () => { throw new Error('disk full'); } };
  assert.throws(() => retireLapsedAndWithdrawn(db, { now: NOW, paymentLinksModel: broken }), /disk full/);
  assert.equal(links.findById(first.id).status, 'open');
  assert.equal(links.findById(second.id).status, 'open');
});

test('rule 16 — the poll pass opens with the lifecycle pass: a withdrawn link is deactivated in the same pass, and never polled', async () => {
  const { db, links, devis } = seedDb();
  const stay = addStay(db, { kind: 'cancelled' });
  const link = addLink(links, db, stay);
  const provider = fakeProvider();

  const summary = await runPaymentPoll({ database: db, paymentLinksModel: links, provider, devisModel: devis, now: NOW, force: true, ...spies() });

  assert.equal(summary.retired, 1);
  assert.equal(summary.checked, 0, 'no open link left to poll');
  assert.deepEqual(provider.calls.map((c) => [c[0], c[2] || null]), [['getPayment', 'cancel-link'], ['cancelLink', null]], 'a withdrawn link keeps the read-then-deactivate order (rule 18)');
  assert.deepEqual(stateOf(links, link.id), ['cancelled', null, false]);
});
