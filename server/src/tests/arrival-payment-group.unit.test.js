// specs/single-payment-at-check-in.md §3.2 — the group that records ONE collection covering several
// buckets. Pure: no DB, no engine. What matters here is that a group is only ever built when it
// really groups something, and that an unreadable one degrades to « no group » instead of throwing
// inside a check-in commit.
const test = require('node:test');
const assert = require('node:assert');

const {
  buildGroup, parseGroup, groupCovers, serialiseGroup,
} = require('../utils/arrivalPaymentGroup');

// specs/single-payment-at-check-in.md rule 7
test('buildGroup keeps the collection as it happened: date, means, amount, buckets', () => {
  const g = buildGroup({ at: '2026-08-30', cash: false, total: 530, buckets: ['balance', 'complement'] });
  assert.deepEqual(g, { at: '2026-08-30', cash: 0, total: 530, buckets: ['balance', 'complement'] });
});

test('buildGroup orders the buckets and drops duplicates and unknown names', () => {
  const g = buildGroup({
    at: '2026-08-30', cash: true, total: 100,
    buckets: ['complement', 'balance', 'balance', 'endOfStay', 'deposit'],
  });
  assert.deepEqual(g.buckets, ['deposit', 'balance', 'complement']);
  assert.equal(g.cash, 1);
});

// specs/single-payment-at-check-in.md rule 7
test('a group of one is not a group', () => {
  // A single bucket settled on its own is an ordinary payment; recording it would make the fiche
  // announce a « paiement unique » that groups nothing.
  assert.equal(buildGroup({ at: '2026-08-30', total: 480, buckets: ['balance'] }), null);
  assert.equal(buildGroup({ at: '2026-08-30', total: 480, buckets: [] }), null);
});

test('a group needs a real date and a real amount', () => {
  assert.equal(buildGroup({ at: 'demain', total: 530, buckets: ['balance', 'complement'] }), null);
  assert.equal(buildGroup({ at: '2026-08-30', total: 0, buckets: ['balance', 'complement'] }), null);
  assert.equal(buildGroup({ at: '2026-08-30', total: -5, buckets: ['balance', 'complement'] }), null);
});

test('the total is rounded to the cent, like every stored amount', () => {
  const g = buildGroup({ at: '2026-08-30', total: 530.005, buckets: ['balance', 'complement'] });
  assert.equal(g.total, 530.01);
});

test('parseGroup reads back what serialiseGroup wrote', () => {
  const json = serialiseGroup({ at: '2026-08-30', cash: true, total: 530, buckets: ['balance', 'complement'] });
  assert.equal(typeof json, 'string');
  assert.deepEqual(parseGroup(json), {
    at: '2026-08-30', cash: 1, total: 530, buckets: ['balance', 'complement'],
  });
});

test('an unreadable group degrades to « no group », never to a throw', () => {
  // This runs inside the check-in commit: a corrupt column must not cost the operator the whole
  // check-in (caution, upsells, planning flags) over a reading aid.
  for (const bad of [null, '', 'not json', '{', '[]', '{"at":"2026-08-30"}', 42]) {
    assert.equal(parseGroup(bad), null, `parseGroup(${JSON.stringify(bad)})`);
  }
});

// specs/single-payment-at-check-in.md rule 8
test('groupCovers answers which buckets the collection owned', () => {
  const json = serialiseGroup({ at: '2026-08-30', total: 530, buckets: ['balance', 'complement'] });
  assert.equal(groupCovers(json, 'balance'), true);
  assert.equal(groupCovers(json, 'complement'), true);
  assert.equal(groupCovers(json, 'deposit'), false);
  assert.equal(groupCovers(null, 'balance'), false);
});

test('serialiseGroup returns null rather than storing an empty shell', () => {
  assert.equal(serialiseGroup({ at: '2026-08-30', total: 530, buckets: ['balance'] }), null);
  assert.equal(serialiseGroup(null), null);
});
