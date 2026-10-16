// specs/booking-extranet-intake.md rule 1 — everything ships in the plugin: no core file knows its tables, its
// routes or its folder, except the lists every plugin goes through.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..');
const ALLOWED = new Set([
  path.join('plugins', 'index.js'),
  path.join('constants', 'plugins.js'),
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'tests' || full.endsWith(path.join('plugins', 'booking-intake'))) continue;
      walk(full, out);
    } else if (/\.(js|sql)$/.test(e.name)) out.push(full);
  }
  return out;
}

test('specs/booking-extranet-intake.md rule 1: no core file mentions the plugin’s tables, routes or folder', () => {
  const offenders = walk(SRC)
    .filter((f) => !ALLOWED.has(path.relative(SRC, f)))
    .filter((f) => /booking_intakes|booking_dismissals|\/api\/booking-intake|\/public\/booking-intake|booking-intake/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(SRC, f)), []);
});
