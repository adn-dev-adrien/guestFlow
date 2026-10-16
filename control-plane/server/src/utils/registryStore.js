/**
 * The official plugin registry (specs/plugins-phase-4-registry.md rules 6–8, P23).
 *
 * The operator uploads `<id>-<version>.tgz` packages from the console page « Registre ». Each is read
 * with GuestFlow's own checks — the archive's members (rule 1) and the manifest (rule 2) — so a
 * package the console accepts is one every instance accepts. It is stored under
 * `CP_DATA_DIR/registry/`, and the index is rebuilt and signed with the licence key (rule 30 of the
 * control-plane spec): `index.json` + `index.json.sig`, the base64 Ed25519 signature of its bytes.
 * A withdrawn version leaves the index; an instance that runs it keeps it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { packages } = require('./gf');
const { httpError } = require('./httpError');

const FILE_RE = /^([a-z][a-z0-9-]{1,40})-(\d+\.\d+\.\d+)\.tgz$/;

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function createRegistryStore({ db, dir, privateKey, now = () => new Date() }) {
  fs.mkdirSync(dir, { recursive: true });
  const listStmt = db.prepare('SELECT id, version, sha256, size, manifest, published_at AS publishedAt, withdrawn_at AS withdrawnAt FROM registry_packages ORDER BY id, published_at');
  const getStmt = db.prepare('SELECT 1 FROM registry_packages WHERE id = ? AND version = ?');
  const insertStmt = db.prepare('INSERT INTO registry_packages (id, version, sha256, size, manifest, published_at) VALUES (?, ?, ?, ?, ?, ?)');
  const withdrawStmt = db.prepare('UPDATE registry_packages SET withdrawn_at = ? WHERE id = ? AND version = ? AND withdrawn_at IS NULL');

  // The page renders these labels as they are (fat backend).
  const frDay = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);
  const sizeLabel = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`);
  const rows = () => listStmt.all().map((r) => ({
    ...r,
    manifest: JSON.parse(r.manifest),
    name: JSON.parse(r.manifest).name,
    sizeLabel: sizeLabel(r.size),
    publishedLabel: frDay(r.publishedAt),
    statusLabel: r.withdrawnAt ? `Retiré le ${frDay(r.withdrawnAt)}` : 'Publié',
  }));

  /** Rebuilds and signs the index from the published, not withdrawn, versions. */
  function sign() {
    const plugins = {};
    rows().filter((r) => !r.withdrawnAt).forEach((r) => {
      (plugins[r.id] ||= []).push({ version: r.version, sha256: r.sha256, size: r.size, manifest: r.manifest, publishedAt: r.publishedAt });
    });
    const bytes = Buffer.from(JSON.stringify({ format: 1, generatedAt: now().toISOString(), plugins }, null, 2));
    writeAtomic(path.join(dir, 'index.json'), bytes);
    writeAtomic(path.join(dir, 'index.json.sig'), `${crypto.sign(null, bytes, privateKey).toString('base64')}\n`);
    return bytes;
  }

  /** Rule 8 — validate one uploaded package and publish it. → the published row */
  async function publish(buffer, fileName) {
    const named = String(fileName || '').match(FILE_RE);
    if (!named) throw httpError(400, 'BAD_FILE_NAME', `« ${fileName || 'sans nom'} » : un paquet s’appelle <plugin>-<version>.tgz.`);
    const [, id, version] = named;
    if (!buffer || !buffer.length) throw httpError(400, 'EMPTY_FILE', `${fileName} : fichier vide.`);
    if (getStmt.get(id, version)) throw httpError(409, 'DUPLICATE_VERSION', `${id} ${version} est déjà publié.`);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-registry-'));
    const tgz = path.join(work, fileName);
    try {
      fs.writeFileSync(tgz, buffer);
      let manifest;
      try {
        await packages.extractPackage(tgz, path.join(work, 'x'));
        manifest = packages.assertPackageLayout(path.join(work, 'x'), { id, version });
      } catch (err) {
        const why = String(err.message || '').replace(/^PACKAGE_REJECTED:/, '').replace(/^INVALID_MANIFEST:/, '');
        throw httpError(422, 'INVALID_PACKAGE', `${fileName} refusé : ${why}`);
      }
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      fs.copyFileSync(tgz, path.join(dir, fileName));
      insertStmt.run(id, version, sha256, buffer.length, JSON.stringify(manifest), now().toISOString());
      sign();
      return rows().find((r) => r.id === id && r.version === version);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  /** Rule 8 — the version leaves the index; its file stays, for the instances that run it. */
  function withdraw(id, version) {
    if (!withdrawStmt.run(now().toISOString(), id, version).changes) {
      throw httpError(404, 'NOT_PUBLISHED', `${id} ${version} n’est pas publié.`);
    }
    sign();
    return rows().find((r) => r.id === id && r.version === version);
  }

  // The index on disk, signed at the last change (or now, the first time).
  function indexFiles() {
    if (!fs.existsSync(path.join(dir, 'index.json.sig'))) sign();
    return { index: path.join(dir, 'index.json'), signature: path.join(dir, 'index.json.sig') };
  }

  // Rule 7 — a package file, by its exact name only.
  function packageFile(name) {
    if (!FILE_RE.test(String(name))) return null;
    const file = path.join(dir, name);
    return fs.existsSync(file) ? file : null;
  }

  return { list: rows, publish, withdraw, sign, indexFiles, packageFile };
}

module.exports = { createRegistryStore, FILE_RE };
