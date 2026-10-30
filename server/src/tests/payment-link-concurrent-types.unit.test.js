// specs/payment-link-lifecycle.md rule 8 and specs/plugins-phase-3a-online-payment.md rule 7 (review of
// #897) — an acompte link and a full link settle the same acompte: two requests of those types started at
// the same moment for one stay end with a single payable link, and the link a caller got back is the one
// still open, never one the other request deactivated.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, fakeProvider } = require('./paymentLinkLifecycleFixture');
const { ensurePaymentLink } = require('../utils/paymentRequestService');

const NOW = new Date('2026-11-02T08:00:00Z');
const tick = () => new Promise((resolve) => setImmediate(resolve));

// createLink answers after `delays[n]` turns of the event loop, so the two mints interleave.
function slowProvider(delays) {
  const provider = fakeProvider();
  const fast = provider.createLink;
  let n = 0;
  provider.createLink = async (args, opts) => {
    const turns = delays[n++] || 0;
    for (let i = 0; i < turns; i += 1) await tick();
    return fast(args, opts);
  };
  return provider;
}

for (const [label, delays] of [['the acompte answers first', [1, 4]], ['the full link answers first', [4, 1]]]) {
  test(`rule 8 — an acompte request and a full request at the same moment: one link open (${label})`, async () => {
    const { db, links } = seedDb();
    const id = addStay(db);
    const provider = slowProvider(delays);
    const deps = { database: db, paymentLinksModel: links, provider, resolveAmountCents: (_i, type) => (type === 'full' ? 30000 : 9000), now: () => NOW };
    const [deposit, full] = await Promise.all([ensurePaymentLink(deps, id, 'deposit'), ensurePaymentLink(deps, id, 'full')]);
    const open = db.prepare("SELECT id, type FROM payment_links WHERE reservationId = ? AND status = 'open'").all(id);
    assert.equal(open.length, 1, JSON.stringify(open));
    const returned = [deposit, full].map((l) => links.findById(l.id).status);
    assert.equal(returned.filter((s) => s === 'open').length, 1, 'one caller holds the open link');
    assert.equal(open[0].id, [deposit, full].find((l) => links.findById(l.id).status === 'open').id);
  });
}
