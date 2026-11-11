// Shared by the specs/server-test-isolation.md rule 5 and rule 10 suites: runs a throw-away test file
// with the exact flags of a package's `npm test` script, so the tests pin what CI runs, not a copy of it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..', '..', '..');
const SUITES = ['server/package.json', 'control-plane/server/package.json'];

const testScript = (pkg) => JSON.parse(fs.readFileSync(path.join(root, pkg), 'utf8')).scripts.test;

// `node --test <flags> "<glob>" …` → the flags, globs dropped.
function suiteFlags(pkg) {
  const [bin, ...rest] = testScript(pkg).split(/\s+/);
  if (bin !== 'node' || rest[0] !== '--test') throw new Error(`${pkg}: the test script is not \`node --test …\``);
  return rest.filter((token) => !token.startsWith('"'));
}

function withTestFile(source, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-suite-flags-'));
  try {
    const file = path.join(dir, 'probe.test.js');
    fs.writeFileSync(file, source);
    return fn(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The package's flags with its timeout and the exit grace shrunk, run from the package's folder.
function runLikeSuite(pkg, file, { timeoutMs = 300, graceMs = 300, flags } = {}) {
  const args = (flags || suiteFlags(pkg)).map((f) => (f.startsWith('--test-timeout=') ? `--test-timeout=${timeoutMs}` : f));
  // The nested runner must not think it is a child of this one, or it reports in the parent's protocol.
  const env = { ...process.env, GUESTFLOW_TEST_EXIT_GRACE_MS: String(graceMs) };
  delete env.NODE_TEST_CONTEXT;
  const started = Date.now();
  const run = spawnSync(process.execPath, [...args, file], {
    cwd: path.join(root, path.dirname(pkg)), encoding: 'utf8', timeout: 60000, env,
  });
  return { ...run, elapsedMs: Date.now() - started, output: `${run.stdout}\n${run.stderr}` };
}

module.exports = { root, SUITES, testScript, suiteFlags, withTestFile, runLikeSuite };
