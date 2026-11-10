// specs/server-test-isolation.md rule 15 (audit R36-S4) — `npm test` runs one process per file and its --test-timeout also
// cuts the whole file: a test's own `{ timeout }` above it is dead. No server test asks for more than the cap, and the
// per-field fuzz is split so that each half runs well under it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..', '..');
const capOf = () => Number(/--test-timeout=(\d+)/.exec(JSON.parse(fs.readFileSync(path.join(SERVER, 'package.json'), 'utf8')).scripts.test)[1]);

function testFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'apps') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

// A test's own option: `test(name, { timeout: N }, …)`, `}, { timeout: N })`, `describe(…, { timeout: N }`.
const OWN_TIMEOUT = /(?:\b(?:test|it|describe)(?:\.\w+)?\([^\n]*|^\s*\}\s*,\s*)\{\s*(?:\w+:\s*[^,}]+,\s*)*timeout:\s*([\d_]+)/gm;

test('rule 15 — no server test asks for a timeout above the per-file cap', () => {
  const cap = capOf();
  assert.equal(cap, 60000);
  const over = testFiles(path.join(SERVER, 'src')).filter((file) => file !== __filename).flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(OWN_TIMEOUT)]
    .filter((m) => Number(m[1].replace(/_/g, '')) > cap)
    .map((m) => `${path.relative(SERVER, file)}: ${m[1]}`));
  assert.deepEqual(over, []);
});

test('rule 15 — the reader sees the forms it judges', () => {
  const read = (src) => [...src.matchAll(OWN_TIMEOUT)].map((m) => m[1]);
  assert.deepEqual(read("test('x', { timeout: 300000 }, async () => {"), ['300000']);
  assert.deepEqual(read("test('x', { skip: false, timeout: 90_000 }, () => {"), ['90_000']);
  assert.deepEqual(read("  }, { timeout: 120000 });"), ['120000']);
  assert.deepEqual(read("spawnSync(node, args, { encoding: 'utf8', timeout: 120000 });"), [], 'a child process budget is not a test option');
});

test('rule 15 — the per-field fuzz is two files sharing one runner, every row in exactly one', () => {
  const { isStayRow } = require('./inputShapePerField');
  for (const name of ['input-shape-per-field.unit.test.js', 'input-shape-per-field-others.unit.test.js']) {
    assert.match(fs.readFileSync(path.join(__dirname, name), 'utf8'), /perFieldSuite\(\{ part: /, name);
  }
  const rows = [['PUT', '/api/reservations/1'], ['POST', '/api/devis'], ['POST', '/api/users'], ['POST', '/api/reservationsX'], ['POST', () => {}]];
  assert.deepEqual(rows.map(isStayRow), [true, true, false, false, true]);
});
