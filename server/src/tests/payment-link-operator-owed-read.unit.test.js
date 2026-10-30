// specs/payment-link-lifecycle.md rule 42 (re-review of #902, L6) — a link withdrawn by hand whose deactivation is
// still owed (provider disconnected at the withdrawal) is read before a new link of its bucket is minted: paid
// before its withdrawal, it is booked and the request refused; unpaid, the new link is minted.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, addLink, fakeProvider } = require('./paymentLinkLifecycleFixture');
const { ensurePaymentLink } = require('../utils/paymentRequestService');
const { withdrawPaymentLink } = require('../utils/paymentLinkWithdrawal');
const { localIsoDate } = require('../utils/localDate');

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };

async function withdrawnOffline() {
  const { db, links } = seedDb();
  const id = addStay(db, { startDate: inDays(40), endDate: inDays(43) });
  const link = addLink(links, db, id, { type: 'deposit' });
  const at = new Date();
  await withdrawPaymentLink(link.id, { database: db, paymentLinksModel: links, provider: null, bookPaid: async () => {}, now: at });
  return { db, links, id, link, at };
}

test('rule 42 (L6): paid before the withdrawal → read before the mint, booked, the request refused, no second link', async () => {
  const { db, links, id, link, at } = await withdrawnOffline();
  const provider = fakeProvider({ paid: true, paidAt: new Date(at.getTime() - 60 * 1000).toISOString() });
  const booked = [];
  const deps = {
    database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 9000,
    paymentEffect: () => ({ emitPluginEvent: () => {}, recordPayment: (p) => booked.push(p), sendConfirmation: async () => {} }),
  };
  await assert.rejects(ensurePaymentLink(deps, id, 'deposit'), (err) => err.httpStatus === 409 && err.error === 'LINK_ALREADY_PAID');
  assert.equal(links.findById(link.id).status, 'paid');
  assert.ok(!provider.calls.some((c) => c[0] === 'createLink'));
  assert.equal(booked.length, 1);
});

test('rule 42 (L6): unpaid → the new link is minted', async () => {
  const { db, links, id, link } = await withdrawnOffline();
  const provider = fakeProvider();
  const minted = await ensurePaymentLink({ database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 9000 }, id, 'deposit');
  assert.equal(minted.reused, false);
  assert.deepEqual(provider.calls.map((c) => c[0]).slice(0, 1), ['getPayment']);
  assert.equal(links.findById(link.id).status, 'cancelled');
});
