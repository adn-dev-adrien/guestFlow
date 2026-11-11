// specs/pricing-components.md §3 rule 50 — « no component reads a property row »: every parameter reaches the pricing through
// the SettingsProvider, so no file under `utils/pricing/` reads a field of a `property` (or `policy.property`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'utils', 'pricing');

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

// The row itself, not only a field of it: `const { x } = property`, `const p = ctx.property`, `({ property }) =>`. `compose.js` is
// the one unit that carries the row, because the quote has a `property` key (rule 4); it reads no field of it.
const READS_THE_ROW = [/\}\s*=\s*(\w+\.)*property\b/, /=\s*(\w+\.)*property\s*[;,)]/, /\{\s*property\s*\}/];
const MAY_CARRY_THE_ROW = ['compose.js'];

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('rule 50 — no file under utils/pricing reads a property row (allow-list empty)', () => {
  const hits = [];
  for (const file of filesUnder(ROOT)) {
    stripComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, index) => {
      const readsRow = !MAY_CARRY_THE_ROW.includes(path.relative(ROOT, file)) && READS_THE_ROW.some((re) => re.test(line));
      if (readsRow || /\bproperty\??\.\w/.test(line) || /\bproperty\[/.test(line)) hits.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('rule 50 — the guard catches a destructured property row, however it is written', () => {
  for (const line of ['const { checkInTime } = property;', 'const { depositPercent } = ctx.property;', 'const p = ctx.property;', 'const f = ({ property }) => 1;', 'const { property } = ctx;']) {
    assert.ok(READS_THE_ROW.some((re) => re.test(line)), line);
  }
  for (const line of ['scope: \'property\',', 'const x = settings.get(\'depositPercent\');', 'return { property, settings };']) {
    assert.ok(!READS_THE_ROW.some((re) => re.test(line)), line);
  }
});
