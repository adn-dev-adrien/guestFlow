// specs/plugins-phase-3a-online-payment.md rules 30, 31 and 32 (audit R3 P1 and R3-2): a converted devis's
// links belong to the stay; a second payment of the same money is a double payment, whoever owns the link.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const devisModel = require('../models/devisModel');
const { processPaidLink, retryPendingCancellations } = require('../utils/paymentPollRunner');
const { ensurePaymentLink, resolveRequestType, sendPaymentRequest } = require('../utils/paymentRequestService');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gite')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'J', 'D', 'j@x.fr')").run();
  const dv = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults, finalPrice, depositAmount, balanceAmount, devisStatus)
    VALUES ('devis', 1, 1, '2027-05-10', '2027-05-14', 1, 455.36, 100, 355.36, 'draft')`).run().lastInsertRowid);
  const links = paymentLinksModel.buildModel(db);
  const dm = devisModel.buildModel(db);
  const F = links.create({ reservationId: dv, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'F', url: 'u', status: 'open' });
  const rid = dm.convertToReservation(dv).data.reservationId;
  let n = 0;
  const provider = { id: 'qonto', async createLink() { n += 1; return { id: `N${n}`, url: `un${n}`, status: 'open' }; }, async getPayment() { return { paid: false }; }, async cancelLink() {} };
  const resolveAmountCents = (id, type, r) => Math.round((type === 'deposit' ? Number(r.depositAmount) : Number(r.depositAmount) + Number(r.balanceAmount)) * 100);
  const calls = [];
  const common = { database: db, devisModel: dm, paymentLinksModel: links, sendConfirmation: async (id) => calls.push(['confirm', id]),
    notifyPaidAfterCancel: async (x, o) => calls.push(['alert', x.id, o]), emitPluginEvent: () => {} };
  const deps = { database: db, paymentLinksModel: links, provider, resolveAmountCents };
  const pay = (id, at = '2027-04-01T10:00:00Z') => processPaidLink({ ...common, link: links.findById(id), paidPayment: { paid: true, paymentId: `p${id}`, paidAt: at } });
  // Both links still open: the webhook of the second arrives before any retirement (live path).
  const payLive = (id, at = '2027-04-01T12:00:00Z') => processPaidLink({
    ...common, paymentLinksModel: Object.assign(Object.create(links), { retireSettled: () => [] }),
    link: links.findById(id), paidPayment: { paid: true, paymentId: `p${id}`, paidAt: at },
  });
  // The second link was retired by the first payment; the provider reports it paid.
  const payRetired = async (id, at = '2027-04-01T12:00:00Z') => {
    const provider = { id: 'qonto', async getPayment() { return { paid: true, paymentId: `p${id}`, paidAt: at }; }, async cancelLink() {} };
    const { results } = await retryPendingCancellations({ ...common, provider });
    return results.find((x) => x.id === id);
  };
  const refunds = () => db.prepare("SELECT COUNT(*) n FROM reservation_history WHERE changedFields LIKE '%refundOwed%'").get().n;
  return { db, links, dv, rid, F, provider, deps, calls, pay, payLive, payRetired, refunds, common };
}

test('rule 30: the fiche lists, reuses and does not remint the converted devis link', async () => {
  const { links, rid, F, deps } = seed();
  assert.deepEqual(links.listForStay(rid).map((l) => l.id), [F.id]);
  const again = await ensurePaymentLink(deps, rid, 'full');
  assert.equal(again.reused, true);
  assert.equal(again.id, F.id);
});

test('rule 30: an acompte request on the stay retires the devis full link', async () => {
  const { links, rid, F, deps } = seed();
  const d = await ensurePaymentLink(deps, rid, 'deposit');
  assert.equal(d.reused, false);
  assert.notEqual(links.findById(F.id).status, 'open');
});

for (const [mode, label] of [['payLive', 'both links open (webhook before the poll)'], ['payRetired', 'the first payment retired the other link']]) {
  test(`rule 31: main repro, devis full link paid after a stay full link, ${label}`, async () => {
    const s = seed();
    const F2 = s.links.create({ reservationId: s.rid, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'F2', url: 'u2', status: 'open' });
    const first = await (mode === 'payLive' ? s.payLive : s.pay)(F2.id, '2027-04-01T10:00:00Z');
    assert.equal(first.effect, 'balance-marked');
    const second = await s[mode](s.F.id);
    assert.equal(second.effect, 'double-payment');
    assert.equal(s.refunds(), 1);
    assert.ok(s.calls.some((c) => c[0] === 'alert' && c[1] === s.F.id));
  });

  test(`rule 31: reverse order, stay full link paid after the devis full link, ${label}`, async () => {
    const s = seed();
    const F2 = s.links.create({ reservationId: s.rid, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'F2', url: 'u2', status: 'open' });
    await (mode === 'payLive' ? s.payLive : s.pay)(s.F.id, '2027-04-01T10:00:00Z');
    const second = await s[mode](F2.id);
    assert.equal(second.effect, 'double-payment');
    assert.equal(s.refunds(), 1);
    assert.ok(s.calls.some((c) => c[0] === 'alert' && c[1] === F2.id));
  });

  test(`rule 31: acompte variant, the devis full link paid after the stay acompte link, ${label}`, async () => {
    const s = seed();
    const D = s.links.create({ reservationId: s.rid, type: 'deposit', amountCents: 10000, provider: 'qonto', providerLinkId: 'D', url: 'ud', status: 'open' });
    await (mode === 'payLive' ? s.payLive : s.pay)(D.id, '2027-04-01T10:00:00Z');
    const second = await s[mode](s.F.id);
    assert.equal(second.effect, 'double-payment');
    assert.equal(second.duplicateCents, 10000);
    assert.equal(s.refunds(), 1);
    assert.ok(s.calls.some((c) => c[0] === 'alert' && c[1] === s.F.id));
  });
}

test('rule 31: a paid link retires the other open link at once', async () => {
  const s = seed();
  const F2 = s.links.create({ reservationId: s.rid, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'F2', url: 'u2', status: 'open' });
  await s.pay(F2.id);
  assert.equal(s.links.findById(s.F.id).status, 'cancelled');
});

test('rule 31: same-day variant, the retired devis link paid after the poll is a double payment', async () => {
  const s = seed();
  const F2 = s.links.create({ reservationId: s.rid, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'F2', url: 'u2', status: 'open' });
  await s.pay(F2.id, '2027-04-01T10:00:00Z');
  assert.equal(s.links.findById(s.F.id).status, 'cancelled');
  const provider = { id: 'qonto', async getPayment() { return { paid: true, paymentId: 'pF', paidAt: '2027-04-01T12:00:00Z' }; }, async cancelLink() {} };
  const { results } = await retryPendingCancellations({ ...s.common, provider });
  const r = results.find((x) => x.id === s.F.id);
  assert.equal(r.effect, 'double-payment');
  assert.equal(s.refunds(), 1);
  assert.ok(s.calls.some((c) => c[0] === 'alert' && c[1] === s.F.id));
});

test('rule 32: constructor, __proto__ and toString are refused as a link type', async () => {
  const { deps, rid, db } = seed();
  for (const t of ['constructor', '__proto__', 'toString']) {
    assert.equal(resolveRequestType({ depositAmount: 1 }, t), null);
    await assert.rejects(ensurePaymentLink(deps, rid, t), (e) => e.httpStatus === 400 && e.error === 'INVALID_TYPE');
    const res = await sendPaymentRequest({ ...deps, database: db }, rid, t);
    assert.equal(res.httpStatus, 400);
    assert.equal(res.body.error, 'INVALID_TYPE');
  }
});

test('rule 31: a solde link paid after a full link already paid on the stay is a double payment', async () => {
  const s = seed();
  await s.pay(s.F.id);
  const B = s.links.create({ reservationId: s.rid, type: 'balance', amountCents: 35536, provider: 'qonto', providerLinkId: 'B', url: 'ub', status: 'open' });
  const second = await s.payLive(B.id);
  assert.equal(second.effect, 'double-payment');
  assert.equal(s.refunds(), 1);
});

test('rule 30: listForStay (the installments plan guard source) sees the converted devis open links', () => {
  const { links, rid, F } = seed();
  assert.deepEqual(links.listForStay(rid).filter((l) => l.status === 'open').map((l) => l.id), [F.id]);
});

test('rule 33: retryPendingCancellations with `only` settles that link and no other', async () => {
  const s = seed();
  const F2 = s.links.create({ reservationId: s.rid, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'F2', url: 'u2', status: 'open' });
  await s.pay(F2.id);
  const seen = [];
  const provider = { id: 'qonto', async getPayment(id) { seen.push(id); return { paid: true, paymentId: 'x', paidAt: '2027-04-01T12:00:00Z' }; }, async cancelLink() {} };
  const { results } = await retryPendingCancellations({ ...s.common, provider, only: 999 });
  assert.deepEqual(results, []);
  assert.deepEqual(seen, []);
  const r = await retryPendingCancellations({ ...s.common, provider, only: s.F.id });
  assert.equal(r.results[0].effect, 'double-payment');
});

test('rule 34: a link retired during the pass is not overwritten by the provider status', async () => {
  const s = seed();
  const F2 = s.links.create({ reservationId: s.rid, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'F2', url: 'u2', status: 'open' });
  const { runPaymentPoll } = require('../utils/paymentPollRunner');
  const provider = {
    id: 'qonto', async getPayment(pid) {
      if (pid === 'F2') { await s.pay(F2.id); return { paid: false }; }
      return { paid: false };
    },
    async getLinkStatus() { return 'expired'; }, async cancelLink() {},
  };
  const links = s.links;
  // F is listed first; paying F2 retires it before its turn.
  const orig = links.listPollable;
  links.listPollable = (o) => orig(o).sort((a, b) => (a.id === F2.id ? -1 : 1));
  await runPaymentPoll({ ...s.common, provider, force: true });
  links.listPollable = orig;
  assert.equal(links.findById(s.F.id).status, 'cancelled');
  assert.ok(links.findById(s.F.id).remoteCancelPendingAt);
});

test('rule 35: a stale full link paid after the acompte still books its shortfall', async () => {
  const s = seed();
  s.db.prepare('UPDATE reservations SET depositPaid = 1 WHERE id = ?').run(s.rid);
  s.db.prepare('UPDATE reservations SET finalPrice = 500, balanceAmount = 400 WHERE id = ?').run(s.rid);
  const stale = s.links.create({ reservationId: s.rid, type: 'full', amountCents: 45536, provider: 'qonto', providerLinkId: 'S', url: 'us', status: 'open' });
  const out = await s.payLive(stale.id);
  assert.notEqual(out.effect, 'double-payment', 'the amount-change booking comes first');
});
