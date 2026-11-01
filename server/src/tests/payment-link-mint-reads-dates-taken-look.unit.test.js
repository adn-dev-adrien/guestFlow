// specs/payment-link-lifecycle.md rule 58, reading of 2026-11-01 (audit R11 money R11-L1). A link withdrawn because
// its dates were taken owes rule 19's last look too (rule 64), for a payment in flight at its deactivation. Once the
// stay is on free nights again, a new acompte / solde / séjour request reads that link before any mint: paid → booked
// as rule 33 books it (no confirmation) and refused 409 LINK_ALREADY_PAID; a payment still in flight (or an answer
// that does not say) → refused 409 LINK_PAYMENT_IN_FLIGHT; unreadable → 502; unpaid → minted, the look kept.
// Review of #916 (1, 5): a link whose deactivation is still owed (marker set, no look yet) is deactivated and read
// first — it is still payable at the provider; and a newer lapsed link never hides an older one owing its look.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, fakeProvider, MINUTE } = require('./paymentLinkLifecycleFixture');
const { ensurePaymentLink } = require('../utils/paymentRequestService');

const NOW = new Date();
const IN_FLIGHT = 'Paiement en cours sur l’ancien lien : nouveau lien non créé.';

const deps = (db, links, provider, extra = {}) => ({ database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 30000, now: () => NOW, deactivateLinks: async () => {}, ...extra });

// The stay's buckets (fixture: 90 € + 210 €), so the old link pays its own amount.
const AMOUNT = { deposit: 9000, balance: 21000, full: 30000 };
// `markerOwed`: withdrawn for taken dates, its deactivation still owed (rule 32) — no look armed yet.
function scene({ type = 'full', markerOwed = false } = {}) {
  const { db, links, devis } = seedDb();
  const id = addStay(db);
  const old = links.create({ reservationId: id, type, amountCents: AMOUNT[type], provider: 'qonto', providerLinkId: 'pl_old', url: 'https://pay.example.test/old', status: 'open' });
  db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'dates-taken', remoteCancelPendingAt = ?, lastLookAt = ? WHERE id = ?")
    .run(markerOwed ? NOW.toISOString() : null, markerOwed ? null : new Date(NOW.getTime() + 30 * MINUTE).toISOString(), old.id);
  const confirmed = [];
  const notified = [];
  const paymentEffect = () => ({
    devisModel: devis, emitPluginEvent: () => {}, checkConflict: () => false,
    sendConfirmation: async (rid) => { confirmed.push(rid); }, notifyPaidAfterCancel: async (l, o) => { notified.push(o || {}); },
  });
  return { db, links, id, old, confirmed, notified, paymentEffect };
}

const raw = (db, id) => db.prepare('SELECT * FROM payment_links WHERE id = ?').get(Number(id));
const created = (provider) => provider.calls.filter((c) => c[0] === 'createLink').length;

const FLAG = { deposit: 'depositPaid', balance: 'balancePaid', full: 'balancePaid' };
for (const [type, oldType] of [['deposit', 'deposit'], ['balance', 'balance'], ['full', 'full'], ['deposit', 'full']]) {
  test(`rule 58 (R11): a ${type} request reads the dates-taken ${oldType} link still owed its last look — paid → booked, refused, nothing minted`, async () => {
    const s = scene({ type: oldType });
    const provider = fakeProvider({ paid: (linkId) => linkId === 'pl_old' });
    await assert.rejects(
      ensurePaymentLink(deps(s.db, s.links, provider, { paymentEffect: s.paymentEffect }), s.id, type),
      (err) => err.httpStatus === 409 && err.error === 'LINK_ALREADY_PAID',
    );
    assert.deepEqual(provider.calls.map((c) => [c[0], c[1]]), [['getPayment', 'pl_old']]);
    const row = raw(s.db, s.old.id);
    assert.equal(row.status, 'paid');
    assert.equal(row.lastLookAt, null);
    assert.equal(s.db.prepare(`SELECT ${FLAG[oldType]} AS paid FROM reservations WHERE id = ?`).get(s.id).paid, 1);
    assert.deepEqual(s.confirmed, [], 'rule 33: no confirmation');
    assert.deepEqual(s.notified, [], 'review of #916 (2): free nights, no conflict — no « dates déjà prises » alert');
  });
}

test('rule 58 (R11): a payment still in flight on that link refuses the request — nothing minted, the look kept', async () => {
  const s = scene();
  const provider = fakeProvider({ paid: false, pending: true });
  await assert.rejects(
    ensurePaymentLink(deps(s.db, s.links, provider, { paymentEffect: s.paymentEffect }), s.id, 'deposit'),
    (err) => err.httpStatus === 409 && err.error === 'LINK_PAYMENT_IN_FLIGHT' && err.message === IN_FLIGHT,
  );
  assert.equal(created(provider), 0);
  assert.ok(raw(s.db, s.old.id).lastLookAt);
});

test('rule 64 (R11-E1): an answer without a boolean `pending` counts as in flight there too', async () => {
  const s = scene();
  const base = fakeProvider();
  // What online-payment 1.5.0 answers for a Qonto payment still `processing`: no `pending` key.
  const provider = { ...base, getPayment: async (linkId) => { base.calls.push(['getPayment', linkId]); return { paid: false, paymentId: null, paidAt: null }; } };
  await assert.rejects(
    ensurePaymentLink(deps(s.db, s.links, provider, { paymentEffect: s.paymentEffect }), s.id, 'full'),
    (err) => err.error === 'LINK_PAYMENT_IN_FLIGHT',
  );
  assert.equal(created(base), 0);
});

test('rule 58 (R11): unpaid at the read → minted as usual, and the look stays for the lifecycle pass', async () => {
  const s = scene();
  const provider = fakeProvider({ paid: false });
  const fresh = await ensurePaymentLink(deps(s.db, s.links, provider, { paymentEffect: s.paymentEffect }), s.id, 'full');
  assert.equal(fresh.reused, false);
  assert.deepEqual(provider.calls.map((c) => c[0]), ['getPayment', 'createLink']);
  const row = raw(s.db, s.old.id);
  assert.equal(row.status, 'cancelled');
  assert.ok(row.lastLookAt);
});

test('rule 58 (R11): unreadable → 502 PROVIDER_UNREACHABLE, nothing minted', async () => {
  const s = scene();
  const provider = fakeProvider({ failPayment: new Error('socket hang up') });
  await assert.rejects(
    ensurePaymentLink(deps(s.db, s.links, provider, { paymentEffect: s.paymentEffect }), s.id, 'full'),
    (err) => err.httpStatus === 502 && err.error === 'PROVIDER_UNREACHABLE',
  );
  assert.equal(created(provider), 0);
});

test('rule 58 (R11): a dates-taken link whose look was taken is not read again', async () => {
  const s = scene();
  s.db.prepare('UPDATE payment_links SET lastLookAt = NULL WHERE id = ?').run(s.old.id);
  const provider = fakeProvider({ paid: true });
  await ensurePaymentLink(deps(s.db, s.links, provider, { paymentEffect: s.paymentEffect }), s.id, 'full');
  assert.deepEqual(provider.calls.map((c) => c[0]), ['createLink']);
});

test('rule 58 (#916 review): a dates-taken link still owed its deactivation is read first — paid → booked, nothing minted', async () => {
  const s = scene({ markerOwed: true });
  const provider = fakeProvider({ paid: (linkId) => linkId === 'pl_old' });
  await assert.rejects(
    ensurePaymentLink(deps(s.db, s.links, provider, { paymentEffect: s.paymentEffect }), s.id, 'full'),
    (err) => err.httpStatus === 409 && err.error === 'LINK_ALREADY_PAID',
  );
  assert.equal(created(provider), 0);
  assert.ok(provider.calls.some((c) => c[0] === 'getPayment' && c[1] === 'pl_old'));
  const row = raw(s.db, s.old.id);
  assert.equal(row.status, 'paid');
  assert.equal(row.remoteCancelPendingAt, null);
  assert.deepEqual(s.confirmed, [], 'rule 33: no confirmation');
});

test('rule 58 (#916 review): marker owed, unpaid → deactivated, read again, then minted — the look kept', async () => {
  const s = scene({ markerOwed: true });
  const provider = fakeProvider({ paid: false });
  const fresh = await ensurePaymentLink(deps(s.db, s.links, provider, { paymentEffect: s.paymentEffect }), s.id, 'full');
  assert.equal(fresh.reused, false);
  assert.deepEqual(provider.calls.map((c) => c[0]), ['getPayment', 'cancelLink', 'getPayment', 'createLink']);
  const row = raw(s.db, s.old.id);
  assert.equal(row.remoteCancelPendingAt, null);
  assert.ok(row.lastLookAt);
});

test('rule 58 (#916 review): marker owed, payment in flight after the deactivation → refused, nothing minted', async () => {
  const s = scene({ markerOwed: true });
  const provider = fakeProvider({ paid: false, pending: true });
  await assert.rejects(
    ensurePaymentLink(deps(s.db, s.links, provider, { paymentEffect: s.paymentEffect }), s.id, 'full'),
    (err) => err.error === 'LINK_PAYMENT_IN_FLIGHT',
  );
  assert.equal(created(provider), 0);
  assert.ok(raw(s.db, s.old.id).lastLookAt);
});

test('rule 58 (#916 review): marker owed, deactivation fails → 502, nothing minted', async () => {
  const s = scene({ markerOwed: true });
  const provider = fakeProvider({ paid: false, failCancel: new Error('socket hang up'), linkStatus: 'open' });
  await assert.rejects(
    ensurePaymentLink(deps(s.db, s.links, provider, { paymentEffect: s.paymentEffect }), s.id, 'full'),
    (err) => err.httpStatus === 502 && err.error === 'PROVIDER_UNREACHABLE',
  );
  assert.equal(created(provider), 0);
  assert.ok(raw(s.db, s.old.id).remoteCancelPendingAt);
});

test('rule 58 (#916 review): a newer lapsed link owing its look never hides an older dates-taken one owing its own', async () => {
  const s = scene();
  const newer = s.links.create({ reservationId: s.id, type: 'full', amountCents: 30000, provider: 'qonto', providerLinkId: 'pl_lapsed', url: 'https://pay.example.test/lapsed', status: 'open' });
  s.db.prepare("UPDATE payment_links SET status = 'expired', cancelReason = 'validity', remoteCancelPendingAt = NULL, lastLookAt = ? WHERE id = ?")
    .run(new Date(NOW.getTime() + 30 * MINUTE).toISOString(), newer.id);
  assert.ok(Number(newer.id) > Number(s.old.id));
  const provider = fakeProvider({ paid: (linkId) => linkId === 'pl_old' });
  await assert.rejects(
    ensurePaymentLink(deps(s.db, s.links, provider, { paymentEffect: s.paymentEffect }), s.id, 'full'),
    (err) => err.error === 'LINK_ALREADY_PAID',
  );
  assert.equal(created(provider), 0);
  assert.equal(raw(s.db, s.old.id).status, 'paid');
});
