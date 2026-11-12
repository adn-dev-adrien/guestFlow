// specs/pricing-components.md §3 rules 2 and 43 — the judgement of the import graph of `utils/pricing/`, free of any
// file system access of its own: `readFile(absolutePath)` returns the source or `undefined`, so the rules are proved on
// synthetic trees (mutants) by `pricing-import-graph-mutants.unit.test.js` and run on the real tree by
// `pricing-import-graph.unit.test.js`.

const path = require('node:path');

// Rank = distance from the input: a unit may import only units of a strictly lower rank. Payments sit at the far end;
// EXTRAS (articles/) sit above the allowances and below the platform price. A file of `articles/`, `vat/` or `refunds/`
// takes its folder's rank; imports inside the same folder are free.
const RANK = {
  money: 0,
  storedLines: 0,
  nights: 1,
  stayClock: 1,
  vat: 1,
  extraGuests: 2,
  touristTax: 2,
  allowances: 3,
  timedOptions: 3,
  articles: 3.5,
  platformPrice: 4,
  discounts: 4,
  settlement: 5,
  totals: 6,
  schedule: 7,
  // PLATFORM PAYMENT is read by SETTLEMENT's `remainingToPay` (through `reservationSettlement`) and by REFUNDS (withheld commissions).
  platformPayment: 7.5,
  refunds: 8,
  // The backfill derivations of PR B read stored shapes only: after the units they describe.
  legacyCollectAt: 9,
  legacyAllocations: 9,
  // The orchestration sits above every unit: a step imports the units it calls, the use cases import the steps.
  pipeline: 100,
  pipelines: 200,
  compose: 300,
};
const STEPS = ['loadStay', 'clock', 'nights', 'extraGuests', 'discountLevers', 'extras', 'midStay', 'platformGross', 'touristTax',
  'platformPrice', 'discounts', 'vat', 'totals', 'inComplement', 'schedule', 'platformPayment', 'settlement', 'netTotals'];
for (const step of STEPS) RANK[`steps/${step}`] = 100;

const FOLDERS = ['articles', 'vat', 'refunds'];
const folderOf = (name) => FOLDERS.find((folder) => name.startsWith(`${folder}/`));
const keyOf = (name) => (name in RANK ? name : folderOf(name));
const rankOf = (name) => RANK[keyOf(name)];

const STAY_UNITS = ['nights', 'extraGuests', 'touristTax'];
const FORBIDDEN_FOR_STAY_UNITS = [/^articles(\/|$)/, /^allowances$/, /^platformPayment$/, /^settlement$/, /^schedule$/, /^totals$/];
// Rule 2: EXTRAS read NIGHTS (and the money), never the tourist tax or the extra guests.
const FORBIDDEN_FOR_ARTICLES = [/^touristTax$/, /^extraGuests$/];
const REFUNDS_MAY_IMPORT = ['money', 'platformPayment', 'storedLines'];
const FORBIDDEN_CLOSURE = [/(^|\/)models\//, /(^|\/)database$/, /plugins\/sdk\/registry$/, /(^|\/)priceLineContributors$/];

const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const importsOf = (source) => [...stripComments(source).matchAll(/require\(\s*(['"])(.+?)\1\s*\)/g)].map((m) => m[2]);

function resolveFile(readFile, from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (candidate.endsWith('.js') && readFile(candidate) !== undefined) return candidate;
  }
  return null;
}

// What a module outside `utils/pricing/` reaches through its own relative requires (the module itself included).
function reachedFrom(readFile, start, root, seen = new Set()) {
  const found = [];
  const walk = (file) => {
    if (seen.has(file) || (file !== start && !path.relative(root, file).startsWith('..'))) return;
    seen.add(file);
    found.push(file);
    const source = readFile(file);
    if (source === undefined) return;
    for (const spec of importsOf(source)) {
      if (!spec.startsWith('.')) continue;
      const resolved = resolveFile(readFile, file, spec);
      if (resolved) walk(resolved);
      else found.push(path.resolve(path.dirname(file), spec));
    }
  };
  walk(start);
  return found;
}

const PURITY = [
  { re: /\bDate\.now\s*\(/, what: 'reads the clock with Date.now()' },
  { re: /\bnew Date\(\s*\)/, what: 'reads the clock with new Date()' },
  { re: /\bnew Date\(\s*undefined/, what: 'reads the clock with new Date(undefined)' },
  { re: /\bprocess\.env\b/, what: 'reads process.env (a unit takes its parameters through the settings provider)' },
];
const PURITY_OUTSIDE_STEPS = [
  { re: /\btodayIso\s*\(/, what: 'reads the clock with todayIso()' },
  { re: /\bgetTodayIsoDate\s*\(/, what: 'reads the clock with getTodayIsoDate()' },
  { re: /\b\w*[lL]edger\.\w+\s*\(/, what: 'calls a ledger (a pure unit takes values, never ports)' },
];

// `name` is the unit's path under `utils/pricing/` without `.js`; `file` its absolute path; `root` the absolute
// `utils/pricing/`. Returns the list of reasons, empty when the unit is clean.
function violationsOf({ file, source, root, readFile }) {
  const name = path.relative(root, file).replace(/\.js$/, '');
  const isStep = name.startsWith('steps/');
  const code = stripComments(source);
  const found = [];
  const judgeEdge = (spec, target, via) => {
    const label = via ? `${spec} (through ${via})` : spec;
    if (target.startsWith('refunds/') && !name.startsWith('refunds/')) found.push(`imports ${label}: no pricing unit imports REFUNDS (rule 72)`);
    if (name.startsWith('refunds/') && !target.startsWith('refunds/') && !REFUNDS_MAY_IMPORT.includes(target) && !target.startsWith('vat')) {
      found.push(`imports ${label}: REFUNDS may import money, vat, platformPayment and the stored-line parsers only (rule 72)`);
    }
    if (folderOf(name) && folderOf(name) === folderOf(`${target}/`)) {
      if (name.startsWith('articles/families/') && /^articles(\/(index|registry))?$/.test(target)) found.push(`imports ${label}: a family never reaches the head or the registry`);
      return;
    }
    if (!(keyOf(target) in RANK)) { found.push(`imports ${label}, a unit without a declared rank`); return; }
    if (keyOf(name) in RANK && rankOf(target) >= rankOf(name)) found.push(`imports ${label}, a unit that is not upstream of it`);
    if (STAY_UNITS.includes(name) && FORBIDDEN_FOR_STAY_UNITS.some((pattern) => pattern.test(target))) found.push(`imports ${label}: a stay unit knows nothing of extras or payments`);
    if (name.startsWith('articles/') && FORBIDDEN_FOR_ARTICLES.some((pattern) => pattern.test(target))) found.push(`imports ${label}: extras read the nights only (rule 2)`);
  };
  for (const spec of importsOf(source)) {
    if (!spec.startsWith('.')) {
      if (/plugins\/sdk\/registry$|priceLineContributors$/.test(spec) && !isStep) found.push(`imports ${spec}: only a step reaches the plugin registries`);
      continue;
    }
    const absolute = path.resolve(path.dirname(file), spec);
    const target = path.relative(root, absolute).replace(/\.js$/, '').replace(/\/index$/, '');
    if (FORBIDDEN_CLOSURE.some((pattern) => pattern.test(absolute.split(path.sep).join('/')))) { found.push(`imports ${spec}`); continue; }
    if (!target.startsWith('..')) { judgeEdge(spec, target); continue; }
    // A module outside `utils/pricing/`: judged on what it reaches, and on the unit it forwards to when it is a shim.
    const resolved = resolveFile(readFile, file, spec);
    if (!resolved) continue;
    for (const reached of reachedFrom(readFile, resolved, root)) {
      const posix = reached.split(path.sep).join('/').replace(/\.js$/, '');
      if (FORBIDDEN_CLOSURE.some((pattern) => pattern.test(posix))) {
        found.push(`imports ${spec}, which reaches ${path.basename(reached, '.js')} (a model, the database or a plugin registry)`);
        break;
      }
    }
    for (const forwarded of importsOf(readFile(resolved))) {
      if (!forwarded.startsWith('.')) continue;
      const inside = path.relative(root, path.resolve(path.dirname(resolved), forwarded)).replace(/\.js$/, '').replace(/\/index$/, '');
      if (!inside.startsWith('..') && inside !== '') judgeEdge(spec, inside, 'a module outside utils/pricing');
    }
  }
  for (const { re, what } of [...PURITY, ...(isStep ? [] : PURITY_OUTSIDE_STEPS)]) if (re.test(code)) found.push(what);
  return found;
}

module.exports = { RANK, rankOf, keyOf, folderOf, violationsOf, importsOf, stripComments, STEPS };
