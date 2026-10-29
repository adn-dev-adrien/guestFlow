/**
 * Which plugin version an instance may install or update to, and why not (specs/plugins-phase-4-registry.md
 * rules 10, 12, 14, 20, 22). Pure: the controller hands it the sources and the installed state.
 *
 *   sources.registry(id) → [{ version, sha256, size, manifest }]   the verified index (rule 6)
 *   sources.bundled(id)  → { manifest, sha256 } | null              the release's own copy (P24)
 *
 * A candidate is compatible when the running core satisfies `guestflow` and the SDK satisfies `sdk`
 * (rule 12); its `requires` are checked when it is installed, because a missing requirement is not
 * a refusal but a proposal (« installer aussi … », same confirmation).
 */

const { satisfies, compare, highest, floorLabel, isVersion, boundedRange } = require('./semverRange');
const { cycleLabel } = require('./pluginGraph');

// A development tree reads `0.0.0-dev` (utils/appVersion.js): it runs whatever its sources are.
const DEV_CORE = '0.0.0-dev';

const MESSAGES = Object.freeze({
  CORE_TOO_OLD: 'Nécessite une version plus récente de GuestFlow.',
  CORE_INCOMPATIBLE: 'Incompatible avec cette version de GuestFlow.',
  PACKAGE_REJECTED: 'Le paquet reçu ne correspond pas à sa signature — rien n’a été modifié.',
  DOWNLOAD_FAILED: 'Téléchargement impossible — rien n’a été modifié.',
  UPDATE_IN_PROGRESS: 'Mise à jour déjà en cours.',
  CONFIRMATION_STALE: 'La liste a changé : relire, puis confirmer à nouveau.',
  RESTART_UNAVAILABLE: 'Redémarrage automatique indisponible sur cette installation : rien n’a été modifié.',
  NO_UPDATE: 'Aucune mise à jour disponible.',
  NO_ROLLBACK: 'Aucune version précédente à restaurer.',
});

/**
 * Rule 33 — the names a package takes from the app that this app does not expose. `hostExports` is
 * the app's own list (spec → '*' | [names]); null means unknown (a development tree): nothing missing.
 */
function missingHostImports(manifest, hostExports) {
  if (!hostExports || !manifest.hostImports) return [];
  const missing = [];
  for (const [spec, names] of Object.entries(manifest.hostImports)) {
    const exposed = hostExports[spec];
    if (exposed === '*') continue;
    if (!exposed) { missing.push(spec); continue; }
    names.filter((n) => n !== 'default' && !exposed.includes(n)).forEach((n) => missing.push(`${spec}#${n}`));
  }
  return missing;
}

/** The refusal of a manifest's ranges, or null when the running core and SDK satisfy them. */
function rangeRefusal(manifest, { coreVersion, sdkVersion, hostExports = null }) {
  // Rule 34 — an open `guestflow` range stops at the next major of its floor.
  if (coreVersion !== DEV_CORE && !satisfies(coreVersion, boundedRange(manifest.guestflow))) {
    const floor = floorLabel(manifest.guestflow);
    const minimum = floor && floor.split('.').length === 2 ? `${floor}.0` : floor;
    if (minimum && isVersion(coreVersion) && isVersion(minimum) && compare(coreVersion, minimum) < 0) {
      return { code: 'CORE_TOO_OLD', message: `Nécessite GuestFlow ${floor} ou plus récent.` };
    }
    return { code: 'CORE_INCOMPATIBLE', message: MESSAGES.CORE_INCOMPATIBLE };
  }
  if (!satisfies(sdkVersion, manifest.sdk)) return { code: 'SDK_INCOMPATIBLE', message: MESSAGES.CORE_INCOMPATIBLE };
  // Built for a newer app: it needs a name this app does not give (rule 33) — the same refusal as a
  // core too old, since a newer GuestFlow is what it takes.
  if (missingHostImports(manifest, hostExports).length) return { code: 'CORE_TOO_OLD', message: MESSAGES.CORE_TOO_OLD };
  return null;
}

/** Every version of `id` both sources know, the archive's copy winning a tie (edge case: no download). */
function candidates(id, sources) {
  const byVersion = new Map();
  (sources.registry(id) || []).forEach((v) => byVersion.set(v.version, { ...v, source: 'registry' }));
  const bundled = sources.bundled(id);
  if (bundled) byVersion.set(bundled.manifest.version, { version: bundled.manifest.version, sha256: bundled.sha256, manifest: bundled.manifest, source: 'bundled' });
  return [...byVersion.values()];
}

/** The highest compatible candidate (rule 10), optionally above `above` and satisfying `range`. */
function bestCandidate(id, sources, env, { above = null, range = null, except = null } = {}) {
  const ok = candidates(id, sources).filter((c) => !rangeRefusal(c.manifest, env)
    && (!above || compare(c.version, above) > 0)
    && (!range || satisfies(c.version, range))
    && c.version !== except);
  const top = highest(ok.map((c) => c.version));
  return top ? ok.find((c) => c.version === top) : null;
}

/** Why no candidate is offered: the refusal of the highest version known, or null. */
function bestRefusal(id, sources, env) {
  const all = candidates(id, sources);
  const top = highest(all.map((c) => c.version));
  return top ? rangeRefusal(all.find((c) => c.version === top).manifest, env) : null;
}

/**
 * The plan of `manifest`'s requirements (rules 9, 12 of phase 4; rules 5, 9, 15 of
 * specs/plugin-dependencies.md): what must be installed or switched on first, in order, or the
 * refusal that stops it. A step is `{ id, name, version, op: 'install' | 'activate' }` (`source` too
 * for an install). `installed` maps an installed id to its version, `inactive` lists the installed ones
 * that are off, `installedManifest(id)` gives an installed plugin's own manifest, `nameOf(id)` and
 * `allows(id)` come from the catalogue and the licence.
 */
function requirementPlan(manifest, ctx, seen = new Set([manifest.id]), path = [manifest.id]) {
  const {
    sources, env, installed, nameOf, allows, inactive = [], installedManifest = () => null,
  } = ctx;
  const plan = [];
  const refuse = (code, plugin, message) => ({ plan: [], refusal: { code, plugin, message } });
  for (const req of manifest.requires || []) {
    const name = nameOf(req.id) || req.id;
    if (path.includes(req.id)) {
      const cycle = path.slice(path.indexOf(req.id));
      return refuse('REQUIREMENT_CYCLE', req.id, `Dépendance circulaire : ${cycleLabel(cycle, (id) => nameOf(id) || id)}.`);
    }
    if (installed[req.id]) {
      if (!satisfies(installed[req.id], req.range)) {
        return refuse('REQUIREMENT_TOO_OLD', req.id, `Nécessite ${name} ${floorLabel(req.range) || req.range} ou plus récent (installé : ${installed[req.id]}).`);
      }
      if (!inactive.includes(req.id) || seen.has(req.id)) continue;
      if (!allows(req.id)) return refuse('REQUIREMENT_OUT_OF_PLAN', req.id, `Nécessite ${name}, hors forfait.`);
      seen.add(req.id);
      const nested = requirementPlan(installedManifest(req.id) || { id: req.id, requires: [] }, ctx, seen, [...path, req.id]);
      if (nested.refusal) return nested;
      plan.push(...nested.plan, { id: req.id, name, version: installed[req.id], op: 'activate' });
      continue;
    }
    if (seen.has(req.id)) continue;
    if (!allows(req.id)) return refuse('REQUIREMENT_OUT_OF_PLAN', req.id, `Nécessite ${name}, hors forfait.`);
    const offer = bestCandidate(req.id, sources, env, { range: req.range });
    if (!offer) return refuse('REQUIREMENT_MISSING', req.id, `Nécessite ${name}, indisponible.`);
    seen.add(req.id);
    const nested = requirementPlan(offer.manifest, ctx, seen, [...path, req.id]);
    if (nested.refusal) return nested;
    plan.push(...nested.plan, {
      id: req.id, name, version: offer.version, source: offer.source, op: 'install',
    });
  }
  return { plan, refusal: null };
}

/** The changelog lines of the versions after `from`, up to `to` included, newest first (rule 20). */
function changelogBetween(manifest, from, to) {
  const log = (manifest && manifest.changelog) || {};
  return Object.keys(log)
    .filter((v) => isVersion(v) && (!from || compare(v, from) > 0) && compare(v, to) <= 0)
    .sort(compare)
    .reverse()
    .map((version) => ({ version, lines: log[version] }));
}

module.exports = {
  DEV_CORE,
  MESSAGES,
  rangeRefusal,
  missingHostImports,
  candidates,
  bestCandidate,
  bestRefusal,
  requirementPlan,
  changelogBetween,
};
