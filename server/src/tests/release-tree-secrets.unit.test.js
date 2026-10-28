// specs/self-update-and-releases.md rule 39 — a release archive is built from tracked files only and is
// refused when a secret or a runtime file reached its staging tree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const RELEASE = fs.readFileSync(path.join(ROOT, 'release.sh'), 'utf8');
const load = () => import(path.join(ROOT, 'scripts', 'check-release-tree.mjs'));

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-release-tree-'));
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), 'x');
  }
  return dir;
}

test('rule 39: every kind of secret or runtime file is found', async () => {
  const { findForbiddenFiles } = await load();
  const dir = tree([
    'server/.env.local', 'server/.env', 'server/guestflow.db', 'server/guestflow.db-wal', 'server/guestflow.db-shm',
    'server/licence.jws', 'server/certs/site.key', 'server/certs/site.pem', 'server/update-state.json',
    'server/uploads/guest-photo.jpg', 'server/pm2.log',
  ]);
  assert.deepEqual(findForbiddenFiles(dir), [
    'server/.env', 'server/.env.local', 'server/certs/site.key', 'server/certs/site.pem', 'server/guestflow.db',
    'server/guestflow.db-shm', 'server/guestflow.db-wal', 'server/licence.jws', 'server/pm2.log',
    'server/update-state.json', 'server/uploads/guest-photo.jpg',
  ]);
});

test('rule 39: a clean tree passes — certs/README, .gitkeep, .env.example and node_modules are fine', async () => {
  const { findForbiddenFiles } = await load();
  const dir = tree([
    'server/src/index.js', 'server/certs/README.md', 'server/certs/.gitkeep', 'server/uploads/.gitkeep',
    'server/.env.example', 'server/node_modules/x/.env', 'client/build/index.html', 'package.json',
  ]);
  assert.deepEqual(findForbiddenFiles(dir), []);
});

test('rule 39: the CLI exits 1 and names the file', () => {
  const dir = tree(['server/.env.local']);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-release-tree.mjs'), dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /server\/\.env\.local/);
});

test('rule 39: release.sh copies the tracked server files only and runs the check before the archive', () => {
  assert.match(RELEASE, /git ls-files server \| rsync -a --files-from=-/);
  assert.doesNotMatch(RELEASE, /cp -r server\/uploads/);
  assert.ok(RELEASE.indexOf('check-release-tree.mjs') < RELEASE.indexOf('tar -czf'), 'the check runs before the archive is made');
});
