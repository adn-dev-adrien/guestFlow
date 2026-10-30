// specs/payment-link-lifecycle.md rule 9 — from 00:00 Europe/Paris on the arrival day, the pre-arrival
// links of the stay (deposit, balance, full, installment; those of the devis it came from too) lapse with
// reason `stay-started`. A complement link is untouched, and a link minted on or after the arrival day keeps
// its 36 hours. The Paris midnight moves with daylight saving time: both changeover days are pinned here.

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');

const { seedDb, addStay, addLink } = require('./paymentLinkLifecycleFixture');
const { retireLapsedAndWithdrawn } = require('../utils/paymentLinkLifecycle');

const pass = (db, links, iso) => retireLapsedAndWithdrawn(db, { now: new Date(iso), paymentLinksModel: links });
const stateOf = (links, id) => { const l = links.findById(id); return [l.status, l.cancelReason]; };

// [arrival day, last UTC instant before its Paris midnight, that midnight in UTC]
for (const [day, before, midnight, label] of [
  ['2026-10-25', '2026-10-24T21:59:59Z', '2026-10-24T22:00:00Z', 'the autumn changeover day (midnight still CEST, UTC+2)'],
  ['2026-10-26', '2026-10-25T22:59:59Z', '2026-10-25T23:00:00Z', 'the day after it (CET, UTC+1)'],
  ['2027-03-28', '2027-03-27T22:59:59Z', '2027-03-27T23:00:00Z', 'the spring changeover day (midnight still CET, UTC+1)'],
  ['2027-03-29', '2027-03-28T21:59:59Z', '2027-03-28T22:00:00Z', 'the day after it (CEST, UTC+2)'],
]) {
  test(`rule 9 — ${label}: open until 23:59:59 Paris the day before, lapsed at 00:00 Paris on ${day}`, () => {
    const { db, links } = seedDb();
    const stay = addStay(db, { startDate: day, endDate: '2027-12-31' });
    const link = addLink(links, db, stay, { type: 'deposit', createdAt: new Date('2026-09-01T10:00:00Z') });

    assert.deepEqual(pass(db, links, before), []);
    assert.deepEqual(stateOf(links, link.id), ['open', null]);
    assert.deepEqual(pass(db, links, midnight).map((l) => l.id), [link.id]);
    assert.deepEqual(stateOf(links, link.id), ['expired', 'stay-started']);
    assert.ok(links.findById(link.id).remoteCancelPendingAt, 'its deactivation is owed (rule 18)');
  });
}

test('rule 9 — every pre-arrival type lapses; a complement link is paid on site and stays open', () => {
  const { db, links } = seedDb();
  const stay = addStay(db, { startDate: '2026-11-05', endDate: '2026-11-08' });
  const created = new Date('2026-10-01T10:00:00Z');
  const ids = ['deposit', 'balance', 'full', 'installment'].map((type) => addLink(links, db, stay, { type, createdAt: created, installmentId: type === 'installment' ? 9 : null }).id);
  const complement = addLink(links, db, stay, { type: 'complement', createdAt: created });

  const moved = pass(db, links, '2026-11-05T08:00:00Z');

  assert.deepEqual(moved.map((l) => l.id).sort((a, b) => a - b), ids);
  ids.forEach((id) => assert.deepEqual(stateOf(links, id), ['expired', 'stay-started']));
  assert.deepEqual(stateOf(links, complement.id), ['open', null]);
});

test('rule 9 — a link minted on the arrival day is exempt, even at 00:30 Paris when UTC still says the day before', () => {
  const { db, links } = seedDb();
  const stay = addStay(db, { startDate: '2026-10-25', endDate: '2026-10-28' });
  const dayBefore = addLink(links, db, stay, { type: 'balance', createdAt: new Date('2026-10-24T21:30:00Z') });
  const sameDay = addLink(links, db, stay, { type: 'balance', createdAt: new Date('2026-10-24T22:30:00Z') });

  pass(db, links, '2026-10-25T09:00:00Z');

  assert.deepEqual(stateOf(links, dayBefore.id), ['expired', 'stay-started'], '23:30 Paris on the 24th');
  assert.deepEqual(stateOf(links, sameDay.id), ['open', null], '00:30 Paris on the 25th: only its 36 h apply');
});

test('rule 9 — the links of a devis lapse on the start of the stay it became, not on the devis’s own dates', () => {
  const { db, links } = seedDb();
  const reservation = addStay(db, { startDate: '2026-11-20', endDate: '2026-11-23' });
  const devis = addStay(db, { kind: 'devis', startDate: '2026-11-10', endDate: '2026-11-13', convertedReservationId: reservation });
  const link = addLink(links, db, devis, { type: 'full', createdAt: new Date('2026-10-01T10:00:00Z') });

  pass(db, links, '2026-11-12T10:00:00Z');
  assert.deepEqual(stateOf(links, link.id), ['open', null], 'the stay was re-dated to the 20th');
  pass(db, links, '2026-11-19T23:00:00Z');
  assert.deepEqual(stateOf(links, link.id), ['expired', 'stay-started']);
});

test('rule 9 — a devis whose dates have arrived lapses its request too', () => {
  const { db, links } = seedDb();
  const devis = addStay(db, { kind: 'devis', startDate: '2026-11-10', endDate: '2026-11-13' });
  const link = addLink(links, db, devis, { type: 'deposit', createdAt: new Date('2026-10-01T10:00:00Z') });
  pass(db, links, '2026-11-10T06:00:00Z');
  assert.deepEqual(stateOf(links, link.id), ['expired', 'stay-started']);
});

test('rule 9 — a stay that starts later keeps its links; the 36 h are the only clock', () => {
  const { db, links } = seedDb();
  const stay = addStay(db, { startDate: '2026-12-20', endDate: '2026-12-23' });
  const link = addLink(links, db, stay, { type: 'deposit', createdAt: new Date('2026-11-01T10:00:00Z') });
  assert.deepEqual(pass(db, links, '2026-11-01T20:00:00Z'), []);
  assert.deepEqual(stateOf(links, link.id), ['open', null]);
});
