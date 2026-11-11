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

const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('rule 50 — no file under utils/pricing reads a property row (allow-list empty)', () => {
  const hits = [];
  for (const file of filesUnder(ROOT)) {
    stripComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, index) => {
      if (/\bproperty\??\.\w/.test(line) || /\bproperty\[/.test(line)) hits.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});
