// specs/pricing-components.md §3 rule 52 and §7 (`pipeline-composition`) — the use case is a list of steps whose `requires` /
// `provides` are checked when it is built: taking any step out of the real `stayQuote`, or providing a key twice, fails the
// build with the named code; `externalSale` and the other sales are not built in PR A.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPipeline } = require('../utils/pricing/pipeline');
const { stayQuote } = require('../utils/pricing/pipelines');

const STEPS_DIR = path.join(__dirname, '..', 'utils', 'pricing', 'steps');
const steps = stayQuote.steps.map((id) => require(path.join(STEPS_DIR, id)));

test('rule 52: the real stayQuote steps build as listed', () => {
  assert.doesNotThrow(() => buildPipeline(steps, { initial: ['input'] }));
});

test('rule 52: dropping a step that provides a key a later step requires throws PIPELINE_MISSING_INPUT', () => {
  const dropped = steps.filter((s) => s.id !== 'nights');
  assert.throws(() => buildPipeline(dropped, { initial: ['input'] }), (err) => err.code === 'PIPELINE_MISSING_INPUT' && /^PIPELINE_MISSING_INPUT \w+\.\w+$/.test(err.message));
});

test('rule 52: swapping two dependent steps throws PIPELINE_MISSING_INPUT, a repeated step throws before it runs', () => {
  const swapped = [...steps];
  const i = swapped.findIndex((s) => s.id === 'vat');
  const j = swapped.findIndex((s) => s.id === 'totals');
  [swapped[i], swapped[j]] = [swapped[j], swapped[i]];
  assert.throws(() => buildPipeline(swapped, { initial: ['input'] }), /PIPELINE_MISSING_INPUT totals\.familyVat/);
  assert.throws(() => buildPipeline([...steps, steps[2]], { initial: ['input'] }), /PIPELINE_DUPLICATE_STEP nights/);
});

test('rule 52: a step that provides a key an earlier one already provided throws PIPELINE_DUPLICATE_PROVIDE', () => {
  const clash = { id: 'clash', requires: [], provides: ['nights'], apply: (ctx) => ctx };
  assert.throws(() => buildPipeline([...steps, clash], { initial: ['input'] }), /PIPELINE_DUPLICATE_PROVIDE clash\.nights/);
});

test('rule 52: ficheSale, sasSale and shopSale are not built, and externalSale never calls nights, tax, clock or schedule', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'pricing', 'pipelines.js'), 'utf8');
  assert.ok(!/ficheSale\s*=|sasSale\s*=|shopSale\s*=/.test(source));
  assert.deepEqual([...require('../utils/pricing/pipelines').externalSale.steps].filter((id) => /nights|touristTax|clock|schedule|midStay/i.test(id)), []);
});
