const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { lengthOfStayDiscountsLabel, frPercent } = require('../labels');
const { createController } = require('../controller');

// specs/tariff-recipes/spec.md §3.2 rule (2026-10-27 audit) — the recipe card read
// « 7 nuits −42.857142857142854 % »: the server now sends the French label, one decimal at most.

const gite = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'recipes', 'gite-2027.json'), 'utf8'));

test('a fractional discount is printed in French with one decimal at most', () => {
  assert.equal(frPercent(42.857142857142854), '42,9 %');
  assert.equal(frPercent(40), '40 %');
  assert.equal(frPercent(12.5), '12,5 %');
});

test('the gîte recipe degressivity label never shows a raw float', () => {
  const label = lengthOfStayDiscountsLabel(gite);
  assert.match(label, /7 nuits −42,9 %/);
  assert.doesNotMatch(label, /\d\.\d/);
  assert.doesNotMatch(label, /857/);
});

test('no table → no label', () => {
  assert.equal(lengthOfStayDiscountsLabel({}), null);
  assert.equal(lengthOfStayDiscountsLabel({ lengthOfStayDiscounts: [] }), null);
});

test('GET /tariff-recipes/:id carries the ready label', () => {
  const controller = createController({
    db: { prepare: () => ({ all: () => [] }) },
    store: () => ({ getRecipe: () => gite, getRecipeMeta: () => ({}) }),
    model: () => ({}),
    properties: () => ({}),
    journal: () => ({}),
  });
  let body = null;
  controller.getOne({ params: { id: 'gite-2027' } }, { json: (b) => { body = b; return b; }, status() { return this; } });
  assert.match(body.labels.lengthOfStayDiscounts, /^2 nuits −/);
  assert.match(body.labels.lengthOfStayDiscounts, /42,9 %/);
});

// Same audit — the recipes page printed « `welcomePack.cost` » verbatim: a description is
// operator copy, not a code comment, so no shipped recipe may carry Markdown backticks in it.
test('shipped recipe descriptions carry no raw backticks', () => {
  const dir = path.join(__dirname, '..', 'recipes');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const recipe = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const field of ['label', 'description']) {
      assert.doesNotMatch(String(recipe[field] || ''), /`/, `${file} ${field}`);
    }
  }
});
