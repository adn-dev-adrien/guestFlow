const test = require('node:test');
const assert = require('node:assert/strict');

const { addBatch, collectBatches, totalOf, sumOf } = require('../laundryBatches');

// specs/linen-laundry-days.md §3.2 rules 10-11 and §3.3 rule 15 — the batches at the laundry, pure.

const KEYS = ['a', 'b'];
const batch = (dropDate, readyFrom, counts) => ({ dropDate, readyFrom, counts });

test('specs/linen-laundry-days.md §3.3 rule 15: addBatch appends a copy and ignores an empty drop', () => {
  const counts = { a: 1, b: 0 };
  const batches = addBatch([], batch('2026-06-02', '2026-06-03', counts));
  counts.a = 99;
  assert.deepEqual(batches, [batch('2026-06-02', '2026-06-03', { a: 1, b: 0 })]);
  assert.equal(addBatch(batches, batch('2026-06-04', '2026-06-05', { a: 0, b: 0 })), batches);
});

test('specs/linen-laundry-days.md §3.2 rule 10: collecting everything takes the batches whose readyFrom has come — the day itself included', () => {
  const batches = [batch('2026-06-02', '2026-06-04', { a: 1, b: 0 }), batch('2026-06-04', '2026-06-07', { a: 0, b: 2 })];
  const onThursday = collectBatches(batches, '2026-06-04', KEYS);
  assert.deepEqual(onThursday.collected, { a: 1, b: 0 });
  assert.deepEqual(onThursday.fromTrips, ['2026-06-02']);
  assert.deepEqual(onThursday.remaining, [batches[1]]);
  const later = collectBatches(batches, '2026-06-07', KEYS);
  assert.deepEqual(later.collected, { a: 1, b: 2 });
  assert.deepEqual(later.fromTrips, ['2026-06-02', '2026-06-04']);
  assert.deepEqual(later.remaining, []);
});

test('specs/linen-laundry-days.md §3.2 rule 10: nothing ready collects nothing', () => {
  const batches = [batch('2026-06-02', '2026-06-04', { a: 1, b: 0 })];
  const result = collectBatches(batches, '2026-06-03', KEYS);
  assert.deepEqual(result.collected, { a: 0, b: 0 });
  assert.deepEqual(result.fromTrips, []);
  assert.deepEqual(result.remaining, batches);
});

test('specs/linen-laundry-days.md §3.2 rule 10: a partial collection serves each type oldest batch first, capped at what is ready', () => {
  const batches = [
    batch('2026-06-02', '2026-06-03', { a: 2, b: 1 }),
    batch('2026-06-04', '2026-06-05', { a: 2, b: 0 }),
    batch('2026-06-06', '2026-06-20', { a: 9, b: 9 }),
  ];
  const result = collectBatches(batches, '2026-06-10', KEYS, { a: 3, b: 5 });
  assert.deepEqual(result.collected, { a: 3, b: 1 });
  assert.deepEqual(result.fromTrips, ['2026-06-02', '2026-06-04']);
  assert.deepEqual(result.remaining, [batch('2026-06-04', '2026-06-05', { a: 1, b: 0 }), batches[2]]);
});

test('specs/linen-laundry-days.md §3.2 rule 10: a batch only drawn from for a type nobody asked for is not in fromTrips; a negative or missing quantity asks for nothing', () => {
  const batches = [batch('2026-06-02', '2026-06-03', { a: 2, b: 1 })];
  const result = collectBatches(batches, '2026-06-10', KEYS, { a: -4 });
  assert.deepEqual(result.collected, { a: 0, b: 0 });
  assert.deepEqual(result.fromTrips, []);
  assert.deepEqual(result.remaining, batches);
});

test('specs/linen-laundry-days.md §3.2 rule 10: collecting never mutates its input', () => {
  const batches = [batch('2026-06-02', '2026-06-03', { a: 2, b: 1 })];
  collectBatches(batches, '2026-06-10', KEYS, { a: 1 });
  assert.deepEqual(batches, [batch('2026-06-02', '2026-06-03', { a: 2, b: 1 })]);
});

test('specs/linen-laundry-days.md §3.2 rule 11: totalOf sums what stays and names the earliest readyFrom', () => {
  const batches = [batch('2026-06-04', '2026-06-09', { a: 1, b: 0 }), batch('2026-06-02', '2026-06-06', { a: 2, b: 3 })];
  assert.deepEqual(totalOf(batches, KEYS), { counts: { a: 3, b: 3 }, readyOn: '2026-06-06' });
  assert.deepEqual(totalOf([], KEYS), { counts: { a: 0, b: 0 }, readyOn: null });
  assert.equal(sumOf({ a: 1, b: '2' }), 3);
});
