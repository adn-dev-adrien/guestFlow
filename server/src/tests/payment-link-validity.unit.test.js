// specs/payment-link-lifecycle.md rules 6-8, 17 — every link GuestFlow mints is valid 36 hours from its
// creation, whatever the provider answers; past that it lapses (`expired`, reason `validity`, deactivation
// owed) without a provider call deciding it; and a request only reuses an open link that still has 24 hours.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, addLink, fakeProvider, HOUR } = require('./paymentLinkLifecycleFixture');
const { ensurePaymentLink, ensureInstallmentLink } = require('../utils/paymentRequestService');
const { validityOf, retireLapsedAndWithdrawn } = require('../utils/paymentLinkLifecycle');
const { PAYMENT_LINK_VALIDITY_HOURS, PAYMENT_LINK_MIN_REMAINING_HOURS } = require('../constants/paymentLinks');

const MINTED = new Date('2026-11-02T08:00:00Z');
const at = (hours) => new Date(MINTED.getTime() + hours * HOUR);

function requestDeps(db, links, provider, now) {
  return { database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 9000, now: () => now };
}

test('rule 6 — a minted link stores createdAt and expiresAt = createdAt + 36 h, ignoring the provider’s zero-time expiry', async () => {
  assert.equal(PAYMENT_LINK_VALIDITY_HOURS, 36);
  const { db, links } = seedDb();
  const id = addStay(db);
  const minted = await ensurePaymentLink(requestDeps(db, links, fakeProvider(), MINTED), id, 'deposit');
  const row = links.findById(minted.id);
  assert.equal(row.createdAt, '2026-11-02 08:00:00', 'written like datetime(\'now\')');
  assert.equal(row.expiresAt, '2026-11-03T20:00:00.000Z');
  assert.equal(minted.expiresAt, '2026-11-03T20:00:00.000Z', 'the mint returns it');
  assert.equal(minted.reused, false);
});

test('rule 6 — an installment link gets the same 36 hours', async () => {
  const { db, links } = seedDb();
  const id = addStay(db);
  const installment = { id: 41, reservationId: id, number: 1, amountCents: 15000, paid: 0 };
  const installmentsModel = { findById: () => installment, listFor: () => [installment, { ...installment, id: 42, number: 2 }] };
  const minted = await ensureInstallmentLink({ ...requestDeps(db, links, fakeProvider(), MINTED), installmentsModel }, id, 41);
  assert.equal(minted.expiresAt, '2026-11-03T20:00:00.000Z');
  assert.equal(links.findById(minted.id).expiresAt, '2026-11-03T20:00:00.000Z');
});

test('rule 7 — past its expiresAt the pass lapses the link: expired, reason validity, deactivation marker, no provider call', () => {
  const { db, links } = seedDb();
  const id = addStay(db);
  const link = addLink(links, db, id, { createdAt: MINTED, expiresAt: at(36) });
  const local = addLink(links, db, id, { type: 'balance', createdAt: MINTED, expiresAt: at(36), providerLinkId: null });

  assert.deepEqual(retireLapsedAndWithdrawn(db, { now: at(35.99), paymentLinksModel: links }), [], 'one minute short of 36 h: still open');
  const moved = retireLapsedAndWithdrawn(db, { now: at(36), paymentLinksModel: links });

  assert.deepEqual(moved.map((l) => l.id), [link.id, local.id]);
  const row = links.findById(link.id);
  assert.equal(row.status, 'expired');
  assert.equal(row.cancelReason, 'validity');
  assert.equal(row.remoteCancelPendingAt, at(36).toISOString(), 'its deactivation is owed (rule 18)');
  assert.equal(links.findById(local.id).remoteCancelPendingAt, null, 'nothing to deactivate without a provider id');
  assert.deepEqual(links.listPollable({ now: at(37), force: true }), [], 'a lapsed link leaves the poll worklist');
});

test('rule 17 — retireExpired is the validity branch: it sets the reason and the marker, and still ignores Qonto’s sentinel', () => {
  const { db, links } = seedDb();
  const id = addStay(db);
  const dated = addLink(links, db, id, { expiresAt: at(-1) });
  const sentinel = links.create({ reservationId: id, type: 'full', amountCents: 30000, providerLinkId: 'pl_zero', url: 'u', expiresAt: '0001-01-01T00:00:00Z' });

  const retired = links.retireExpired({ now: MINTED });

  assert.deepEqual(retired.map((l) => [l.id, l.status, l.cancelReason]), [[dated.id, 'expired', 'validity']]);
  assert.ok(retired[0].remoteCancelPendingAt);
  assert.equal(links.findById(sentinel.id).status, 'open', 'the zero-time sentinel is no expiry');
});

test('rule 8 — a request 11 h after the mint (25 h left) reuses the link, with no provider call', async () => {
  assert.equal(PAYMENT_LINK_MIN_REMAINING_HOURS, 24);
  const { db, links } = seedDb();
  const id = addStay(db);
  const first = await ensurePaymentLink(requestDeps(db, links, fakeProvider(), MINTED), id, 'deposit');
  const provider = fakeProvider();

  const again = await ensurePaymentLink(requestDeps(db, links, provider, at(11)), id, 'deposit');

  assert.equal(again.reused, true);
  assert.equal(again.id, first.id);
  assert.equal(again.expiresAt, first.expiresAt);
  assert.deepEqual(provider.calls, []);
});

test('rule 8 — exactly 24 h left still reuses; 23 h 59 left mints a fresh link and lapses the old one', async () => {
  const { db, links } = seedDb();
  const id = addStay(db);
  const first = await ensurePaymentLink(requestDeps(db, links, fakeProvider(), MINTED), id, 'deposit');
  assert.equal((await ensurePaymentLink(requestDeps(db, links, fakeProvider(), at(12)), id, 'deposit')).reused, true);

  const provider = fakeProvider();
  const now = new Date(at(12).getTime() + 60 * 1000);
  const fresh = await ensurePaymentLink(requestDeps(db, links, provider, now), id, 'deposit');

  assert.equal(fresh.reused, false);
  assert.notEqual(fresh.id, first.id);
  assert.equal(fresh.expiresAt, new Date(now.getTime() + 36 * HOUR).toISOString(), 'the guest gets a full 36 hours');
  const old = links.findById(first.id);
  assert.equal(old.status, 'expired', 'lapsed, not withdrawn');
  assert.equal(old.cancelReason, 'validity');
  assert.equal(old.remoteCancelPendingAt, null, 'deactivated at once');
  assert.deepEqual(provider.calls.map((c) => c[0]), ['getPayment', 'cancelLink', 'createLink'], 'read, deactivate, then mint');
  assert.ok(db.prepare('SELECT lastLookAt FROM payment_links WHERE id = ?').get(first.id).lastLookAt, 'one last look owed (rule 19)');
});

test('rule 8 — a link about to lapse that the guest has just paid refuses the new request: no link minted', async () => {
  const { db, links } = seedDb();
  const id = addStay(db);
  const first = await ensurePaymentLink(requestDeps(db, links, fakeProvider(), MINTED), id, 'deposit');
  const provider = fakeProvider({ paid: true });

  await assert.rejects(ensurePaymentLink(requestDeps(db, links, provider, at(20)), id, 'deposit'), (err) => err.error === 'LINK_ALREADY_PAID');

  assert.equal(links.findById(first.id).status, 'open', 'the paid link is left for the payment path');
  assert.deepEqual(provider.calls.map((c) => c[0]), ['getPayment']);
});

test('rule 8 — a link whose amount drifted is still withdrawn as before (no validity reason)', async () => {
  const { db, links } = seedDb();
  const id = addStay(db);
  const first = await ensurePaymentLink(requestDeps(db, links, fakeProvider(), MINTED), id, 'deposit');
  const fresh = await ensurePaymentLink({ ...requestDeps(db, links, fakeProvider(), at(1)), resolveAmountCents: () => 12000 }, id, 'deposit');
  assert.equal(fresh.reused, false);
  const old = links.findById(first.id);
  assert.equal(old.status, 'cancelled');
  assert.equal(old.cancelReason, null);
});

test('rule 8 — a link with no known end (Qonto’s sentinel) cannot promise 24 hours: never reused', async () => {
  const { db, links } = seedDb();
  const id = addStay(db);
  const legacy = links.create({ reservationId: id, type: 'deposit', amountCents: 9000, providerLinkId: 'pl_legacy', url: 'u', expiresAt: '0001-01-01T00:00:00Z' });
  assert.deepEqual(validityOf(legacy, MINTED), { expiresAt: null, remainingMs: null, lapsed: false, reusable: false });

  const fresh = await ensurePaymentLink(requestDeps(db, links, fakeProvider(), MINTED), id, 'deposit');

  assert.equal(fresh.reused, false);
  assert.equal(links.findById(legacy.id).status, 'expired');
});

test('rule 8 — validityOf reads the remaining time against the injected clock', () => {
  const link = { expiresAt: at(36).toISOString() };
  assert.equal(validityOf(link, at(12)).reusable, true);
  assert.equal(validityOf(link, at(12.5)).reusable, false);
  assert.equal(validityOf(link, at(36)).lapsed, true);
  assert.equal(validityOf(link, at(35)).lapsed, false);
  assert.equal(validityOf(link, at(30)).remainingMs, 6 * HOUR);
});
