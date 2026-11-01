// specs/server-test-isolation.md rule 12 — a test process starts without the shell's GuestFlow flags:
// the `npm test` preload deletes every GUESTFLOW_* variable but the runner's own GUESTFLOW_TEST_* knobs,
// and the E2E servers, which set GUESTFLOW_DISABLE_OUTBOUND on purpose, never load it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PRELOAD = path.join(__dirname, 'setup', 'isolateDefaultDb.js');
const SERVER_ROOT = path.join(__dirname, '..', '..');
const ROOT = path.join(SERVER_ROOT, '..');

const SHELL = {
  GUESTFLOW_MANAGED: '1',
  GUESTFLOW_DISABLE_OUTBOUND: '1',
  GUESTFLOW_SELF_UPDATE: 'off',
  GUESTFLOW_PLUGINS: 'packages',
  GUESTFLOW_ICAL_ALLOW_PRIVATE: '1',
  GUESTFLOW_TEST_EXIT_GRACE_MS: '300',
  NODE_ENV: 'test',
};

// The child stays under the runner (NODE_TEST_CONTEXT inherited), so rule 4 gives it its own temp state.
function inChild(args, code) {
  const env = { ...process.env, ...SHELL };
  for (const k of ['DB_PATH', 'PERSISTENT_DB', 'GUESTFLOW_LOCAL_ENV', 'GUESTFLOW_UPLOADS_DIR']) delete env[k];
  assert.ok(env.NODE_TEST_CONTEXT, 'run under node --test');
  const r = spawnSync(process.execPath, [...args, '-e', code], { cwd: SERVER_ROOT, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const flagsOf = `JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('GUESTFLOW_') && !['GUESTFLOW_LOCAL_ENV', 'GUESTFLOW_UPLOADS_DIR'].includes(k))))`;

test('rule 12: the preload drops every GUESTFLOW_* flag the shell exports, the runner knobs kept', () => {
  const flags = inChild(['--require', PRELOAD], `console.log(${flagsOf})`);
  assert.deepEqual(flags, { GUESTFLOW_TEST_EXIT_GRACE_MS: '300' });
});

test('rule 12: under the preload, GUESTFLOW_MANAGED=1 in the shell no longer hands the plugins to the operator', () => {
  const out = inChild(['--require', PRELOAD], `
    const { operatorManaged } = require('./src/utils/pluginGovernance');
    const before = operatorManaged();
    process.env.GUESTFLOW_MANAGED = '1';
    console.log(JSON.stringify({ before, inline: operatorManaged() }));
  `);
  assert.deepEqual(out, { before: false, inline: true }, 'a test that needs the flag sets it inline');
});

test('rule 12: the app itself keeps its flags — database.js and instancePaths strip nothing', () => {
  const flags = inChild([], `require('./src/database'); require('./src/utils/instancePaths'); console.log(${flagsOf})`);
  assert.equal(flags.GUESTFLOW_DISABLE_OUTBOUND, '1');
  assert.equal(flags.GUESTFLOW_MANAGED, '1');
});

test('rule 12: no E2E launcher and no app module loads the preload', () => {
  for (const rel of ['playwright.config.js', 'playwright.bare.config.js', 'playwright.prod.config.js', 'playwright.removal.config.js', 'e2e/prod/serve.js', 'e2e/removal/serve.js']) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /isolateDefaultDb|tests\/setup/, rel);
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'playwright.config.js'), 'utf8'), /GUESTFLOW_DISABLE_OUTBOUND=1[\s\S]*node src\/index\.js/);
  const appFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'tests' && entry.name !== 'node_modules') walk(full);
      } else if (entry.name.endsWith('.js')) appFiles.push(full);
    }
  };
  walk(path.join(SERVER_ROOT, 'src'));
  for (const file of appFiles) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /isolateDefaultDb/, path.relative(ROOT, file));
  assert.ok(JSON.parse(fs.readFileSync(path.join(SERVER_ROOT, 'package.json'), 'utf8')).scripts.start.indexOf('isolateDefaultDb') === -1);
});
