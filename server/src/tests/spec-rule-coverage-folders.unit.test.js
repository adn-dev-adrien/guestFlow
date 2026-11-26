// specs/tech/spec-rule-coverage.md rules 20 and 21 (spec reorganization, 2026-11-26) — specs live in domain
// folders (`specs/<domain>/<name>.md`), the name stays the identity, and a path that points to no file
// is caught instead of silently misleading the reader.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const load = () => import(path.join(ROOT, 'scripts', 'check-spec-coverage.mjs'));
const loadRewrite = () => import(path.join(ROOT, 'scripts', 'rewrite-spec-paths.mjs'));
// Fixture paths are built from `S` so the coverage parser never reads them as real citations.
const S = 'specs';
const spec = (rules) => `# S\n\n## 3. Functional rules\n\n${rules}\n\n## 4. Architecture\n`;

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specs-'));
  const specs = path.join(dir, 'specs');
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(specs, rel)), { recursive: true });
    fs.writeFileSync(path.join(specs, rel), text);
  }
  return specs;
}

test('rule 20 — specs are read in every folder, and the index, template and method files are not specs', async () => {
  const { readSpecEntries, specsFromMarkdown } = await load();
  const dir = tree({
    'payments/refunds.md': spec('1. A\n2. B'),
    'sas/arrival.md': spec('1. A'),
    'payments/INDEX.md': '# Payments\n',
    'INDEX.md': '# Specs\n',
    'TEMPLATE.md': spec('1. A'),
    'README.md': '# Specs\n',
  });
  const entries = readSpecEntries(dir);
  assert.deepEqual(entries.map(([f, , rel]) => [f, rel]), [
    ['refunds.md', `${S}/payments/refunds.md`],
    ['arrival.md', `${S}/sas/arrival.md`],
  ]);
  assert.deepEqual([...specsFromMarkdown(entries).keys()].sort(), ['arrival', 'refunds']);
});

test('rule 20 — two files with the same name in two folders are refused', async () => {
  const { readSpecEntries, duplicateSpecNames } = await load();
  const dir = tree({ 'payments/refunds.md': spec('1. A'), 'sas/refunds.md': spec('1. A'), 'sas/other.md': spec('1. A') });
  assert.deepEqual(duplicateSpecNames(readSpecEntries(dir)), [
    { name: 'refunds', paths: [`${S}/payments/refunds.md`, `${S}/sas/refunds.md`] },
  ]);
});

test('rule 20 — a citation names its spec by the last segment of the path, folder or not', async () => {
  const { parseCitations, rulesChangedInDiff } = await load();
  assert.deepEqual(parseCitations(`// ${S}/payments/refunds.md rules 2 and 3`), [
    { spec: 'refunds', rule: '2' }, { spec: 'refunds', rule: '3' },
  ]);
  const specsNow = new Map([['refunds', [{ id: '1' }, { id: '2' }]]]);
  const diff = `+++ b/${S}/payments/refunds.md\n+2. New rule\n+++ b/${S}/payments/INDEX.md\n+2. Not a rule\n`;
  assert.deepEqual(rulesChangedInDiff(diff, specsNow).addedRules, [{ spec: 'refunds', rule: '2', exempt: false }]);
});

test('rule 21 — a spec path that points to no file is reported, a real one is not', async () => {
  const { staleSpecPaths } = await load();
  const real = new Set([`${S}/payments/refunds.md`]);
  const source = `see ${S}/payments/refunds.md, ${S}/refunds.md and ${S}/gone.md, but not docs/${S}/x.md`;
  assert.deepEqual(staleSpecPaths(source, real), [`${S}/refunds.md`, `${S}/gone.md`]);
});

test('rule 21 — the rewrite resolves stale paths and moved relative links by name', async () => {
  const { rewrite, nameOf } = await loadRewrite();
  const index = new Map([
    ['refunds', `${S}/payments/refunds.md`],
    ['arrival', `${S}/sas/arrival.md`],
    ['tariff-recipes-plan', `${S}/pricing/tariff-recipes-plan.md`],
  ]);
  const files = new Set([...index.values()]);
  const exists = (rel) => files.has(rel);
  assert.equal(nameOf(`${S}/tariff-recipes/plan.md`), 'tariff-recipes-plan');

  const code = rewrite(`// ${S}/refunds.md rule 3 — ${S}/gone.md`, 'server/src/x.test.js', index, exists);
  assert.equal(code.text, `// ${S}/payments/refunds.md rule 3 — ${S}/gone.md`);
  assert.deepEqual(code.unresolved, [`${S}/gone.md`]);

  const doc = rewrite('[r](refunds.md#rule-3) and [a](arrival.md)', `${S}/sas/arrival.md`, index, exists);
  assert.equal(doc.text, '[r](../payments/refunds.md#rule-3) and [a](arrival.md)');
});
