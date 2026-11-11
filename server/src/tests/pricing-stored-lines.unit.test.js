// specs/pricing-components.md §3 rules 2 and 72 — the stored-format parsers live in `utils/pricing/storedLines.js`: SETTLEMENT
// re-exports them (so `midStayExtras` and every caller are unchanged) and REFUNDS reads them there, never through SETTLEMENT.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const storedLines = require('../utils/pricing/storedLines');
const settlement = require('../utils/pricing/settlement');
const midStayExtras = require('../utils/midStayExtras');

test('rule 72 — extraLineKey keys an option, a resource, a custom line by its normalised label, and nothing else', () => {
  const { extraLineKey } = storedLines;
  assert.equal(extraLineKey({ optionId: '12' }), 'opt:12');
  assert.equal(extraLineKey({ resourceId: 3 }), 'res:3');
  assert.equal(extraLineKey({ isCustom: 1, title: '  Bois   de CHAUFFAGE ' }), 'custom:bois de chauffage');
  assert.equal(extraLineKey({ customKey: 'k', title: '' }), null);
  assert.equal(extraLineKey({}), null);
  assert.equal(extraLineKey(null), null);
});

test('rule 72 — parseNotes and parseDetail read an array, a JSON array, or nothing', () => {
  for (const parse of [storedLines.parseNotes, storedLines.parseDetail]) {
    assert.deepEqual(parse([{ a: 1 }]), [{ a: 1 }]);
    assert.deepEqual(parse('[{"a":1}]'), [{ a: 1 }]);
    assert.deepEqual(parse(''), []);
    assert.deepEqual(parse(null), []);
    assert.deepEqual(parse('{"a":1}'), []);
    assert.deepEqual(parse('not json'), []);
  }
});

test('rule 72 — settledByKey sums what the notes collected per line key, ignoring lines with no key or no amount', () => {
  const notes = JSON.stringify([
    { lines: [{ key: 'opt:1', amount: 10.005 }, { optionId: 2, amount: '4' }, { key: 'opt:3', amount: 0 }, { amount: 5 }] },
    { lines: [{ key: 'opt:1', amount: 2.1 }, { key: 'opt:4', amount: 'abc' }] },
    null,
  ]);
  assert.deepEqual(storedLines.settledByKey(notes), { 'opt:1': 12.11, 'opt:2': 4 });
  assert.deepEqual(storedLines.settledByKey(null), {});
});

test('rule 72 — SETTLEMENT and midStayExtras re-export the very same functions', () => {
  for (const name of ['extraLineKey', 'parseNotes', 'parseDetail', 'settledByKey']) {
    assert.equal(settlement[name], storedLines[name], `settlement.${name}`);
    assert.equal(midStayExtras[name], storedLines[name], `midStayExtras.${name}`);
  }
});

test('rule 72 — no file of refunds/ reaches SETTLEMENT, directly or through the midStayExtras shim', () => {
  const dir = path.join(__dirname, '..', 'utils', 'pricing', 'refunds');
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    const code = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const [, target] of code.matchAll(/require\('([^']+)'\)/g)) {
      assert.ok(!/(^|\/)(settlement|midStayExtras)$/.test(target), `refunds/${file} requires ${target}`);
    }
  }
});
