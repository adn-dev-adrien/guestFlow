/**
 * Staging phase of a self-update (specs/self-update-and-releases.md §3.D).
 *
 * Everything here runs while the CURRENT version is still serving requests: download, integrity
 * check, extraction, dependency install, native rebuild, smoke test, database backup. Any failure
 * aborts with the running application untouched — which is the whole point of splitting staging from
 * the swap. In particular the `better-sqlite3` ABI check happens here, because that exact failure
 * has already taken production down when it was only discovered after the restart.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { isAllowedDownloadUrl, parseSha256Sums } = require('./releaseClient');
const { isValidVersion } = require('./semver');
const { linkPersistentPaths } = require('./releaseLinks');

const execFileAsync = promisify(execFile);

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const NPM_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Fetch a URL, following redirects by hand so that EVERY hop is checked against the host allowlist.
 * `redirect: 'follow'` would only let us inspect the final URL, which is one hop too late.
 */
async function fetchAllowed(url, { fetchImpl = fetch, headers = {} } = {}) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isAllowedDownloadUrl(current)) {
      throw new Error(`FORBIDDEN_HOST:${current}`);
    }
    const res = await fetchImpl(current, { headers, redirect: 'manual' });
    const status = Number(res.status);
    if (status >= 300 && status < 400) {
      const location = typeof res.headers?.get === 'function' ? res.headers.get('location') : null;
      if (!location) throw new Error('REDIRECT_WITHOUT_LOCATION');
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`HTTP_${status}`);
    return res;
  }
  throw new Error('TOO_MANY_REDIRECTS');
}

/** Download to `destFile`, refusing anything larger than `maxBytes`. Returns the byte count. */
async function downloadToFile({ url, destFile, maxBytes = MAX_ARCHIVE_BYTES, fetchImpl = fetch }) {
  const res = await fetchAllowed(url, { fetchImpl });
  const declared = Number(res.headers?.get?.('content-length') || 0);
  if (declared && declared > maxBytes) throw new Error('ARCHIVE_TOO_LARGE');

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  let written = 0;
  const counter = new (require('stream').Transform)({
    transform(chunk, _enc, cb) {
      written += chunk.length;
      if (written > maxBytes) {
        cb(new Error('ARCHIVE_TOO_LARGE'));
        return;
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(destFile));
  } catch (err) {
    fs.rmSync(destFile, { force: true });
    throw err;
  }
  return written;
}

/** Fetch a small text asset (the checksums file) with the same host rules. */
async function fetchText({ url, fetchImpl = fetch }) {
  const res = await fetchAllowed(url, { fetchImpl });
  return res.text();
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

/**
 * Every member path must sit under `<expectedRoot>/`: absolute paths and `..` traversal are refused
 * outright. `listing` is the output of `tar -tzf` — one name per line, identical on GNU tar and
 * bsdtar, which is why the paths are read from there and not from the verbose listing.
 */
function assertMemberPaths(listing, expectedRoot) {
  const names = String(listing).split('\n').map((l) => l.trim()).filter(Boolean);
  if (names.length === 0) throw new Error('EMPTY_ARCHIVE');
  for (const name of names) {
    if (name.startsWith('/') || name.startsWith('~')) throw new Error(`ARCHIVE_ABSOLUTE_MEMBER:${name}`);
    if (name.split('/').includes('..')) throw new Error(`ARCHIVE_TRAVERSAL_MEMBER:${name}`);
    const normalised = name.replace(/\/+$/, '');
    if (normalised !== expectedRoot && !name.startsWith(`${expectedRoot}/`)) {
      throw new Error(`ARCHIVE_UNEXPECTED_ROOT:${name}`);
    }
  }
  return true;
}

/**
 * No symlink and no hardlink may enter the release tree — a link is how an archive reaches outside
 * the directory it was extracted into. `listing` is the output of `tar -tvzf`, whose columns differ
 * between GNU tar and bsdtar; only the first character (the entry type) is read here, and that one
 * is the same everywhere.
 */
function assertNoLinkMembers(listing) {
  for (const line of String(listing).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const type = trimmed[0];
    if (type === 'l' || type === 'h') throw new Error(`ARCHIVE_LINK_MEMBER:${trimmed}`);
  }
  return true;
}

/** Both member checks, in one call. Pure, so the whole rule set is unit-testable. */
function assertArchiveMembers({ names, verbose, expectedRoot }) {
  assertNoLinkMembers(verbose);
  return assertMemberPaths(names, expectedRoot);
}

/** List, validate, then extract — in that order, always. */
async function extractArchive({ archiveFile, destDir, expectedRoot }) {
  const options = { maxBuffer: 32 * 1024 * 1024 };
  const [{ stdout: names }, { stdout: verbose }] = await Promise.all([
    execFileAsync('tar', ['-tzf', archiveFile], options),
    execFileAsync('tar', ['-tvzf', archiveFile], options),
  ]);
  assertArchiveMembers({ names, verbose, expectedRoot });
  fs.mkdirSync(destDir, { recursive: true });
  await execFileAsync('tar', ['-xzf', archiveFile, '-C', destDir, '--strip-components=1', '--no-same-owner'], options);
}

/** The extracted tree must actually look like a GuestFlow release of the expected version. */
function assertReleaseLayout(releaseDir, expectedVersion) {
  const required = [
    path.join(releaseDir, 'package.json'),
    path.join(releaseDir, 'server', 'src', 'index.js'),
    path.join(releaseDir, 'server', 'package.json'),
    path.join(releaseDir, 'client', 'build', 'index.html'),
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) throw new Error(`RELEASE_LAYOUT_MISSING:${path.relative(releaseDir, file)}`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(releaseDir, 'package.json'), 'utf8'));
  if (pkg.version !== expectedVersion) {
    throw new Error(`RELEASE_VERSION_MISMATCH:${pkg.version}`);
  }
  return true;
}

/**
 * Install production dependencies and make sure the native module actually loads.
 *
 * `npm ci --omit=dev` first (plain, so `sharp` keeps its prebuilt binary), then a from-source
 * rebuild of `better-sqlite3` alone so its ABI matches the Node that will run it — the same
 * two-step the deploy workflow used, for the same reason.
 */
async function installDependencies({ releaseDir, execFileImpl = execFileAsync }) {
  const serverDir = path.join(releaseDir, 'server');
  const options = { cwd: serverDir, timeout: NPM_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 };
  await execFileImpl('npm', ['ci', '--omit=dev'], options);
  await execFileImpl('npm', ['rebuild', 'better-sqlite3'], {
    ...options,
    env: { ...process.env, npm_config_build_from_source: 'true' },
  });
  await execFileImpl(process.execPath, ['-e', "require('better-sqlite3')"], options);
}

/**
 * The full staging sequence. `onPhase(phase)` is called before each step so the caller can publish
 * progress. Returns the promoted release directory.
 */
async function stageRelease({
  release,
  paths,
  onPhase = () => {},
  fetchImpl = fetch,
  installImpl = installDependencies,
}) {
  if (!isValidVersion(release.version)) throw new Error('INVALID_VERSION');
  const { version } = release;
  const expectedRoot = `guestflow-${version}`;
  const tmpArchive = path.join(paths.tmpDir, `${expectedRoot}.tar.gz`);
  const partialDir = path.join(paths.releasesDir, `${version}.partial`);
  const finalDir = path.join(paths.releasesDir, version);

  fs.rmSync(partialDir, { recursive: true, force: true });
  fs.mkdirSync(paths.tmpDir, { recursive: true });
  fs.mkdirSync(paths.releasesDir, { recursive: true });

  try {
    onPhase('downloading');
    await downloadToFile({ url: release.archive.url, destFile: tmpArchive, fetchImpl });

    onPhase('verifying');
    const sums = parseSha256Sums(await fetchText({ url: release.checksums.url, fetchImpl }));
    const expected = sums[release.archive.name];
    if (!expected) throw new Error('CHECKSUM_MISSING');
    const actual = await sha256File(tmpArchive);
    if (actual !== expected) throw new Error('CHECKSUM_MISMATCH');

    onPhase('extracting');
    await extractArchive({ archiveFile: tmpArchive, destDir: partialDir, expectedRoot });
    assertReleaseLayout(partialDir, version);

    // An archive carries code only. Point the new tree at the secrets, uploads and certificates
    // that must survive the swap — before it can ever be booted without them.
    linkPersistentPaths({ releaseDir: partialDir, paths });

    onPhase('installing');
    await installImpl({ releaseDir: partialDir });

    // Promote only once everything above succeeded: `releases/<version>` existing means "usable".
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(partialDir, finalDir);
    return finalDir;
  } catch (err) {
    fs.rmSync(partialDir, { recursive: true, force: true });
    throw err;
  } finally {
    fs.rmSync(tmpArchive, { force: true });
  }
}

/** Keep the `keep` most recent release directories (plus whatever `current` points at). */
function pruneReleases({ releasesDir, keep = 3, protectDirs = [] }) {
  let entries;
  try {
    entries = fs.readdirSync(releasesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && isValidVersion(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
  const { compareVersions } = require('./semver');
  const ordered = entries.sort((a, b) => compareVersions(b, a));
  const protectedSet = new Set(protectDirs.map((d) => path.basename(d)));
  const deleted = [];
  for (const name of ordered.slice(keep)) {
    if (protectedSet.has(name)) continue;
    try {
      fs.rmSync(path.join(releasesDir, name), { recursive: true, force: true });
      deleted.push(name);
    } catch {
      // Disk hygiene must never fail an update.
    }
  }
  return deleted;
}

module.exports = {
  MAX_ARCHIVE_BYTES,
  fetchAllowed,
  downloadToFile,
  fetchText,
  sha256File,
  assertArchiveMembers,
  assertMemberPaths,
  assertNoLinkMembers,
  extractArchive,
  assertReleaseLayout,
  linkPersistentPaths,
  installDependencies,
  stageRelease,
  pruneReleases,
};
