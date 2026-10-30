// specs/payment-link-lifecycle.md rules 14, 15, 18, 19, 21, 22 — a payment made around the 36th hour is
// the stay's money: the webhook books it on a lapsed link, the lifecycle pass deactivates FIRST and reads
// the payment AFTER, and one last look an hour later catches a payment completed after that read. Each link
// costs three provider calls once, and two runs at the same time never act twice.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, addLink, fakeProvider, spies, HOUR, MINUTE } = require('./paymentLinkLifecycleFixture');
const { runLinkLifecycle, runPaymentPoll, processPaidLink } = require('../utils/paymentPollRunner');

const MINTED = new Date('2026-11-02T08:00:00Z');
const EXPIRES = new Date(MINTED.getTime() + 36 * HOUR);
const at = (hours) => new Date(EXPIRES.getTime() + hours * HOUR);

function setup() {
  const { db, links, devis } = seedDb();
  const stay = addStay(db);
  const link = addLink(links, db, stay, { type: 'deposit', createdAt: MINTED, expiresAt: EXPIRES });
  const s = spies();
  const run = (provider, now) => runLinkLifecycle({ database: db, paymentLinksModel: links, provider, devisModel: devis, now, ...s });
  return { db, links, devis, stay, link, s, run };
}

const lastLookOf = (db, id) => db.prepare('SELECT lastLookAt FROM payment_links WHERE id = ?').get(id).lastLookAt;
const depositPaid = (db, id) => db.prepare('SELECT depositPaid FROM reservations WHERE id = ?').get(id).depositPaid;

test('rule 14 — webhook: a lapsed link paid at 35 h 59 is booked and confirmed like any payment; a replay does nothing', async () => {
  const { db, links, devis, stay, link, s } = setup();
  links.retireExpired({ now: at(0.1) });
  assert.equal(links.findById(link.id).status, 'expired');

  const deps = { database: db, devisModel: devis, paymentLinksModel: links, link: links.findById(link.id), paidPayment: { paymentId: 'pay_late', paidAt: '2026-11-03T19:59:00Z' }, ...s };
  const first = await processPaidLink(deps);
  const replay = await processPaidLink(deps);

  assert.equal(first.effect, 'deposit-marked');
  assert.equal(replay.effect, 'already-processed');
  assert.equal(depositPaid(db, stay), 1);
  assert.deepEqual(s.confirmed, [stay], 'confirmed once');
  const row = links.findById(link.id);
  assert.equal(row.status, 'paid');
  assert.equal(row.remoteCancelPendingAt, null, 'markPaid clears the owed deactivation');
});

test('rule 18 — the pass deactivates first, reads after; paid → booked (rule 14), nothing left owed', async () => {
  const { db, links, stay, link, s, run } = setup();
  const provider = fakeProvider({ paid: true });

  const summary = await run(provider, at(0.1));

  assert.deepEqual(provider.calls.map((c) => [c[0], c[2] || null]), [['cancelLink', null], ['getPayment', 'lapsed-link']]);
  assert.equal(summary.results.find((r) => r.id === link.id).effect, 'deposit-marked');
  assert.equal(depositPaid(db, stay), 1);
  assert.deepEqual(s.confirmed, [stay]);
  const row = links.findById(link.id);
  assert.equal(row.status, 'paid');
  assert.equal(row.remoteCancelPendingAt, null);
  assert.equal(lastLookOf(db, link.id), null, 'no last look once paid');
});

test('rules 18-19 — not paid: deactivated, one last look an hour later; paid then → booked; never asked again', async () => {
  const { db, links, stay, link, s, run } = setup();
  const notYet = fakeProvider();
  await run(notYet, at(0.1));
  const row = links.findById(link.id);
  assert.equal(row.status, 'expired');
  assert.equal(row.remoteCancelPendingAt, null, 'deactivation done');
  assert.equal(lastLookOf(db, link.id), new Date(at(0.1).getTime() + 60 * MINUTE).toISOString());

  const early = fakeProvider({ paid: true });
  await run(early, new Date(at(0.1).getTime() + 59 * MINUTE));
  assert.deepEqual(early.calls, [], 'not due yet');

  const look = fakeProvider({ paid: true });
  await run(look, new Date(at(0.1).getTime() + 60 * MINUTE));
  assert.deepEqual(look.calls.map((c) => [c[0], c[2]]), [['getPayment', 'last-look']]);
  assert.equal(links.findById(link.id).status, 'paid');
  assert.equal(depositPaid(db, stay), 1);
  assert.deepEqual(s.confirmed, [stay]);

  const after = fakeProvider({ paid: true });
  await run(after, at(5));
  assert.deepEqual(after.calls, []);
});

test('rule 19 — a last look that finds nothing is the last: the link is never read again', async () => {
  const { db, link, run } = setup();
  await run(fakeProvider(), at(0.1));
  const look = fakeProvider();
  await run(look, at(2));
  assert.equal(look.calls.length, 1);
  assert.equal(lastLookOf(db, link.id), null);
  const later = fakeProvider();
  await run(later, at(48));
  assert.deepEqual(later.calls, []);
});

test('rule 19 — a last look the provider could not answer stays owed for the next pass', async () => {
  const { db, link, run } = setup();
  await run(fakeProvider(), at(0.1));
  await run(fakeProvider({ failPayment: new Error('timeout') }), at(2));
  assert.ok(lastLookOf(db, link.id), 'still owed');
  const retry = fakeProvider();
  await run(retry, at(3));
  assert.equal(retry.calls.length, 1);
  assert.equal(lastLookOf(db, link.id), null);
});

test('rule 18 — a link already dead at the provider (deactivated by hand) is read all the same', async () => {
  const { links, link, run } = setup();
  const provider = fakeProvider({ failCancel: new Error('422 already deactivated'), linkStatus: 'cancelled', paid: true });
  await run(provider, at(0.1));
  assert.deepEqual(provider.calls.map((c) => c[0]), ['cancelLink', 'getLinkStatus', 'getPayment']);
  assert.equal(links.findById(link.id).status, 'paid');
});

test('rule 21 — over its whole life after the lapse, a link costs three provider calls, once; the poll never asks again', async () => {
  const { db, links, devis, s } = setup();
  const provider = fakeProvider();
  for (const hours of [0.1, 0.5, 1.2, 8, 16, 24, 72]) {
    await runPaymentPoll({ database: db, paymentLinksModel: links, provider, devisModel: devis, now: at(hours), ...s });
  }
  assert.deepEqual(provider.calls.map((c) => [c[0], c[2] || null]), [['cancelLink', null], ['getPayment', 'lapsed-link'], ['getPayment', 'last-look']]);
});

test('rule 22 — two runs at the same time deactivate and read once', async () => {
  const { links, link, run } = setup();
  const provider = fakeProvider({ paid: true });
  const [a, b] = await Promise.all([run(provider, at(0.1)), run(provider, at(0.1))]);
  assert.equal(provider.calls.filter((c) => c[0] === 'cancelLink').length, 1);
  assert.equal(provider.calls.filter((c) => c[0] === 'getPayment').length, 1);
  assert.equal(links.findById(link.id).status, 'paid');
  assert.deepEqual(a.results, b.results, 'the second run shares the first one’s retry');
});

test('rule 22 — two passes on a due last look read it once', async () => {
  const { db, links, devis, link, s, run } = setup();
  await run(fakeProvider(), at(0.1));
  const provider = fakeProvider();
  const runOther = () => runLinkLifecycle({ database: db, paymentLinksModel: links, provider, devisModel: devis, now: at(2), ...s });
  await Promise.all([run(provider, at(2)), runOther()]);
  assert.equal(provider.calls.length, 1);
  assert.equal(lastLookOf(db, link.id), null);
});

test('rule 15 — a new link minted while the old one was paid at the deadline: the first payment settles the bucket, the new link is retired', async () => {
  const { db, links, devis, stay, link, s } = setup();
  links.retireExpired({ now: at(0.1) });
  const fresh = addLink(links, db, stay, { type: 'deposit', createdAt: at(0.2), expiresAt: at(36.2) });

  await processPaidLink({ database: db, devisModel: devis, paymentLinksModel: links, link: links.findById(link.id), paidPayment: { paymentId: 'pay_old', paidAt: '2026-11-03T19:59:30Z' }, ...s });

  assert.equal(links.findById(link.id).status, 'paid');
  const second = links.findById(fresh.id);
  assert.equal(second.status, 'cancelled');
  assert.equal(second.cancelReason, 'settled', 'the existing double-payment guard (plugins-phase-3a rule 23)');
});
