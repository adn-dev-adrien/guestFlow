const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  fetchAllowed,
  downloadToFile,
  sha256File,
  assertMemberPaths,
  assertNoLinkMembers,
  assertReleaseLayout,
  stageRelease,
  pruneReleases,
} = require('../utils/updateStaging');
const { resolvePaths } = require('../utils/deploymentPaths');

// specs/self-update-and-releases.md §3.D rules 22-25. The archive is untrusted input: these tests
// pin the refusals, because every one of them is the difference between "the update did not
// install" and "something else installed itself".

function tmpDir(prefix = 'gf-staging-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ----- archive member validation -----

test('assertMemberPaths accepts a well-formed archive', () => {
  const names = ['guestflow-1.1.0/', 'guestflow-1.1.0/server/src/index.js'].join('\n');
  assert.equal(assertMemberPaths(names, 'guestflow-1.1.0'), true);
});

test('assertMemberPaths refuses absolute paths, traversal and foreign roots', () => {
  const cases = [
    ['/etc/cron.d/evil', 'ARCHIVE_ABSOLUTE_MEMBER'],
    ['~/.ssh/authorized_keys', 'ARCHIVE_ABSOLUTE_MEMBER'],
    ['guestflow-1.1.0/../../../etc/passwd', 'ARCHIVE_TRAVERSAL_MEMBER'],
    ['some-other-tree/server/src/index.js', 'ARCHIVE_UNEXPECTED_ROOT'],
    ['guestflow-1.1.0-evil/x', 'ARCHIVE_UNEXPECTED_ROOT'],
  ];
  for (const [name, code] of cases) {
    assert.throws(() => assertMemberPaths(name, 'guestflow-1.1.0'), (err) => err.message.startsWith(code), name);
  }
  assert.throws(() => assertMemberPaths('', 'guestflow-1.1.0'), /EMPTY_ARCHIVE/);
});

test('assertNoLinkMembers refuses symlinks and hardlinks in both tar dialects', () => {
  // GNU tar and bsdtar disagree on the columns; the entry type character does not.
  const gnuSymlink = 'lrwxrwxrwx runner/docker 0 2026-08-20 09:00 guestflow-1.1.0/x -> /etc/passwd';
  const bsdSymlink = 'lrwxr-xr-x  0 adrien staff 0 Aug 20 12:00 guestflow-1.1.0/x -> /etc/passwd';
  const hardlink = 'hrw-r--r-- runner/docker 0 2026-08-20 09:00 guestflow-1.1.0/y';
  for (const line of [gnuSymlink, bsdSymlink, hardlink]) {
    assert.throws(() => assertNoLinkMembers(line), /ARCHIVE_LINK_MEMBER/, line);
  }
  assert.equal(assertNoLinkMembers('-rw-r--r--  0 adrien staff 100 Aug 20 12:00 guestflow-1.1.0/ok'), true);
  assert.equal(assertNoLinkMembers('drwxr-xr-x  0 adrien staff 0 Aug 20 12:00 guestflow-1.1.0/'), true);
});

// ----- host allowlist on every redirect hop -----

test('fetchAllowed refuses a redirect that leaves the allowlist', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('github.com')) {
      return { status: 302, headers: { get: () => 'https://evil.example/payload.tar.gz' } };
    }
    return { ok: true, status: 200 };
  };
  await assert.rejects(
    fetchAllowed('https://github.com/adn-dev-adrien/guestFlow/releases/download/v1.1.0/x.tar.gz', { fetchImpl }),
    /FORBIDDEN_HOST/,
  );
});

test('fetchAllowed follows an allowed redirect to the storage host', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('github.com/adn-dev-adrien')) {
      return { status: 302, headers: { get: () => 'https://objects.githubusercontent.com/blob' } };
    }
    return { ok: true, status: 200 };
  };
  const res = await fetchAllowed('https://github.com/adn-dev-adrien/guestFlow/releases/download/v1.1.0/x.tar.gz', { fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(seen.length, 2);
});

test('fetchAllowed refuses a non-https URL outright', async () => {
  await assert.rejects(fetchAllowed('http://github.com/x', { fetchImpl: async () => ({ ok: true }) }), /FORBIDDEN_HOST/);
});

// ----- size cap -----

test('downloadToFile refuses a body larger than the cap and leaves no file behind', async () => {
  const dir = tmpDir();
  const dest = path.join(dir, 'archive.tar.gz');
  const fetchImpl = async () => new Response(Buffer.alloc(4096));
  await assert.rejects(
    downloadToFile({ url: 'https://github.com/x', destFile: dest, maxBytes: 1024, fetchImpl }),
    /ARCHIVE_TOO_LARGE/,
  );
  assert.equal(fs.existsSync(dest), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('downloadToFile refuses on a declared content-length over the cap', async () => {
  const dir = tmpDir();
  const fetchImpl = async () => new Response(Buffer.alloc(10), { headers: { 'content-length': '999999999' } });
  await assert.rejects(
    downloadToFile({ url: 'https://github.com/x', destFile: path.join(dir, 'a.tgz'), maxBytes: 1024, fetchImpl }),
    /ARCHIVE_TOO_LARGE/,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

// ----- layout assertion -----

function writeFakeRelease(root, version, { withClient = true, packageVersion = version } = {}) {
  fs.mkdirSync(path.join(root, 'server', 'src'), { recursive: true });
  if (withClient) fs.mkdirSync(path.join(root, 'client', 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'guestflow', version: packageVersion }));
  fs.writeFileSync(path.join(root, 'server', 'package.json'), JSON.stringify({ name: 'guestflow-server', version: packageVersion }));
  fs.writeFileSync(path.join(root, 'server', 'src', 'index.js'), '// server\n');
  if (withClient) fs.writeFileSync(path.join(root, 'client', 'build', 'index.html'), '<!doctype html>');
}

test('assertReleaseLayout demands a complete tree carrying the announced version', () => {
  const dir = tmpDir();
  writeFakeRelease(dir, '1.1.0');
  assert.equal(assertReleaseLayout(dir, '1.1.0'), true);
  assert.throws(() => assertReleaseLayout(dir, '1.2.0'), /RELEASE_VERSION_MISMATCH/);

  const incomplete = tmpDir();
  writeFakeRelease(incomplete, '1.1.0', { withClient: false });
  assert.throws(() => assertReleaseLayout(incomplete, '1.1.0'), /RELEASE_LAYOUT_MISSING/);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(incomplete, { recursive: true, force: true });
});

// ----- the whole staging chain against a real archive -----

async function buildFixture(version = '9.9.9') {
  const work = tmpDir('gf-fixture-');
  const src = path.join(work, 'src');
  const root = `guestflow-${version}`;
  fs.mkdirSync(src, { recursive: true });
  writeFakeRelease(path.join(src, root), version);
  const archive = path.join(work, `${root}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', src, root]);
  return { work, archive, version, root, sha: await sha256File(archive) };
}

function fixtureFetch(fixture, { corrupt = false } = {}) {
  return async (url) => {
    if (url.endsWith('.tar.gz')) {
      const buf = fs.readFileSync(fixture.archive);
      return new Response(corrupt ? Buffer.concat([buf, Buffer.from('x')]) : buf);
    }
    if (url.endsWith('SHA256SUMS')) {
      return new Response(`${fixture.sha}  guestflow-${fixture.version}.tar.gz\n`);
    }
    throw new Error(`unexpected url ${url}`);
  };
}

function fixtureRelease(fixture) {
  const base = 'https://github.com/adn-dev-adrien/guestFlow/releases/download';
  return {
    version: fixture.version,
    archive: { name: `guestflow-${fixture.version}.tar.gz`, url: `${base}/v${fixture.version}/guestflow-${fixture.version}.tar.gz` },
    checksums: { name: 'SHA256SUMS', url: `${base}/v${fixture.version}/SHA256SUMS` },
  };
}

test('stageRelease downloads, verifies, extracts, installs and promotes', async () => {
  const fixture = await buildFixture();
  const deploy = tmpDir('gf-deploy-');
  const paths = resolvePaths({ DB_PATH: path.join(deploy, 'data', 'guestflow.db') });
  const phases = [];
  let installedIn = null;

  const finalDir = await stageRelease({
    release: fixtureRelease(fixture),
    paths,
    onPhase: (p) => phases.push(p),
    fetchImpl: fixtureFetch(fixture),
    installImpl: async ({ releaseDir }) => { installedIn = releaseDir; },
  });

  assert.deepEqual(phases, ['downloading', 'verifying', 'extracting', 'installing']);
  assert.equal(finalDir, path.join(paths.releasesDir, fixture.version));
  assert.equal(fs.existsSync(path.join(finalDir, 'server', 'src', 'index.js')), true);
  assert.equal(fs.existsSync(path.join(finalDir, 'client', 'build', 'index.html')), true);
  assert.equal(installedIn, path.join(paths.releasesDir, `${fixture.version}.partial`));
  // The staged tree must already point at the persistent secrets and uploads: an archive carries
  // code only, and booting a release without its `.env.local` silently rotates every secret.
  assert.equal(fs.lstatSync(path.join(finalDir, 'server', '.env.local')).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(finalDir, 'server', 'uploads')).isSymbolicLink(), true);
  assert.equal(
    fs.realpathSync(path.join(finalDir, 'server', 'uploads')),
    fs.realpathSync(path.join(paths.dataDir, 'uploads')),
  );
  // The temporary archive is always cleaned up.
  assert.equal(fs.existsSync(path.join(paths.tmpDir, `guestflow-${fixture.version}.tar.gz`)), false);

  fs.rmSync(fixture.work, { recursive: true, force: true });
  fs.rmSync(deploy, { recursive: true, force: true });
});

test('stageRelease aborts on a checksum mismatch and installs nothing', async () => {
  const fixture = await buildFixture();
  const deploy = tmpDir('gf-deploy-');
  const paths = resolvePaths({ DB_PATH: path.join(deploy, 'data', 'guestflow.db') });
  let installed = false;

  await assert.rejects(
    stageRelease({
      release: fixtureRelease(fixture),
      paths,
      fetchImpl: fixtureFetch(fixture, { corrupt: true }),
      installImpl: async () => { installed = true; },
    }),
    /CHECKSUM_MISMATCH/,
  );

  assert.equal(installed, false);
  assert.equal(fs.existsSync(path.join(paths.releasesDir, fixture.version)), false);
  assert.equal(fs.existsSync(path.join(paths.releasesDir, `${fixture.version}.partial`)), false);

  fs.rmSync(fixture.work, { recursive: true, force: true });
  fs.rmSync(deploy, { recursive: true, force: true });
});

test('stageRelease refuses a release whose version is not a strict semver', async () => {
  await assert.rejects(
    stageRelease({ release: { version: '1.1' }, paths: resolvePaths({ DB_PATH: '/tmp/none/guestflow.db' }) }),
    /INVALID_VERSION/,
  );
});

// ----- retention -----

test('pruneReleases keeps the N newest by version and never deletes a protected one', () => {
  const dir = tmpDir();
  const releases = path.join(dir, 'releases');
  for (const v of ['1.0.0', '1.2.0', '1.10.0', '1.9.0', 'not-a-version']) {
    fs.mkdirSync(path.join(releases, v), { recursive: true });
  }
  const deleted = pruneReleases({ releasesDir: releases, keep: 2, protectDirs: [path.join(releases, '1.0.0')] });
  const left = fs.readdirSync(releases).sort();
  // 1.10.0 and 1.9.0 are the two newest (numeric compare, not lexicographic).
  assert.deepEqual(left, ['1.0.0', '1.10.0', '1.9.0', 'not-a-version']);
  assert.deepEqual(deleted, ['1.2.0']);
  fs.rmSync(dir, { recursive: true, force: true });
});
