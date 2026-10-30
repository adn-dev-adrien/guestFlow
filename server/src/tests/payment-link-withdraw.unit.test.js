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
