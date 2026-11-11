const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'check-bundle-budget.mjs');
const SCRIPT = pathToFileURL(SCRIPT_PATH).href;

// specs/inte-performance.md rule 4 — the initial JavaScript has a budget; a page behind a dynamic
// import is not part of it.

const MANIFEST = {
  'index.html': { file: 'assets/index.js', isEntry: true, imports: ['_vendor.js'], dynamicImports: ['src/App.jsx'] },
  '_vendor.js': { file: 'assets/vendor.js' },
  'src/App.jsx': { file: 'assets/App.js', imports: ['_vendor.js', '_shared.js'], dynamicImports: ['src/pages/Finance.jsx'] },
  '_shared.js': { file: 'assets/shared.js' },
  'src/pages/Finance.jsx': { file: 'assets/Finance.js', imports: ['_vendor.js'] },
};
const SIZES = { 'assets/index.js': 70, 'assets/vendor.js': 100, 'assets/App.js': 40, 'assets/shared.js': 10, 'assets/Finance.js': 900 };
const size = (file) => SIZES[file];

test('rule 4: the initial weight counts the entry, its static imports and the boot chain, once each', async () => {
  const { initialWeight } = await import(SCRIPT);
  const { total, chunks } = initialWeight(MANIFEST, size);
  assert.equal(total, 220);
  assert.deepEqual(chunks.map((c) => c.file), ['assets/vendor.js', 'assets/index.js', 'assets/App.js', 'assets/shared.js']);
});

test('rule 4: a page behind a dynamic import of App is not counted', async () => {
  const { initialWeight } = await import(SCRIPT);
  const { chunks } = initialWeight(MANIFEST, size);
  assert.ok(!chunks.some((c) => c.file === 'assets/Finance.js'));
});

test('rule 4: under the budget passes, over it fails and names the heaviest chunks', async () => {
  const { checkBudget } = await import(SCRIPT);
  assert.equal(checkBudget(MANIFEST, size, 220).ok, true);
  const over = checkBudget(MANIFEST, size, 219);
  assert.equal(over.ok, false);
  assert.equal(over.chunks[0].file, 'assets/vendor.js');
});

test('rule 4: the CLI fails without a manifest, and on an over-budget build names the chunks', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-budget-'));
  try {
    const missing = spawnSync(process.execPath, [SCRIPT_PATH, '--dist', dist], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No manifest/);

    fs.mkdirSync(path.join(dist, '.vite'), { recursive: true });
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, '.vite', 'manifest.json'), JSON.stringify({ 'index.html': { file: 'assets/index.js', isEntry: true } }));
    fs.writeFileSync(path.join(dist, 'assets', 'index.js'), crypto.randomBytes(400000));
    const over = spawnSync(process.execPath, [SCRIPT_PATH, '--dist', dist], { encoding: 'utf8' });
    assert.equal(over.status, 1);
    assert.match(over.stderr, /Over the budget/);
    assert.match(over.stderr, /assets\/index\.js/);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
