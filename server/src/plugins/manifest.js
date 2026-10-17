/**
 * The plugin manifest (specs/plugins-phase-4-registry.md rule 2) — the single description of a
 * plugin: `id`, `name`, `version`, `description`, `icon`, `surfaces`, `requires` ([{ id, range }]),
 * `guestflow` (core range), `sdk` (SDK range), and `changelog` ({ version: [lines] }, rule 24).
 *
 * Host side of the contract, like the loader: the catalogue (`constants/plugins.js`), the package
 * store, the registry client, the package build and the control plane's registry all validate with
 * `validateManifest`, so a manifest the console accepts is one every instance can read.
 */

const fs = require('fs');
const path = require('path');
const { isVersion, isRange } = require('../utils/semverRange');

const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;
const SOURCE_ROOT = __dirname;

const isText = (v) => typeof v === 'string' && v.trim() !== '';

/** → [message] (French: the console shows them as they are). Empty when the manifest is valid. */
function validateManifest(manifest) {
  const m = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : null;
  if (!m) return ['manifest.json illisible.'];
  const errors = [];
  if (!isText(m.id) || !ID_RE.test(m.id)) errors.push('Identifiant absent ou invalide.');
  if (!isText(m.name)) errors.push('Nom absent.');
  if (!isVersion(m.version)) errors.push('Version absente ou invalide (x.y.z).');
  if (typeof m.description !== 'string') errors.push('Description absente.');
  if (typeof m.icon !== 'string') errors.push('Icône absente.');
  if (!Array.isArray(m.surfaces) || m.surfaces.some((s) => !isText(s))) errors.push('Surfaces invalides.');
  if (!Array.isArray(m.requires) || m.requires.some((r) => !r || !ID_RE.test(String(r.id)) || !isRange(r.range))) {
    errors.push('Dépendances invalides.');
  }
  if (!isRange(m.guestflow)) errors.push('Version de GuestFlow requise invalide.');
  if (!isRange(m.sdk)) errors.push('Version du SDK requise invalide.');
  // Written by the package build (rules 27, 33): absent from a source manifest.
  if (m.contentHash !== undefined && !/^[a-f0-9]{64}$/.test(String(m.contentHash))) errors.push('Empreinte du contenu invalide.');
  if (m.hostImports !== undefined) {
    const ok = m.hostImports && typeof m.hostImports === 'object' && !Array.isArray(m.hostImports)
      && Object.values(m.hostImports).every((names) => Array.isArray(names) && names.every(isText));
    if (!ok) errors.push('Modules hôtes invalides.');
  }
  if (m.changelog !== undefined) {
    const ok = m.changelog && typeof m.changelog === 'object' && !Array.isArray(m.changelog)
      && Object.entries(m.changelog).every(([v, lines]) => isVersion(v) && Array.isArray(lines) && lines.every(isText));
    if (!ok) errors.push('Journal des versions invalide.');
  }
  return errors;
}

/** The manifest with only the known keys, frozen — what the core stores and serves. */
function normalizeManifest(m) {
  return Object.freeze({
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description,
    icon: m.icon,
    surfaces: Object.freeze([...m.surfaces]),
    requires: Object.freeze(m.requires.map((r) => Object.freeze({ id: r.id, range: r.range }))),
    guestflow: m.guestflow,
    sdk: m.sdk,
    changelog: Object.freeze({ ...(m.changelog || {}) }),
    ...(m.contentHash ? { contentHash: m.contentHash } : {}),
    ...(m.hostImports ? { hostImports: Object.freeze({ ...m.hostImports }) } : {}),
  });
}

/** Parse and validate a manifest text; throws `INVALID_MANIFEST` with the reasons. */
function parseManifest(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const errors = validateManifest(parsed);
  if (errors.length) {
    const err = new Error(`INVALID_MANIFEST:${errors.join(' ')}`);
    err.reasons = errors;
    throw err;
  }
  return normalizeManifest(parsed);
}

/** The manifest of a plugin's source folder (`server/src/plugins/<id>/manifest.json`). */
function readSourceManifest(id, root = SOURCE_ROOT) {
  const manifest = parseManifest(fs.readFileSync(path.join(root, id, 'manifest.json'), 'utf8'));
  if (manifest.id !== id) throw new Error(`INVALID_MANIFEST:${id}/manifest.json names "${manifest.id}"`);
  return manifest;
}

module.exports = { validateManifest, normalizeManifest, parseManifest, readSourceManifest, ID_RE };
