// specs/pricing-components.md §3 rules 2 and 43 — one direction of dependency, enforced statically: a unit under
// `utils/pricing/` (sub-folders included) imports no unit downstream of it, no `models/`, no `database`, reaches none of
// them through a module outside `utils/pricing/` either, reads no clock without an argument (`Date.now()`, `new Date()`,
// `todayIso()`) and no `process.env`; NIGHTS, EXTRA GUESTS and TOURIST TAX know nothing of extras or payments, and EXTRAS
// read the nights only. The judgement is `helpers/pricingImportGraph.js` (ranks, patterns), proved on synthetic trees by
// `pricing-import-graph-mutants.unit.test.js`.
//
// Rule 43 — every unit file has its own test, `pricing-<unit>.unit.test.js` / `articles-family-<family>.unit.test.js`, or
// is listed in INTERNAL with the test that covers it.
//
// ALLOWED_VIOLATIONS lists the not-yet-moved parts that still break the rule, as `file -> what`. It MUST be empty at the
// end of PR A: it is empty today, and a unit that needs an entry here is a unit that is not ready to be moved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { keyOf, violationsOf, RANK } = require('./helpers/pricingImportGraph');

const ROOT = path.join(__dirname, '..', 'utils', 'pricing');
const ALLOWED_VIOLATIONS = [];

const readFile = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return undefined; } };
const unitFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  walk(ROOT);
  return out;
};
const unitName = (file) => path.relative(ROOT, file).replace(/\.js$/, '');

test('rule 2 — every unit file declares its place in the dependency order (its own rank or its folder\'s)', () => {
  const unranked = unitFiles().map(unitName).filter((name) => !keyOf(name));
  assert.deepEqual(unranked, [], 'declare the rank of a new unit in helpers/pricingImportGraph.js before adding it');
});

test('rule 2 — no unit imports a downstream unit, models/ or database, nor reads the clock or the environment', () => {
  const problems = [];
  for (const file of unitFiles()) {
    for (const what of violationsOf({ file, source: fs.readFileSync(file, 'utf8'), root: ROOT, readFile })) {
      const key = `${unitName(file)} -> ${what}`;
      if (!ALLOWED_VIOLATIONS.includes(key)) problems.push(key);
    }
  }
  assert.deepEqual(problems, []);
});

test('rule 2 — the allow-list is empty (PR A closes with every unit clean)', () => {
  assert.deepEqual(ALLOWED_VIOLATIONS, []);
});

test('rule 2 — nothing under utils/pricing reads process.env, steps included', () => {
  const offenders = unitFiles().filter((file) => /\bprocess\.env\b/.test(fs.readFileSync(file, 'utf8'))).map(unitName);
  assert.deepEqual(offenders, []);
});

test('rule 2 — the rank table has no unit without a file (a removed unit leaves no stale rank)', () => {
  const names = new Set(unitFiles().map(unitName));
  const stale = Object.keys(RANK).filter((key) => !names.has(key) && !['articles', 'vat', 'refunds'].includes(key));
  assert.deepEqual(stale, []);
});

// A unit that is not the subject of a test of its own, with the test that covers it.
const INTERNAL = {
  'articles/index': 'articles-head-contract',
  'articles/registry': 'articles-head-contract',
  'articles/lineSnapshot': 'articles-head-contract',
  'articles/makeArticle': 'article-family-contract',
  'articles/units': 'article-family-contract',
  'articles/familyKit': 'article-family-contract',
  'articles/pluginFamily': 'articles-head-plugin-family',
  'vat/index': 'vat-component',
  'vat/settingsSchema': 'vat-component',
};
const kebab = (name) => name.replace(/([A-Z])/g, '-$1').toLowerCase();
const testFor = (name) => {
  if (name in INTERNAL) return INTERNAL[name];
  if (name.startsWith('articles/families/')) return `articles-family-${kebab(path.basename(name))}`;
  if (name.startsWith('refunds/')) return `pricing-refunds-${kebab(path.basename(name))}`;
  return `pricing-${kebab(name)}`;
};

test('rule 43 — every unit file (sub-folders included, steps excepted) has its own test file or a listed covering test', () => {
  const missing = unitFiles().map(unitName)
    .filter((name) => !name.startsWith('steps/'))
    .filter((name) => !fs.existsSync(path.join(__dirname, `${testFor(name)}.unit.test.js`)));
  assert.deepEqual(missing, []);
});

test('rule 43 — an INTERNAL entry names a unit that exists and a test that mentions it', () => {
  for (const [name, covering] of Object.entries(INTERNAL)) {
    assert.ok(fs.existsSync(path.join(ROOT, `${name}.js`)), `${name} is gone: remove its INTERNAL entry`);
    const source = fs.readFileSync(path.join(__dirname, `${covering}.unit.test.js`), 'utf8');
    assert.ok(source.includes(path.basename(name)) || source.includes(name.split('/')[0]), `${covering} does not mention ${name}`);
  }
});
