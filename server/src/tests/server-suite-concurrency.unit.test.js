// specs/tech/server-test-isolation.md rule 24 — the server suite runs four test files at a time. It is safe because each
// process gets its own database even when the caller sets DB_PATH (the preload forces it), and because no test file
// takes a machine-wide resource another file running beside it could want: a literal port.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', '..');
const script = JSON.parse(fs.readFileSync(path.join(SERVER, 'package.json'), 'utf8')).scripts.test;

function testFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (entry.name.endsWith('.js') && (entry.name.endsWith('.test.js') || /[\\/]tests[\\/]/.test(full))) out.push(full);
  }
  return out;
}

test('rule 24: npm test runs four files at a time, once', () => {
  assert.deepEqual(script.match(/--test-concurrency=\d+/g), ['--test-concurrency=4']);
});

test('rule 24: the preload gives every process its own database, even over a DB_PATH the caller set', () => {
  const preload = fs.readFileSync(path.join(__dirname, 'setup', 'isolateDefaultDb.js'), 'utf8');
  assert.match(preload, /\.isolate\(\{ force: true \}\)/);
  assert.match(script, /--require \.\/src\/tests\/setup\/isolateDefaultDb\.js/);
});

test('rule 24: no test file listens on a literal port', () => {
  const offenders = testFiles(path.join(SERVER, 'src'))
    .filter((file) => /\.listen\(\s*[1-9]\d{1,4}\b/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(SERVER, file));
  assert.deepEqual(offenders, []);
});
