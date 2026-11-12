// specs/pricing-components.md §3 rule 81 — the allowlist scopes of the price gate and the replay's --expect list.
const test = require('node:test');
const assert = require('node:assert/strict');
const { compareFigures, allowlistProblems, SCOPES } = require('./helpers/priceGateCompare');
const { classifyReplay, expectProblems } = require('../../../scripts/price-gate/replayExpect');

const entry = (over = {}) => ({
  reservationId: 7, field: 'total.final', old: 1000, corrected: 999, reason: 'listed', rule: 'rule 3', defect: 'D1', approvedBy: 'Adrien', approvedAt: '2026-11-12', ...over,
});
const expected = { 7: { 'total.final': 1000 } };
const actual = { 7: { 'total.final': 999 } };

test('rule 81: an entry without a scope is a stays entry, so the existing allowlist keeps its meaning', () => {
  assert.equal(compareFigures(expected, actual, [entry()]).differences.length, 0);
  assert.equal(compareFigures(expected, actual, [entry()], { scope: 'stays' }).differences.length, 0);
});

test('rule 81: an entry absorbs a difference only in its own scope and is not reported unused in another', () => {
  for (const scope of SCOPES.filter((s) => s !== 'stays')) {
    const list = [entry({ scope })];
    assert.equal(compareFigures(expected, actual, list).differences.length, 1, `${scope} entry does not absorb a stays difference`);
    assert.deepEqual(compareFigures(expected, actual, list).unusedEntries, [], `${scope} entry is not unused in the stays scope`);
    const own = compareFigures(expected, actual, list, { scope });
    assert.equal(own.differences.length, 0);
    assert.equal(own.allowed.length, 1);
  }
});

test('rule 81: an entry of a scope that matches nothing is reported unused in that scope', () => {
  const list = [entry({ scope: 'propertyGrids' })];
  const same = { 7: { 'total.final': 1000 } };
  assert.equal(compareFigures(same, same, list, { scope: 'propertyGrids' }).unusedEntries.length, 1);
});

test('rule 81: an unknown scope is refused, on an entry and as a request', () => {
  assert.ok(allowlistProblems([entry({ scope: 'everything' })]).some((p) => p.includes('scope')));
  assert.throws(() => compareFigures(expected, actual, [entry({ scope: 'everything' })]), /scope/);
  assert.throws(() => compareFigures(expected, actual, [], { scope: 'nope' }), /scope/);
});

test('rule 81: the replay splits its differences into expected, unexpected and stale, by whole key', () => {
  const before = { 'a/1': 'x', 'a/2': 'x', 'a/3': 'x', 'a/10': 'x' };
  const after = { 'a/1': 'y', 'a/2': 'x', 'a/3': 'y', 'a/10': 'x' };
  const verdict = classifyReplay(before, after, [
    { key: 'a/1', reason: 'moves', rule: 'rule 76' },
    { key: 'a/2', reason: 'listed but unchanged', rule: 'rule 76' },
  ]);
  assert.deepEqual(verdict, { compared: 4, expected: ['a/1'], unexpected: ['a/3'], stale: ['a/2'] });
});

test('rule 81: a key present on one side only is a difference, and no expect list means every difference is unexpected', () => {
  const verdict = classifyReplay({ 'a/1': 'x' }, { 'a/1': 'x', 'a/2': 'z' });
  assert.deepEqual(verdict.unexpected, ['a/2']);
  assert.deepEqual(verdict.expected, []);
});

test('rule 81: an incomplete or duplicated expect entry is refused', () => {
  assert.deepEqual(expectProblems([]), []);
  assert.ok(expectProblems([{ key: 'a/1', reason: '', rule: 'r' }]).some((p) => p.includes('reason')));
  assert.ok(expectProblems([{ key: 'a/1', reason: 'x', rule: 'r' }, { key: 'a/1', reason: 'x', rule: 'r' }]).some((p) => p.includes('twice')));
  assert.ok(expectProblems('nope').length > 0);
  assert.throws(() => classifyReplay({}, {}, [{ key: '' }]), /invalid/);
});
