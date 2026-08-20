const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { linkPersistentPath, linkPersistentPaths } = require('../utils/releaseLinks');
const { resolvePaths } = require('../utils/deploymentPaths');

// specs/self-update-and-releases.md §3.D rule 25b.
//
// The failure this prevents is the quiet one: a release archive is code only, so a swapped-in tree
// has no `.env.local`. The new version boots perfectly, generates a fresh session secret and a
// fresh AES key, logs everyone out and can no longer decrypt the Google / SMTP / Qonto / Météo
// credentials stored at rest. Every health check passes. Nothing rolls back.

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-links-'));
  const paths = resolvePaths({ DB_PATH: path.join(dir, 'data', 'guestflow.db') });
  const releaseDir = path.join(paths.releasesDir, '1.1.0');
  fs.mkdirSync(path.join(releaseDir, 'server'), { recursive: true });
  fs.mkdirSync(paths.dataDir, { recursive: true });
  return { dir, paths, releaseDir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('the new release reads the SAME secrets file as the one it replaces', () => {
  const { paths, releaseDir, cleanup } = fixture();
  fs.writeFileSync(path.join(paths.dataDir, '.env.local'), 'GUESTFLOW_ENCRYPTION_KEY=keep-me\n');

  linkPersistentPaths({ releaseDir, paths });

  const linked = path.join(releaseDir, 'server', '.env.local');
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
  assert.match(fs.readFileSync(linked, 'utf8'), /keep-me/);
  cleanup();
});

test('a first install links a not-yet-existing secrets file, so generated secrets land in data/', () => {
  const { paths, releaseDir, cleanup } = fixture();
  linkPersistentPaths({ releaseDir, paths });

  const linked = path.join(releaseDir, 'server', '.env.local');
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
  // The application writes through the link; the file must materialise in data/, not in the release.
  fs.writeFileSync(linked, 'GUESTFLOW_SESSION_SECRET=generated\n');
  assert.match(fs.readFileSync(path.join(paths.dataDir, '.env.local'), 'utf8'), /generated/);
  cleanup();
});

test('uploads survive the swap and their directory is created when missing', () => {
  const { paths, releaseDir, cleanup } = fixture();
  fs.mkdirSync(path.join(paths.dataDir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(paths.dataDir, 'uploads', 'logo.png'), 'PNG');

  linkPersistentPaths({ releaseDir, paths });

  assert.equal(fs.readFileSync(path.join(releaseDir, 'server', 'uploads', 'logo.png'), 'utf8'), 'PNG');
  cleanup();
});

test('files shipped inside the archive are folded into the persistent copy, never dropped', () => {
  const { paths, releaseDir, cleanup } = fixture();
  const shipped = path.join(releaseDir, 'server', 'uploads');
  fs.mkdirSync(shipped, { recursive: true });
  fs.writeFileSync(path.join(shipped, 'shipped.png'), 'NEW');
  fs.mkdirSync(path.join(paths.dataDir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(paths.dataDir, 'uploads', 'existing.png'), 'OLD');

  linkPersistentPaths({ releaseDir, paths });

  const persistent = path.join(paths.dataDir, 'uploads');
  assert.deepEqual(fs.readdirSync(persistent).sort(), ['existing.png', 'shipped.png']);
  assert.equal(fs.lstatSync(shipped).isSymbolicLink(), true);
  cleanup();
});

test('an existing persistent file wins over the one shipped in the archive', () => {
  const { paths, releaseDir, cleanup } = fixture();
  fs.mkdirSync(path.join(paths.dataDir, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(paths.dataDir, 'uploads', 'logo.png'), 'THE REAL ONE');
  const shipped = path.join(releaseDir, 'server', 'uploads');
  fs.mkdirSync(shipped, { recursive: true });
  fs.writeFileSync(path.join(shipped, 'logo.png'), 'a stale copy');

  linkPersistentPaths({ releaseDir, paths });

  assert.equal(fs.readFileSync(path.join(paths.dataDir, 'uploads', 'logo.png'), 'utf8'), 'THE REAL ONE');
  cleanup();
});

test('the database path is linked too, so a dropped DB_PATH cannot boot on a blank database', () => {
  const { paths, releaseDir, cleanup } = fixture();
  fs.writeFileSync(paths.dbPath, 'SQLite format 3');

  linkPersistentPaths({ releaseDir, paths });

  const linked = path.join(releaseDir, 'server', 'guestflow.db');
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(linked), fs.realpathSync(paths.dbPath));
  cleanup();
});

test('certificates are linked only on a host that keeps some', () => {
  const { paths, releaseDir, cleanup } = fixture();
  linkPersistentPaths({ releaseDir, paths });
  assert.equal(fs.existsSync(path.join(releaseDir, 'server', 'certs')), false, 'no certs dir → no link invented');

  fs.mkdirSync(path.join(paths.deployRoot, 'certs'), { recursive: true });
  fs.writeFileSync(path.join(paths.deployRoot, 'certs', 'server.crt'), 'CERT');
  linkPersistentPaths({ releaseDir, paths });
  assert.equal(fs.readFileSync(path.join(releaseDir, 'server', 'certs', 'server.crt'), 'utf8'), 'CERT');
  cleanup();
});

test('linking is idempotent — re-staging the same release does not stack links', () => {
  const { paths, releaseDir, cleanup } = fixture();
  linkPersistentPaths({ releaseDir, paths });
  linkPersistentPaths({ releaseDir, paths });
  const linked = path.join(releaseDir, 'server', 'uploads');
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(linked), fs.realpathSync(path.join(paths.dataDir, 'uploads')));
  cleanup();
});

test('linkPersistentPath replaces a stale link pointing somewhere else', () => {
  const { dir, paths, releaseDir, cleanup } = fixture();
  const link = path.join(releaseDir, 'server', 'uploads');
  const elsewhere = path.join(dir, 'elsewhere');
  fs.mkdirSync(elsewhere, { recursive: true });
  fs.symlinkSync(elsewhere, link);

  linkPersistentPath(link, path.join(paths.dataDir, 'uploads'), { createTargetDir: true });
  assert.equal(fs.realpathSync(link), fs.realpathSync(path.join(paths.dataDir, 'uploads')));
  cleanup();
});
