// specs/pricing-components.md §3 rule 66 — rewrites `fixtures/no-duplicate-formulas/<guard>.json` from the tree as it is:
// one entry per surviving copy, nothing stale. An entry that already carries its removedBy and reason keeps them; a new
// one gets the PR and the reason of its guard (`helpers/formulaGuards.js`). Without `--write` it only prints the sizes.
//   node server/src/tests/helpers/regenerateFormulaAllowLists.js [--write]
const fs = require('node:fs');
const path = require('node:path');
const { GUARDS, removedByOf, reasonOf } = require('./formulaGuards');
const { hitsOfFiles, entriesOf } = require('./formulaScan');

const SRC = path.join(__dirname, '..', '..');
const LISTS = path.join(__dirname, '..', 'fixtures', 'no-duplicate-formulas');

function sources(dir = SRC, out = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'tests' && entry.name !== 'node_modules' && entry.name !== '__tests__') sources(full, out);
    } else if (entry.name.endsWith('.js')) out[path.relative(SRC, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
  }
  return out;
}

const tree = sources();
const write = process.argv.includes('--write');
for (const guard of GUARDS) {
  const file = path.join(LISTS, `${guard.name}.json`);
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const entries = entriesOf(hitsOfFiles(tree, guard), previous, (f, text, pr) => {
    const removedBy = pr || removedByOf(guard, f, text);
    return { removedBy, reason: reasonOf(guard, f, text, removedBy) };
  });
  const byPr = entries.reduce((acc, e) => ({ ...acc, [e.removedBy]: (acc[e.removedBy] || 0) + (e.count || 1) }), {});
  console.log(`${guard.name}: ${entries.length} entries, ${entries.reduce((n, e) => n + (e.count || 1), 0)} lines`, JSON.stringify(byPr));
  if (write) fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`);
}
