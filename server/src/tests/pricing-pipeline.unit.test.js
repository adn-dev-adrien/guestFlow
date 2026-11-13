// specs/pricing-components.md §3 rules 43 and 52 — `utils/pricing/pipeline.js`: freely chainable steps over one context.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPipeline, HALT } = require('../utils/pricing/pipeline');

const step = (id, requires, provides, apply) => ({ id, requires, provides, apply });
const add = (key, value) => step(`add-${key}`, [], [key], (ctx) => ({ ...ctx, [key]: value }));

test('rule 52: steps run in order, each reading what an earlier one provided', () => {
  const run = buildPipeline([
    add('a', 2),
    step('double', ['a'], ['b'], (ctx) => ({ ...ctx, b: ctx.a * 2 })),
    step('sum', ['a', 'b', 'x'], ['c'], (ctx) => ({ ...ctx, c: ctx.a + ctx.b + ctx.x })),
  ], { initial: ['x'] });
  assert.deepEqual(run.steps, ['add-a', 'double', 'sum']);
  const out = run({ x: 10 });
  assert.deepEqual({ a: out.a, b: out.b, c: out.c, x: out.x }, { a: 2, b: 4, c: 16, x: 10 });
});

test('rule 52: a step requiring a key nobody provided throws PIPELINE_MISSING_INPUT <step>.<key> at build time', () => {
  assert.throws(() => buildPipeline([step('needs', ['ghost'], [], (ctx) => ctx)]), { code: 'PIPELINE_MISSING_INPUT', message: 'PIPELINE_MISSING_INPUT needs.ghost' });
  assert.throws(() => buildPipeline([step('late', ['a'], [], (ctx) => ctx), add('a', 1)]), /PIPELINE_MISSING_INPUT late\.a/);
});

test('rule 52: a key provided twice (or already in the initial context) throws PIPELINE_DUPLICATE_PROVIDE at build time', () => {
  assert.throws(() => buildPipeline([add('a', 1), step('again', [], ['a'], (ctx) => ctx)]), { code: 'PIPELINE_DUPLICATE_PROVIDE', message: 'PIPELINE_DUPLICATE_PROVIDE again.a' });
  assert.throws(() => buildPipeline([add('a', 1)], { initial: ['a'] }), /PIPELINE_DUPLICATE_PROVIDE add-a\.a/);
});

test('rule 52: two steps cannot share an id', () => {
  assert.throws(() => buildPipeline([add('a', 1), add('a', 1)]), /PIPELINE_DUPLICATE_STEP add-a/);
});

test('rule 52: the context a step receives is frozen — a step returns a new one, it never mutates', () => {
  const run = buildPipeline([
    step('mutator', [], ['a'], (ctx) => { 'use strict'; ctx.a = 1; return ctx; }),
  ]);
  assert.throws(() => run({}), TypeError);
  const initial = { x: 1 };
  const out = buildPipeline([add('a', 1)], { initial: ['x'] })(initial);
  assert.deepEqual(initial, { x: 1 }, 'the caller\'s object is untouched');
  assert.ok(Object.isFrozen(out));
});

test('rule 52: a step may halt the run with a finished result; a declared key it fails to return fails the run', () => {
  let reached = false;
  const run = buildPipeline([
    step('stop', [], ['a', HALT], (ctx) => ({ ...ctx, halt: { error: 'none' } })),
    step('never', [], ['b'], (ctx) => { reached = true; return { ...ctx, b: 1 }; }),
  ]);
  assert.deepEqual(run({}).halt, { error: 'none' });
  assert.equal(reached, false);
  const lying = buildPipeline([step('liar', [], ['a'], (ctx) => ctx)]);
  assert.throws(() => lying({}), { code: 'PIPELINE_MISSING_OUTPUT', message: 'PIPELINE_MISSING_OUTPUT liar.a' });
});
