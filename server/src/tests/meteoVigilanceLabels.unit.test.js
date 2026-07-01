const test = require('node:test');
const assert = require('node:assert/strict');

const labels = require('../utils/meteoVigilanceLabels');

test('phenomenonLabel: known ids → FR labels', () => {
  assert.equal(labels.phenomenonLabel(6), 'Canicule');
  assert.equal(labels.phenomenonLabel(3), 'Orages');
  assert.equal(labels.phenomenonLabel(1), 'Vent violent');
  assert.equal(labels.phenomenonLabel('9'), 'Vagues-submersion');
});

test('phenomenonLabel: unknown id → generic fallback', () => {
  assert.equal(labels.phenomenonLabel(99), 'Phénomène météo');
});

test('colorLabel: levels 1..4', () => {
  assert.equal(labels.colorLabel(1), 'Vert');
  assert.equal(labels.colorLabel(2), 'Jaune');
  assert.equal(labels.colorLabel(3), 'Orange');
  assert.equal(labels.colorLabel(4), 'Rouge');
});

test('staticInstructionsFor: canicule includes fire ban + smoking-area lines (rule 7)', () => {
  const list = labels.staticInstructionsFor(6);
  assert.ok(list.some((l) => /feux sont strictement interdits/i.test(l)));
  assert.ok(list.some((l) => /zones fumeurs/i.test(l)));
});

test('staticInstructionsFor: orages has a specific advisory', () => {
  const list = labels.staticInstructionsFor(3);
  assert.ok(list.length >= 1);
  assert.ok(list.some((l) => /orageux/i.test(l)));
});

test('staticInstructionsFor: unknown phenomenon → generic advisory', () => {
  const list = labels.staticInstructionsFor(4);
  assert.deepEqual(list, [labels.GENERIC_INSTRUCTION]);
});

test('staticInstructionsFor: returns a fresh array (no shared mutation)', () => {
  const a = labels.staticInstructionsFor(6);
  a.push('mutated');
  const b = labels.staticInstructionsFor(6);
  assert.ok(!b.includes('mutated'));
});
