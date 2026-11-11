// specs/qonto-bank-reconciliation.md rules 11–17, 29–32 — the matcher proposes, never decides.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProposals, classify, smallestSubset } = require('../reconciliation/matcher');

const reservation = (over = {}) => ({ id: 1, lastName: 'Dupont', reservationNumber: '', createdAt: '2026-01-01', ...over });
const receipt = (over = {}) => ({
  reservationId: 1, ledgerKey: 'balance', label: 'Solde', channel: 'direct', platform: 'direct',
  expectedCents: 10000, grossCents: 10000, openCents: 10000, payoutRecorded: true, paid: false,
  expectedDate: '2026-06-10', dueDate: '2026-06-10', paidDate: null, reservation: reservation(), ...over,
});
const tx = (over = {}) => ({
  id: 't1', amountCents: 10000, remainingCents: 10000, currency: 'EUR', settledAt: '2026-06-12T08:00:00.000Z',
  counterpartyName: '', label: '', reference: '', note: '', operationType: '', ...over,
});
const run = (transactions, receipts, extra = {}) => buildProposals({ transactions, receipts, ...extra }).byTransaction;

test('rule 29 — platforms are recognised by their defaults patterns, a cancellation compensation is not a payout', () => {
  assert.deepEqual(classify(tx({ counterpartyName: 'Booking.com B.V.', reference: 'NO.x/ID.1' }), {}), { kind: 'platform', platform: 'Booking' });
  assert.deepEqual(classify(tx({ counterpartyName: 'STRIPE', reference: 'GREENGO 2V03H' }), {}), { kind: 'platform', platform: 'Greengo' });
  assert.deepEqual(classify(tx({ counterpartyName: 'STRIPE', reference: 'STRIPE' }), {}), { kind: 'platform', platform: 'Lodgify' });
  assert.deepEqual(classify(tx({ counterpartyName: 'Mangopay', reference: '123-domainesolio X' }), {}), { kind: 'platform', platform: 'Abracadaroom' });
  assert.equal(classify(tx({ counterpartyName: 'STRIPE', reference: 'GREENGO AOM3I ANNUL' }), {}).kind, 'other');
  assert.equal(classify(tx({ counterpartyName: 'Stichting Mollie Payments' }), {}).kind, 'acquiring');
  assert.deepEqual(classify(tx({ counterpartyName: 'Paiements facturés', reference: 'Paiements-En-Personne-12-10-2026' }), {}), { kind: 'cardBatch', date: '2026-10-12' });
});

test('rule 14 — a platform credit with one exact payout is « sûr », two equal ones are « à vérifier »', () => {
  const booking = (id, ledgerKey = 'balance') => receipt({ reservationId: id, ledgerKey, channel: 'platform:Booking', platform: 'Booking', expectedCents: 59658, openCents: 59658, reservation: reservation({ id }) });
  const credit = tx({ amountCents: 59658, remainingCents: 59658, counterpartyName: 'Booking.com B.V.' });
  const single = run([credit], [booking(1)]).t1;
  assert.equal(single.proposal.confidence, 'sur');
  const twin = run([credit], [booking(1), booking(2)]).t1;
  assert.equal(twin.proposal.confidence, 'verifier');
  assert.equal(twin.alternatives.length, 1, 'the other stay is an alternative, never auto-picked');
});

test('rule 14 — a batched payout is the smallest combination that sums exactly, « probable »', () => {
  const mk = (id, cents) => receipt({ reservationId: id, channel: 'platform:Booking', platform: 'Booking', expectedCents: cents, openCents: cents, reservation: reservation({ id }) });
  const credit = tx({ amountCents: 26683, remainingCents: 26683, counterpartyName: 'Booking.com B.V.' });
  const out = run([credit], [mk(1, 11976), mk(2, 14707), mk(3, 5000)]).t1;
  assert.equal(out.proposal.confidence, 'probable');
  assert.deepEqual(out.proposal.allocations.map((a) => a.reservationId).sort(), [1, 2]);
});

test('rule 14 — a fiche typed after the money moved is still matched (no creation-date floor)', () => {
  const r = receipt({ channel: 'platform:Airbnb', platform: 'Airbnb', expectedCents: 77233, openCents: 77233, expectedDate: '2026-01-28', reservation: reservation({ createdAt: '2026-10-20' }) });
  const out = run([tx({ amountCents: 77233, remainingCents: 77233, settledAt: '2026-02-09T08:00:00.000Z', counterpartyName: 'AIRBNB PAYMENTS LUXEMBOURG S.A.' })], [r]).t1;
  assert.equal(out.proposal.confidence, 'sur');
});

test('rule 32 — a payout the fiche does not carry is proposed on the gross, always « à vérifier »', () => {
  const r = receipt({ channel: 'platform:GitesDeFrance', platform: 'GitesDeFrance', expectedCents: 62600, grossCents: 62600, openCents: 62600, payoutRecorded: false });
  const out = run([tx({ amountCents: 62600, remainingCents: 62600, counterpartyName: 'Vir LOCATION RESERVATION GITES DE FRANCE ARDECHE' })], [r]).t1;
  assert.equal(out.proposal.confidence, 'verifier');
  assert.equal(out.proposal.unrecordedPayout, true);
});

test('rule 30 — the Stripe weekly batch is a combination net of the card fee, « probable »', () => {
  const mk = (id, cents, recorded = true) => receipt({
    reservationId: id, channel: 'platform:Lodgify', platform: 'Lodgify', expectedCents: cents, grossCents: cents, openCents: cents,
    payoutRecorded: recorded, paid: true, paidDate: '2026-07-08', expectedDate: '2026-07-08', reservation: reservation({ id }),
  });
  const credit = tx({ amountCents: 30000, remainingCents: 30000, counterpartyName: 'STRIPE', reference: 'STRIPE', settledAt: '2026-07-13T05:00:00.000Z' });
  const out = run([credit], [mk(1, 20000), mk(2, 10000), mk(3, 5000)], { settings: { cardFeePercent: 2.8 } }).t1;
  assert.equal(out.proposal.confidence, 'probable');
  assert.deepEqual(out.proposal.allocations.map((a) => a.reservationId).sort(), [1, 2]);
  const single = run([tx({ amountCents: 20000, remainingCents: 20000, counterpartyName: 'STRIPE', reference: 'STRIPE', settledAt: '2026-07-13T05:00:00.000Z' })], [mk(1, 20000), mk(2, 10000)]).t1;
  assert.equal(single.proposal.confidence, 'sur', 'one recorded payout, exact');
});

test('rule 15 — an acquirer payout is the paid links net of the fee, one cent tolerance per link', () => {
  const link = (id, cents) => receipt({ reservationId: id, channel: 'link', expectedCents: cents, openCents: cents, linkPaidAt: '2026-10-10', paid: true, reservation: reservation({ id }) });
  const net = (c) => c - Math.round(c * 0.014) - 25;
  const credit = tx({ amountCents: net(10000) + net(20000), remainingCents: net(10000) + net(20000), operationType: 'card_acquirer_payout', counterpartyName: 'Mollie', settledAt: '2026-10-12T05:00:00.000Z' });
  const out = run([credit], [link(1, 10000), link(2, 20000), link(3, 7777)]).t1;
  assert.equal(out.proposal.confidence, 'probable');
  assert.deepEqual(out.proposal.allocations.map((a) => a.reservationId).sort(), [1, 2]);
  const old = run([{ ...credit, settledAt: '2026-10-25T05:00:00.000Z' }], [link(1, 10000), link(2, 20000)]).t1;
  assert.equal(old.proposal, null, 'links paid more than 7 days before are out of the window');
});

test('rule 31 — the on-site card batch is proposed against the stays paid by card that day', () => {
  const paid = (id, cents) => receipt({ reservationId: id, expectedCents: cents, openCents: cents, paid: true, paidDate: '2026-10-12', reservation: reservation({ id }) });
  const credit = tx({ amountCents: 20000, remainingCents: 20000, counterpartyName: 'Paiements facturés', reference: 'Paiements-En-Personne-12-10-2026' });
  const out = run([credit], [paid(1, 10000), paid(2, 3000), paid(3, 4000)]).t1;
  assert.equal(out.proposal.confidence, 'probable');
  assert.equal(out.proposal.allocations.length, 3, 'the batch may hold other sales: the sum stays under the credit');
});

test('rule 16 — a direct transfer: exact amount + name is « probable », exact amount alone « à vérifier »', () => {
  const named = run([tx({ counterpartyName: 'M. OU MME DUPONT' })], [receipt()]).t1;
  assert.equal(named.proposal.confidence, 'probable');
  const anon = run([tx({ counterpartyName: 'ACME' })], [receipt()]).t1;
  assert.equal(anon.proposal.confidence, 'verifier');
  const far = run([tx({ settledAt: '2026-09-01T00:00:00.000Z' })], [receipt()]).t1;
  assert.equal(far.proposal, null, 'more than 30 days from the due date');
});

test('rule 16 — the name of the client on a credit of another amount is proposed « à vérifier » on its next échéance', () => {
  const out = run([tx({ amountCents: 6000, remainingCents: 6000, counterpartyName: 'MME DUPONT', reference: 'Acompte' })], [receipt()]).t1;
  assert.equal(out.proposal.confidence, 'verifier');
  assert.equal(out.proposal.allocations[0].amountCents, 6000);
});

test('rule 16 — a whole stay paid in one transfer covers several échéances of one direct fiche', () => {
  const dep = receipt({ ledgerKey: 'deposit', label: 'Acompte', expectedCents: 4000, openCents: 4000 });
  const bal = receipt({ ledgerKey: 'balance', expectedCents: 6000, openCents: 6000 });
  const out = run([tx({ counterpartyName: 'Dupont' })], [dep, bal]).t1;
  assert.equal(out.proposal.allocations.length, 2);
});

test('rule 13 — a reservation number in the label is an identifier proposal', () => {
  const r = receipt({ reservation: reservation({ reservationNumber: '202610001' }) });
  const out = run([tx({ counterpartyName: 'ACME', reference: 'Resa 202610001' })], [r]).t1;
  assert.equal(out.proposal.source, 'identifier');
  assert.equal(out.proposal.confidence, 'sur');
});

test('rule 11 — a discarded pair is never proposed again', () => {
  const out = run([tx({ counterpartyName: 'Dupont' })], [receipt()], { discarded: new Set(['t1|1|balance']) }).t1;
  assert.equal(out.proposal, null);
});

test('rule 17 — competing credits for one receipt: the stronger keeps it, the other becomes an alternative', () => {
  const r = receipt();
  const out = run([
    tx({ id: 'named', counterpartyName: 'DUPONT', settledAt: '2026-06-20T00:00:00.000Z' }),
    tx({ id: 'anon', counterpartyName: 'ACME', settledAt: '2026-06-11T00:00:00.000Z' }),
  ], [r]);
  assert.equal(out.named.proposal.confidence, 'probable');
  assert.equal(out.anon.proposal, null);
  assert.equal(out.anon.alternatives.length, 1);
});

test('edge — a credit in another currency is never proposed', () => {
  const out = run([tx({ currency: 'USD', counterpartyName: 'DUPONT' })], [receipt()]).t1;
  assert.equal(out.proposal, null);
});

test('smallestSubset — bounded and exact', () => {
  const found = smallestSubset([{ cents: 5 }, { cents: 7 }, { cents: 12 }], 12, () => 0);
  assert.deepEqual(found.map((f) => f.cents), [12], 'the single item wins over 5 + 7');
  assert.equal(smallestSubset([{ cents: 5 }], 6, () => 0), null);
});
