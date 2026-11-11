// specs/payment-link-lifecycle.md rule 58 (audit R9 public L-1) — during the last-look hour of a lapsed link
// (rule 18 left it `expired`, deactivated, unpaid at the read, `lastLookAt` set), a new request on the same bucket
// reads that link first, exactly like one still owed its deactivation: paid → booked and refused 409
// LINK_ALREADY_PAID, unreadable → 502 PROVIDER_UNREACHABLE, unpaid → minted as usual and the look kept.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, fakeProvider, HOUR, MINUTE } = require('./paymentLinkLifecycleFixture');
const { ensurePaymentLink, ensureInstallmentLink } = require('../utils/paymentRequestService');

const PAID_BOOKED = 'Le lien en cours vient d’être payé : paiement enregistré, aucun nouveau lien créé.';
const MINTED = new Date(Date.now() - 40 * HOUR);
const NOW = new Date();

const deps = (db, links, provider, now, extra = {}) => ({ database: db, paymentLinksModel: links, provider, resolveAmountCents: () => 9000, now: () => now, ...extra });
const effect = (devis, confirmed = []) => () => ({ devisModel: devis, sendConfirmation: async (rid) => { confirmed.push(rid); }, emitPluginEvent: () => {} });

// The state rule 18 leaves after an unpaid deactivation: marker cleared, the last look due within the hour.
function inLastLook(db, links, linkId) {
  links.lapseIfOpen(linkId, { reason: 'validity', now: new Date(NOW.getTime() - 10 * MINUTE) });
  db.prepare('UPDATE payment_links SET remoteCancelPendingAt = NULL, lastLookAt = ? WHERE id = ?')
    .run(new Date(NOW.getTime() + 50 * MINUTE).toISOString(), linkId);
}

async function lapsedStay() {
  const { db, links, devis } = seedDb();
  const id = addStay(db);
  const first = await ensurePaymentLink(deps(db, links, fakeProvider(), MINTED), id, 'deposit');
  inLastLook(db, links, first.id);
  return { db, links, devis, id, first };
}

test('rule 58: a re-click while the last look is pending reads the lapsed link: paid → booked, refused, nothing minted', async () => {
  const { db, links, devis, id, first } = await lapsedStay();
  const provider = fakeProvider({ paid: (linkId) => linkId === first.providerLinkId });
  const confirmed = [];
  await assert.rejects(
    ensurePaymentLink(deps(db, links, provider, NOW, { paymentEffect: effect(devis, confirmed) }), id, 'deposit'),
    (err) => err.httpStatus === 409 && err.error === 'LINK_ALREADY_PAID' && err.message === PAID_BOOKED,
  );
  assert.deepEqual(provider.calls.map((c) => [c[0], c[1]]), [['getPayment', first.providerLinkId]]);
  const row = links.findById(first.id);
  assert.equal(row.status, 'paid');
  assert.equal(db.prepare('SELECT depositPaid FROM reservations WHERE id = ?').get(id).depositPaid, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM payment_links WHERE status = 'open'").get().n, 0);
  assert.deepEqual(confirmed, [id]);
});

test('rule 58: the same read guards the full request, whose payment settles the acompte', async () => {
  const { db, links, devis, id, first } = await lapsedStay();
  const provider = fakeProvider({ paid: true });
  await assert.rejects(
    ensurePaymentLink(deps(db, links, provider, NOW, { paymentEffect: effect(devis) }), id, 'full'),
    (err) => err.error === 'LINK_ALREADY_PAID',
  );
  assert.equal(provider.calls.filter((c) => c[0] === 'createLink').length, 0);
  assert.equal(links.findById(first.id).status, 'paid');
});

test('rule 58: unpaid at the read → minted as usual, and the last look stays for the lifecycle pass', async () => {
  const { db, links, devis, id, first } = await lapsedStay();
  const provider = fakeProvider();
  const fresh = await ensurePaymentLink(deps(db, links, provider, NOW, { paymentEffect: effect(devis) }), id, 'deposit');
  assert.equal(fresh.reused, false);
  assert.deepEqual(provider.calls.map((c) => c[0]), ['getPayment', 'createLink']);
  const old = db.prepare('SELECT status, lastLookAt FROM payment_links WHERE id = ?').get(first.id);
  assert.equal(old.status, 'expired');
  assert.ok(old.lastLookAt, 'the look is not consumed by the request');
});

test('rule 58: unreadable → 502 PROVIDER_UNREACHABLE, nothing minted', async () => {
  const { db, links, devis, id } = await lapsedStay();
  const provider = fakeProvider({ failPayment: new Error('socket hang up') });
  await assert.rejects(
    ensurePaymentLink(deps(db, links, provider, NOW, { paymentEffect: effect(devis) }), id, 'deposit'),
    (err) => err.httpStatus === 502 && err.error === 'PROVIDER_UNREACHABLE',
  );
  assert.equal(provider.calls.filter((c) => c[0] === 'createLink').length, 0);
});

test('rule 58: a lapsed link whose look was taken is not read again', async () => {
  const { db, links, devis, id, first } = await lapsedStay();
  db.prepare('UPDATE payment_links SET lastLookAt = NULL WHERE id = ?').run(first.id);
  const provider = fakeProvider({ paid: true });
  const fresh = await ensurePaymentLink(deps(db, links, provider, NOW, { paymentEffect: effect(devis) }), id, 'deposit');
  assert.equal(fresh.reused, false);
  assert.deepEqual(provider.calls.map((c) => c[0]), ['createLink']);
});

test('rule 58: the installment re-click reads its link in its last look too', async () => {
  const { db, links, devis } = seedDb();
  const id = addStay(db);
  const installment = { id: 41, reservationId: id, number: 1, amountCents: 15000, paid: 0 };
  const installmentsModel = { findById: () => installment, listFor: () => [installment] };
  const first = await ensureInstallmentLink(deps(db, links, fakeProvider(), MINTED, { installmentsModel }), id, 41);
  inLastLook(db, links, first.id);
  const provider = fakeProvider({ paid: true });
  const paymentEffect = () => ({ devisModel: devis, emitPluginEvent: () => {}, recordPayment: () => {} });
  await assert.rejects(
    ensureInstallmentLink(deps(db, links, provider, NOW, { installmentsModel, paymentEffect }), id, 41),
    (err) => err.error === 'LINK_ALREADY_PAID',
  );
  assert.equal(provider.calls.filter((c) => c[0] === 'createLink').length, 0);
  assert.equal(links.findById(first.id).status, 'paid');
});
