/**
 * Wiring a freshly staged release to the data that must survive it
 * (specs/self-update-and-releases.md §3.D rule 25b).
 *
 * A release archive is code only. Three paths inside `server/` are NOT code and must point at the
 * persistent locations instead, or swapping `current` silently destroys them:
 *
 *   server/.env.local  → data/.env.local   the session secret and the AES encryption key. Losing it
 *                                          is the worst failure of the three and the quietest: the
 *                                          new version boots fine, generates fresh secrets, logs
 *                                          everyone out — and can no longer decrypt the Google,
 *                                          SMTP, Qonto and Météo credentials stored at rest. The
 *                                          health check would happily call that update a success.
 *   server/uploads     → data/uploads      the company logo and uploaded documents.
 *   server/certs       → <root>/certs      TLS material, when the deployment serves its own HTTPS.
 *   server/guestflow.db → data/guestflow.db  belt and braces: `DB_PATH` in ecosystem.config.js is
 *                                          what actually selects the database, but if it were ever
 *                                          dropped the fallback path is release-local — and a
 *                                          release-local fallback means booting on a blank
 *                                          database that looks like a working install.
 *
 * The old deploy workflow did this with `ln -s` and a `cp -r` of uploads; the same job now belongs
 * to staging, so a failure aborts the update while the current version is still serving.
 */

const fs = require('fs');
const path = require('path');

/**
 * Point `linkPath` at `targetPath`.
 *
 * A real file or directory already sitting at `linkPath` (an archive that shipped one) is folded
 * into the persistent location before being replaced — never deleted outright. Existing files in
 * the target win: the persistent copy is the reference.
 */
function linkPersistentPath(linkPath, targetPath, { createTargetDir = false } = {}) {
  if (createTargetDir) fs.mkdirSync(targetPath, { recursive: true });
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  let existing = null;
  try {
    existing = fs.lstatSync(linkPath);
  } catch {
    existing = null;
  }

  if (existing && !existing.isSymbolicLink()) {
    if (existing.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      fs.cpSync(linkPath, targetPath, { recursive: true, force: false, errorOnExist: false });
    } else if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.copyFileSync(linkPath, targetPath);
    }
  }

  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(targetPath, linkPath);
  return linkPath;
}

/**
 * Link every persistent path into `releaseDir`. Returns the links created.
 *
 * `.env.local` is linked even when the persistent file does not exist yet: the application writes
 * its generated secrets through the symlink, so the file lands in `data/` where the next release
 * will find it — which is exactly how a first install bootstraps itself.
 */
function linkPersistentPaths({ releaseDir, paths }) {
  const serverDir = path.join(releaseDir, 'server');
  const created = [];

  created.push(linkPersistentPath(path.join(serverDir, '.env.local'), path.join(paths.dataDir, '.env.local')));
  created.push(linkPersistentPath(path.join(serverDir, 'uploads'), path.join(paths.dataDir, 'uploads'), { createTargetDir: true }));
  created.push(linkPersistentPath(path.join(serverDir, 'guestflow.db'), paths.dbPath));

  // Certificates only when this host actually keeps some — a deployment behind a reverse proxy has
  // none, and inventing an empty directory would be misleading.
  const certsDir = path.join(paths.deployRoot, 'certs');
  if (fs.existsSync(certsDir)) {
    created.push(linkPersistentPath(path.join(serverDir, 'certs'), certsDir));
  }

  return created;
}

module.exports = { linkPersistentPath, linkPersistentPaths };
