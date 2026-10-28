/**
 * The releases installed on the host (specs/hosting-h1-fleet-runtime.md rule 8, H-D4): each
 * version is downloaded once with its `SHA256SUMS`, verified, unpacked to `<releases>/<version>/`
 * and given its dependencies there; every instance on that version shares the directory.
 *
 * The download and the checks are the self-update's own (server/src/utils/updateStaging.js): the
 * same host allowlist, the same archive member rules, the same layout check. A directory under
 * `releases/` whose name is a version is, by construction, complete: work happens in
 * `<version>.partial` and is renamed only at the end.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { releaseClient, updateStaging, releaseSignature, semver } = require('./gf');

const MESSAGES = {
  CHECKSUM_MISSING: 'L’empreinte SHA-256 de l’archive est absente de la version publiée.',
  CHECKSUM_MISMATCH: 'L’archive ne correspond pas à son empreinte SHA-256 : version refusée.',
  LOCKFILE_UNTRUSTED: 'Le fichier de verrouillage des dépendances de la version pointe hors du registre npm : version refusée.',
  SIGNATURE_MISSING: 'La version n’est pas signée alors qu’une clé de signature est configurée : version refusée.',
  SIGNATURE_INVALID: 'La signature de la version ne correspond pas à la clé configurée : version refusée.',
  SIGNATURE_KEY_INVALID: 'La clé publique de signature des versions est illisible : version refusée.',
  FORBIDDEN_HOST: 'Le téléchargement pointait vers un hôte non autorisé : version refusée.',
  ARCHIVE_TOO_LARGE: 'L’archive dépasse la taille autorisée.',
  ARCHIVE_LINK_MEMBER: 'L’archive contient un lien symbolique : version refusée.',
  ARCHIVE_ABSOLUTE_MEMBER: 'L’archive contient un chemin absolu : version refusée.',
  ARCHIVE_TRAVERSAL_MEMBER: 'L’archive contient un chemin remontant : version refusée.',
  ARCHIVE_UNEXPECTED_ROOT: 'L’archive n’a pas la structure attendue : version refusée.',
  RELEASE_LAYOUT_MISSING: 'L’archive ne contient pas une version complète de GuestFlow.',
  RELEASE_VERSION_MISMATCH: 'L’archive ne correspond pas à la version annoncée.',
  EMPTY_ARCHIVE: 'L’archive téléchargée est vide.',
};

function frenchError(err) {
  const raw = String(err.message || '');
  const code = raw.split(':')[0];
  const e = new Error(MESSAGES[code] || `Installation impossible : ${raw.split('\n')[0].slice(0, 300)}`);
  e.code = MESSAGES[code] ? code : 'INSTALL_FAILED';
  return e;
}

// A release is read by every instance (group guestflow-app, through the setgid releases/ directory)
// and written by nobody but the console: group read (and execute where the owner has it), never group
// write, nothing for others — whatever umask extracted it (review 2026-10-17). Links are left alone.
// The group is the release directory's (setgid from releases/): a copy keeps its source's group
// (libuv's copyfile), which would hide that file from the instances — found on the real-host check.
function shareRelease(root) {
  const gid = fs.statSync(root).gid;
  const stack = [root];
  while (stack.length) {
    const p = stack.pop();
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.gid !== gid) fs.chownSync(p, st.uid, gid);
    const owner = st.mode & 0o700;
    if (st.isDirectory()) {
      fs.chmodSync(p, owner | 0o050 | (st.mode & 0o2000));
      for (const name of fs.readdirSync(p)) stack.push(path.join(p, name));
    } else if (st.isFile()) {
      fs.chmodSync(p, owner | 0o040 | (owner & 0o100 ? 0o010 : 0));
    }
  }
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

function createReleases({ dir, fetchImpl = fetch, installImpl = updateStaging.installDependencies, now = () => new Date(), releasePublicKey = releaseSignature.releasePublicKeyFromEnv() }) {
  let installing = null;

  function list() {
    let names = [];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && semver.isValidVersion(e.name)).map((e) => e.name);
    } catch {
      return [];
    }
    return names.sort((a, b) => semver.compareVersions(b, a)).map((version) => {
      const stat = fs.statSync(path.join(dir, version));
      return { version, installedAt: stat.mtime.toISOString(), dir: path.join(dir, version) };
    });
  }

  const has = (version) => semver.isValidVersion(version) && fs.existsSync(path.join(dir, version, 'server', 'src', 'index.js'));
  const newest = () => (list()[0] || {}).version || null;
  const dirOf = (version) => path.join(dir, version);

  // The newest published version on GitHub, normalised (archive and checksums), or null.
  async function published() {
    const feed = await releaseClient.fetchReleaseFeed({ fetchImpl });
    return feed && feed.release ? feed.release : null;
  }

  /**
   * Rule 8: download, verify, unpack, install the dependencies. `release` is a normalised release
   * ({ version, archive: { name, url }, checksums: { url } }). → the release directory.
   */
  async function install(release, { onPhase = () => {} } = {}) {
    if (!release || !semver.isValidVersion(release.version)) throw new Error('Version invalide.');
    if (has(release.version)) return dirOf(release.version);
    if (installing) throw Object.assign(new Error(`Installation de la ${installing} en cours.`), { code: 'BUSY' });
    installing = release.version;
    const { version } = release;
    const expectedRoot = `guestflow-${version}`;
    const tmpDir = path.join(dir, '.tmp');
    const archive = path.join(tmpDir, `${expectedRoot}-${now().getTime()}.tar.gz`);
    const partial = path.join(dir, `${version}.partial`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.rmSync(partial, { recursive: true, force: true });
    try {
      onPhase('downloading');
      await updateStaging.downloadToFile({ url: release.archive.url, destFile: archive, fetchImpl });
      onPhase('verifying');
      const sumsBytes = await updateStaging.fetchBuffer({ url: release.checksums.url, fetchImpl });
      await releaseSignature.assertSumsSigned({
        sums: sumsBytes,
        signature: release.checksumsSignature,
        publicKey: releasePublicKey,
        fetchSignature: (asset) => updateStaging.fetchText({ url: asset.url, fetchImpl }),
      });
      const sums = releaseClient.parseSha256Sums(sumsBytes.toString('utf8'));
      const expected = sums[release.archive.name];
      if (!expected) throw new Error('CHECKSUM_MISSING');
      if (await sha256File(archive) !== expected) throw new Error('CHECKSUM_MISMATCH');
      onPhase('extracting');
      await updateStaging.extractArchive({ archiveFile: archive, destDir: partial, expectedRoot });
      updateStaging.assertReleaseLayout(partial, version);
      onPhase('installing');
      await installImpl({ releaseDir: partial });
      shareRelease(partial);
      fs.renameSync(partial, dirOf(version));
      return dirOf(version);
    } catch (err) {
      fs.rmSync(partial, { recursive: true, force: true });
      throw frenchError(err);
    } finally {
      fs.rmSync(archive, { force: true });
      installing = null;
    }
  }

  return { dir, list, has, newest, dirOf, published, install, installing: () => installing };
}

module.exports = { createReleases, sha256File, shareRelease, MESSAGES };
