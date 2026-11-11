// specs/pricing-components.md §3 rules 2 and 43 — one direction of dependency, enforced statically: a unit under
// `utils/pricing/` imports no unit downstream of it, no `models/`, no `database`, and reads no clock without an
// argument (`Date.now()`, `new Date()`); NIGHTS, EXTRA GUESTS and TOURIST TAX know nothing of extras or payments.
//
// Rule 43 — every unit has its own test file, `pricing-<unit>.unit.test.js`, checked below.
//
// ALLOWED_VIOLATIONS lists the not-yet-moved parts that still break the rule, as `file -> what`. It MUST be empty at the
// end of PR A: it is empty today, and a unit that needs an entry here is a unit that is not ready to be moved.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'utils', 'pricing');
const ALLOWED_VIOLATIONS = [];

// Rank = distance from the input: a unit may import only units of a strictly lower rank (and `money`, rank 0).
// Payments sit at the far end; EXTRAS (articles/) sit between the stay units and the totals.
const RANK = {
  money: 0,
  nights: 1,
  extraGuests: 2,
  touristTax: 2,
  stayClock: 1,
  allowances: 3,
  platformPrice: 4,
  platformPayment: 90,
};
const STAY_UNITS = ['nights', 'extraGuests', 'touristTax'];
const FORBIDDEN_FOR_STAY_UNITS = [/^articles(\/|$)/, /^allowances$/, /^platformPayment$/, /^settlement$/, /^schedule$/, /^totals$/];

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
const importsOf = (source) => [...source.matchAll(/require\(\s*(['"])(.+?)\1\s*\)/g)].map((m) => m[2]);
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const violationsOf = (file) => {
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  const name = unitName(file);
  const found = [];
  for (const spec of importsOf(source)) {
    if (!spec.startsWith('.')) continue;
    const target = path.relative(ROOT, path.resolve(path.dirname(file), spec)).replace(/\.js$/, '');
    if (/(^|\/)models(\/|$)/.test(target) || /(^|\/)database$/.test(target)) found.push(`imports ${spec}`);
    else if (!target.startsWith('..')) {
      if (!(target in RANK) && !(name in RANK)) continue;
      if (!(target in RANK)) found.push(`imports ${spec}, a unit without a declared rank`);
      else if (name in RANK && RANK[target] >= RANK[name]) found.push(`imports ${spec}, a unit that is not upstream of it`);
      if (STAY_UNITS.includes(name) && FORBIDDEN_FOR_STAY_UNITS.some((pattern) => pattern.test(target))) found.push(`imports ${spec}: a stay unit knows nothing of extras or payments`);
    }
  }
  if (/\bDate\.now\s*\(/.test(source)) found.push('reads the clock with Date.now()');
  if (/new Date\(\s*\)/.test(source)) found.push('reads the clock with new Date()');
  return found;
};

test('rule 2 — every unit file declares its place in the dependency order', () => {
  const unranked = unitFiles().map(unitName).filter((name) => !(name in RANK) && !name.startsWith('articles/') && !name.startsWith('vat/'));
  assert.deepEqual(unranked, [], 'declare the rank of a new unit in this test before adding it');
});

test('rule 2 — no unit imports a downstream unit, models/ or database, nor reads the clock without an argument', () => {
  const problems = [];
  for (const file of unitFiles()) {
    for (const what of violationsOf(file)) {
      const key = `${unitName(file)} -> ${what}`;
      if (!ALLOWED_VIOLATIONS.includes(key)) problems.push(key);
    }
  }
  assert.deepEqual(problems, []);
});

test('rule 2 — the allow-list is empty (PR A closes with every unit clean)', () => {
  assert.deepEqual(ALLOWED_VIOLATIONS, []);
});

test('rule 2 — the detector catches an upstream import, a model import and a bare clock read', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'import-graph-'));
  const probe = path.join(dir, 'probe.js');
  fs.writeFileSync(probe, "const a = require('../x/models/ticketModel');\nconst now = Date.now();\nconst t = new Date();\n");
  const found = violationsOf(probe);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.ok(found.some((f) => f.includes('Date.now')));
  assert.ok(found.some((f) => f.includes('new Date()')));
  assert.ok(found.some((f) => f.includes('ticketModel')));
});

test('rule 43 — every unit file has its own test file, pricing-<unit>.unit.test.js', () => {
  const kebab = (name) => name.replace(/([A-Z])/g, '-$1').toLowerCase();
  const missing = unitFiles().map(unitName)
    .filter((name) => !name.includes('/'))
    .filter((name) => !fs.existsSync(path.join(__dirname, `pricing-${kebab(name)}.unit.test.js`)));
  assert.deepEqual(missing, []);
});
