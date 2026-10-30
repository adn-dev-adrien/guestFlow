// specs/payment-link-lifecycle.md rule 42 — « Retirer le lien »: the operator withdraws an open link by hand.
// Withdrawn (`cancelled`, reason `operator`) and deactivated at the provider, the marker kept on failure; refused
// when the guest has just paid (the payment is then booked) and on a read-only stay; the ledger offers it.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, addLink, fakeProvider } = require('./paymentLinkLifecycleFixture');
const { withdrawPaymentLink } = require('../utils/paymentLinkWithdrawal');
const { buildLedger } = require('../utils/reservationLedger');
const { localIsoDate } = require('../utils/localDate');

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };

function setup({ kind = 'devis', provider = fakeProvider() } = {}) {
  const { db, links } = seedDb();
  const stayId = addStay(db, { kind, startDate: inDays(40), endDate: inDays(43) });
  const link = addLink(links, db, stayId, { type: 'deposit' });
  const booked = [];
  const deps = { database: db, paymentLinksModel: links, provider, bookPaid: async (l, pay) => { booked.push([l.id, pay.paymentId]); } };
  return { db, links, stayId, link, provider, booked, deps };
}

test('rule 42: an open link is withdrawn for `operator`, ended now, and deactivated at the provider', async () => {
  const { links, link, provider, deps } = setup();
  const now = new Date();
  const { link: after } = await withdrawPaymentLink(link.id, { ...deps, now });
  assert.equal(after.status, 'cancelled');
  assert.equal(after.cancelReason, 'operator');
  assert.equal(after.expiresAt, now.toISOString());
  assert.equal(after.remoteCancelPendingAt, null);
  assert.deepEqual(provider.calls.map((c) => c[0]), ['getPayment', 'cancelLink']);
  assert.equal(links.findById(link.id).status, 'cancelled');
});

test('rule 42: a deactivation the provider refuses keeps the marker for the poll; the withdrawal stands', async () => {
  const { link, deps } = setup({ provider: fakeProvider({ failCancel: new Error('503') }) });
  const { link: after } = await withdrawPaymentLink(link.id, deps);
  assert.equal(after.status, 'cancelled');
  assert.equal(after.cancelReason, 'operator');
  assert.ok(after.remoteCancelPendingAt);
});

test('rule 42: without a declared provider the link is withdrawn with the marker', async () => {
  const { link, deps } = setup();
  const { link: after } = await withdrawPaymentLink(link.id, { ...deps, provider: null });
  assert.equal(after.status, 'cancelled');
  assert.ok(after.remoteCancelPendingAt);
});

test('rule 42: a provider that is not connected is never asked: withdrawn with the marker for the poll', async () => {
  const provider = { ...fakeProvider({ paid: true }), isReady: () => false };
  const { link, deps } = setup({ provider });
  const { link: after } = await withdrawPaymentLink(link.id, deps);
  assert.equal(after.status, 'cancelled');
  assert.ok(after.remoteCancelPendingAt);
  assert.deepEqual(provider.calls, []);
});

test('rule 42: a link the guest has just paid is refused 409 LINK_ALREADY_PAID, stays open, and its payment is booked', async () => {
  const { links, link, provider, booked, deps } = setup({ provider: fakeProvider({ paid: true }) });
  await assert.rejects(withdrawPaymentLink(link.id, deps), (err) => err.httpStatus === 409 && err.error === 'LINK_ALREADY_PAID');
  assert.equal(links.findById(link.id).status, 'open');
  assert.ok(!provider.calls.some((c) => c[0] === 'cancelLink'));
  assert.deepEqual(booked, [[link.id, `pay_${link.providerLinkId}`]]);
});

test('rule 42: an unreadable provider refuses the withdrawal and changes nothing', async () => {
  const { links, link, deps } = setup({ provider: fakeProvider({ failPayment: new Error('timeout') }) });
  await assert.rejects(withdrawPaymentLink(link.id, deps), (err) => err.httpStatus === 502);
  assert.equal(links.findById(link.id).status, 'open');
});

test('rule 42: a paid link answers 409; a link already withdrawn or lapsed is answered as it is', async () => {
  const { db, links, stayId, provider, deps } = setup();
  const paid = addLink(links, db, stayId, { type: 'balance', status: 'paid' });
  await assert.rejects(withdrawPaymentLink(paid.id, deps), (err) => err.error === 'LINK_ALREADY_PAID');
  const lapsed = addLink(links, db, stayId, { type: 'balance', status: 'expired' });
  const { link: same } = await withdrawPaymentLink(lapsed.id, deps);
  assert.equal(same.status, 'expired');
  assert.equal(provider.calls.length, 0);
});

test('rule 42: read-only stays (cancelled, superseded) are refused 409 STAY_READ_ONLY; an unknown link 404', async () => {
  for (const kind of ['cancelled', 'superseded']) {
    const { links, link, deps } = setup({ kind });
    await assert.rejects(withdrawPaymentLink(link.id, deps), (err) => err.httpStatus === 409 && err.error === 'STAY_READ_ONLY');
    assert.equal(links.findById(link.id).status, 'open');
  }
  const { deps } = setup();
  await assert.rejects(withdrawPaymentLink(999, deps), (err) => err.httpStatus === 404);
});

test('rule 42: the link of a devis converted into a cancelled stay is read-only too', async () => {
  const { db, link, deps, stayId } = setup();
  const resa = addStay(db, { kind: 'cancelled', startDate: inDays(40), endDate: inDays(43) });
  db.prepare("UPDATE reservations SET devisStatus = 'converted', convertedReservationId = ? WHERE id = ?").run(resa, stayId);
  await assert.rejects(withdrawPaymentLink(link.id, deps), (err) => err.error === 'STAY_READ_ONLY');
});

// The ledger: « Retirer le lien » on an open link of a fiche or a devis, never on a read-only stay.
const ledgerRow = (over = {}) => ({
  id: 7, kind: 'reservation', platform: 'direct', startDate: inDays(40), endDate: inDays(43),
  depositAmount: 90, balanceAmount: 210, complementAmount: 0, endOfStayComplementAmount: 0,
  depositDueDate: inDays(5), balanceDueDate: inDays(30),
  depositPaid: 0, balancePaid: 0, complementPaid: 0, endOfStayComplementPaid: 0, cautionReceived: 0, cautionReturned: 0,
  ...over,
});
const openLink = { id: 3, type: 'deposit', status: 'open', amountCents: 9000, createdAt: `${inDays(0)} 10:30:00`, expiresAt: null, cancelReason: null };
const depositLinkOf = (row, l = openLink) => buildLedger({ row, links: [l], canRequest: true, today: inDays(0) })
  .rows.find((r) => r.key === 'deposit').detail.link;

test('rule 42: the ledger offers « Retirer le lien » with its confirmation on the open link of a fiche and of a devis', () => {
  for (const kind of ['reservation', 'devis']) {
    assert.deepEqual(depositLinkOf(ledgerRow({ kind })).withdraw, {
      linkId: 3,
      label: 'Retirer le lien',
      confirmTitle: 'Retirer ce lien ?',
      confirmMessage: 'Il ne pourra plus être payé.',
      confirmLabel: 'Retirer',
    });
  }
});

test('rule 42: never on a read-only stay, never on a link that is no longer open', () => {
  assert.equal(depositLinkOf(ledgerRow({ kind: 'cancelled' })).withdraw, undefined);
  assert.equal(depositLinkOf(ledgerRow({ kind: 'superseded' })).withdraw, undefined);
  assert.equal(depositLinkOf(ledgerRow(), { ...openLink, status: 'expired' }).withdraw, undefined);
});

test('rule 42: a link withdrawn by hand reads « Lien retiré le {jour} » and offers « Renvoyer la demande »', () => {
  const at = new Date();
  at.setDate(at.getDate() + 1);
  at.setHours(9, 0, 0, 0);
  const l = depositLinkOf(ledgerRow(), { ...openLink, status: 'cancelled', cancelReason: 'operator', expiresAt: at.toISOString() });
  const day = localIsoDate(at);
  // The year shows only when it is not the stay's (reservation-payment-ledger rule 4).
  const year = day.slice(0, 4) === inDays(40).slice(0, 4) ? '' : `/${day.slice(0, 4)}`;
  assert.equal(l.label, `Lien retiré le ${day.slice(8, 10)}/${day.slice(5, 7)}${year}`);
  assert.deepEqual(l.resend, { type: 'deposit', label: 'Renvoyer la demande' });
  assert.equal(l.withdraw, undefined);
});

// Review of #902 — the withdrawal and its later reads agree with the connected path.
const { retryPendingCancellations } = require('../utils/paymentPollRunner');
const devisModel = require('../models/devisModel');
const { spies } = require('./paymentLinkLifecycleFixture');

test('rule 42 (L2): a link found paid is read once, and the payment of that read is the one booked', async () => {
  const { link, provider, booked, deps } = setup({ provider: fakeProvider({ paid: true }) });
  await assert.rejects(withdrawPaymentLink(link.id, deps), (err) => err.error === 'LINK_ALREADY_PAID');
  assert.deepEqual(provider.calls.map((c) => c[0]), ['getPayment']);
  assert.deepEqual(booked, [[link.id, `pay_${link.providerLinkId}`]]);
});

test('rule 42 (L3): a disconnected provider is named in the log, not « Cannot read properties of null »', async () => {
  const { link, deps } = setup();
  const warned = [];
  const orig = console.warn;
  console.warn = (m) => warned.push(String(m));
  try { await withdrawPaymentLink(link.id, { ...deps, provider: null }); } finally { console.warn = orig; }
  assert.equal(warned.length, 1);
  assert.doesNotMatch(warned[0], /Cannot read properties/);
  assert.match(warned[0], new RegExp(`link ${link.id} .*no connected payment provider`));
});

async function withdrawnWhileDisconnected(paidAt) {
  const { db, links, link, deps } = setup({ kind: 'reservation' });
  const withdrawnAt = new Date();
  await withdrawPaymentLink(link.id, { ...deps, provider: null, now: withdrawnAt });
  const provider = fakeProvider({ paid: true, paidAt: paidAt(withdrawnAt) });
  const s = spies();
  const { results } = await retryPendingCancellations({ paymentLinksModel: links, provider, database: db, devisModel: devisModel.buildModel(db), logger: { log() {}, warn() {} }, ...s });
  return { db, links, link, provider, s, result: results.find((r) => r.id === link.id) };
}

test('rule 42 (L1): paid before a withdrawal made while disconnected → the poll books it like the connected path', async () => {
  const { db, links, link, provider, s, result } = await withdrawnWhileDisconnected((at) => new Date(at.getTime() - 60 * 1000).toISOString());
  const row = links.findById(link.id);
  assert.equal(row.status, 'paid');
  assert.equal(row.remoteCancelPendingAt, null);
  assert.equal(result.status, 'paid');
  assert.equal(db.prepare('SELECT depositPaid FROM reservations WHERE id = ?').get(link.reservationId).depositPaid, 1);
  assert.deepEqual(s.confirmed, [link.reservationId]);
  assert.deepEqual(s.notified, []);
  assert.ok(!provider.calls.some((c) => c[0] === 'cancelLink'));
});

test('rule 42 (L1): paid after the withdrawal → nothing booked, the admin is alerted (rule 8)', async () => {
  const { db, links, link, s, result } = await withdrawnWhileDisconnected((at) => new Date(at.getTime() + 60 * 1000).toISOString());
  assert.equal(links.findById(link.id).status, 'cancelled');
  assert.equal(result.status, 'paid-after-cancel');
  assert.equal(db.prepare('SELECT depositPaid FROM reservations WHERE id = ?').get(link.reservationId).depositPaid, 0);
  assert.equal(s.notified.length, 1);
  assert.deepEqual(s.confirmed, []);
});

test('rule 42 (L5): a solde link and a full link open together each offer « Retirer le lien »', async () => {
  const { db, links } = seedDb();
  const id = addStay(db, { startDate: inDays(40), endDate: inDays(43) });
  const provider = fakeProvider();
  const { ensurePaymentLink } = require('../utils/paymentRequestService');
  const mintDeps = { database: db, paymentLinksModel: links, provider, resolveAmountCents: (_, type) => (type === 'full' ? 30000 : 21000) };
  const full = await ensurePaymentLink(mintDeps, id, 'full');
  const balance = await ensurePaymentLink(mintDeps, id, 'balance');
  assert.deepEqual(links.listForReservation(id).filter((l) => l.status === 'open').map((l) => l.id).sort(), [full.id, balance.id].sort());
  const row = buildLedger({ row: ledgerRow({ id }), links: links.listForReservation(id), canRequest: true, today: inDays(0) })
    .rows.find((r) => r.key === 'balance');
  const offered = [row.detail.link, ...(row.detail.otherLinks || [])].map((l) => l.withdraw && l.withdraw.linkId).sort();
  assert.deepEqual(offered, [full.id, balance.id].sort());
});
