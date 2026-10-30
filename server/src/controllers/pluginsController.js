/**
 * Plugins controller (specs/plugins-phase-0-foundation.md §3.B, §4.3). Owns the states, the refusal
 * rules and the payload the Plugins page renders; the page never derives a state itself.
 *
 * specs/plugins-phase-4-registry.md rules 10–16, 20–22: each plugin's version, the version offered
 * (registry or release archive), the update with its changelog lines, the rollback window, the
 * refusals in French; install from a package, update and rollback with a restart.
 */

const defaultModel = require('../models/pluginsModel');
const registry = require('../plugins/sdk/registry');
const { forgetPluginMigrations } = require('../plugins/sdk/pluginMigrations');
const {
  PLUGIN_CATALOG, PLUGIN_DISPLAY_NAMES, PLUGIN_SETTINGS_PLACES, findPlugin, pluginsOfPage, ONLINE_PAYMENT, SAS, ACCOUNTING_EXPORT,
} = require('../constants/plugins');
const { RECEPTION, ACCOUNTANT } = require('../constants/roles');
const { compare, satisfies, rangeNeed } = require('../utils/semverRange');
const {
  MESSAGES, rangeRefusal, bestCandidate, bestRefusal, requirementPlan, changelogBetween,
} = require('../utils/pluginOffers');
const { createGraph, cycleLabel } = require('../utils/pluginGraph');

const ROLLBACK_DAYS = 7;
const DAY_MS = 86400000;

// « il y a 3 h » — the age of the last registry read, as the page prints it (rule 9 edge case).
function agoLabel(iso, now) {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60000) return 'à l’instant';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}

const frDay = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' }).format(new Date(iso));

const PACKAGE_STATUS = { PACKAGE_REJECTED: 422, DOWNLOAD_FAILED: 502 };

// Rule 8 — turning these off would leave something live without its tool.
function blockerFor(id, model) {
  if (id === ONLINE_PAYMENT) {
    const n = model.countOpenPaymentLinks();
    if (n > 0) {
      return {
        code: 'OPEN_PAYMENT_LINKS',
        message: n > 1
          ? `${n} liens de paiement en attente : à payer ou annuler d’abord.`
          : '1 lien de paiement en attente : à payer ou annuler d’abord.',
      };
    }
    const pending = model.countPendingDeactivations ? model.countPendingDeactivations() : 0;
    if (pending > 0) {
      return {
        code: 'LINKS_PENDING_DEACTIVATION',
        message: pending > 1
          ? `${pending} liens annulés encore payables chez le prestataire : à désactiver d’abord.`
          : '1 lien annulé encore payable chez le prestataire : à désactiver d’abord.',
      };
    }
  }
  if (id === SAS) {
    const n = model.countOnlyRoleUsers(RECEPTION);
    if (n > 0) {
      return {
        code: 'RECEPTION_USERS',
        message: n > 1
          ? `${n} comptes Accueil actifs : changer leur rôle dans Utilisateurs d’abord.`
          : '1 compte Accueil actif : changer son rôle dans Utilisateurs d’abord.',
      };
    }
  }
  if (id === ACCOUNTING_EXPORT) {
    const n = model.countOnlyRoleUsers(ACCOUNTANT);
    if (n > 0) {
      return {
        code: 'ACCOUNTANT_USERS',
        message: n > 1
          ? `${n} comptes Comptable actifs : changer leur rôle dans Utilisateurs d’abord.`
          : '1 compte Comptable actif : changer son rôle dans Utilisateurs d’abord.',
      };
    }
  }
  return null;
}

// deps (specs/plugins-phase-1-sdk.md): the module registry, the database the erasure runs on, the
// plugin settings model, the loader's migrate + install hooks. All injectable for tests.
function createController(model = defaultModel, deps = {}) {
  const reg = deps.registry || registry;
  const getDb = deps.db || (() => require('../database'));
  const settingsModel = deps.settingsModel || (() => require('../models/pluginSettingsModel'));
  const loader = deps.loader || (() => require('../plugins/loader'));
  const licence = deps.licence || (() => require('../utils/licence').default);
  const host = deps.host || (() => require('../plugins/host'));
  const coreVersion = deps.coreVersion || (() => require('../utils/appVersion').getAppVersion());
  const sdkVersion = deps.sdkVersion || require('../plugins/sdk/version').SDK_VERSION;
  const now = deps.now || (() => new Date());
  const operatorManaged = deps.operatorManaged || (() => require('../utils/pluginGovernance').isOperatorManaged());

  const packages = () => host().mode() === 'packages';
  const env = () => ({ coreVersion: coreVersion(), sdkVersion, hostExports: host().hostExports() });
  // The two sources of rule 10: the verified registry index and the release's own copy.
  const sources = () => ({
    registry: (id) => (packages() ? host().registryClient().versions(id) : []),
    bundled: (id) => host().runningCopy(id),
  });
  // specs/plugin-removal-resilience.md rule 1 — an installed plugin this release no longer ships is
  // still listed (under the name its row's manifest carries), so it can be uninstalled.
  const bareEntry = (id, m = {}) => ({
      id,
      name: m.name || id,
      description: m.description || '',
      icon: m.icon || 'extension',
      surfaces: m.surfaces || [],
      requires: m.requires || [],
      version: m.version || null,
    });
  const orphanEntry = (row) => ({ ...bareEntry(row.id, row.manifest || {}), version: row.version || (row.manifest || {}).version || null });
  const entryFor = (id) => {
    const known = findPlugin(id);
    if (known) return known;
    const row = model.get(id);
    return row ? orphanEntry(row) : null;
  };
  const catalogue = () => {
    const shipped = new Set(PLUGIN_CATALOG.map((p) => p.id));
    return [...PLUGIN_CATALOG, ...model.list().filter((r) => !shipped.has(r.id)).map(orphanEntry)];
  };
  const nameOf = (id) => (entryFor(id) || {}).name || id;
  const installedVersions = () => Object.fromEntries(model.list().map((r) => [r.id, r.version || (host().runningCopy(r.id) || { manifest: {} }).manifest.version]));
  const allows = (id) => licence().allowsPlugin(id);
  const manifestOfInstalled = (id) => {
    const row = model.get(id);
    return (row && row.manifest) || entryFor(id);
  };
  // `substitute` (id → manifest) are the versions moving in the same pass: the plan sees them as installed.
  const planCtx = (substitute = {}) => ({
    sources: sources(),
    env: env(),
    installed: { ...installedVersions(), ...Object.fromEntries(Object.entries(substitute).map(([id, m]) => [id, m.version])) },
    inactive: model.list().filter((r) => !r.enabled).map((r) => r.id),
    installedManifest: manifestOfInstalled,
    nameOf,
    allows,
  });

  // specs/plugin-dependencies.md rule 2 — the graph of the plugins in play: an installed plugin is read
  // by its own row's manifest (a registry version may have changed its `requires`), the others by the
  // catalogue's.
  function graph(substitute = {}) {
    const rows = model.list();
    const manifests = Object.fromEntries(catalogue().map((entry) => [entry.id, entry]));
    rows.forEach((r) => { manifests[r.id] = r.manifest || manifests[r.id] || bareEntry(r.id); });
    Object.assign(manifests, substitute);
    return createGraph({
      manifests,
      states: Object.fromEntries(rows.map((r) => [r.id, r.enabled ? 'active' : 'inactive'])),
      versions: installedVersions(),
      allows,
      nameOf,
    });
  }

  const describeLogged = new Set();
  const erasable = (id) => Boolean(reg.get(id) && reg.get(id).data);

  // Rule 12 — what « Effacer aussi ses données » would erase, as the server counts it. `null` when the
  // plugin's own count threw: unknown is not « nothing » (rule 40), a reader must not offer a removal on it.
  function dataLines(id) {
    const record = reg.get(id);
    if (!record || !record.data || !record.data.describe) return [];
    try {
      return record.data.describe(getDb()) || [];
    } catch (err) {
      if (!describeLogged.has(id)) {
        describeLogged.add(id);
        console.error(`[plugin:${id}] data description failed:`, err && err.message ? err.message : err);
      }
      return null;
    }
  }

  // specs/control-plane-plans-and-access.md rules 11–12 — a plugin outside the licence keeps its
  // stored state (so an upgrade brings it back untouched) and carries the plan that includes it.
  const planHint = (plan) => (plan ? `Inclus dans le forfait ${plan}, sur demande.` : 'En option, sur demande.');

  function planView(id) {
    if (licence().allowsPlugin(id)) return { outOfPlan: false, planChip: null, planHint: null };
    const plan = licence().planFor(id);
    return { outOfPlan: true, planChip: plan ? `Forfait ${plan}` : 'Option à la carte', planHint: planHint(plan) };
  }

  function refuseIfOutOfPlan(entry, res) {
    if (licence().allowsPlugin(entry.id)) return false;
    const plan = licence().planFor(entry.id);
    res.status(402).json({ error: 'PLAN_REQUIRED', plan, message: planHint(plan) });
    return true;
  }

  // Rule 16 — the previous copy, while its window is open and its files are still there.
  function rollbackView(row) {
    if (!packages() || !row || !row.previousVersion || !row.rollbackUntil) return null;
    if (Date.parse(row.rollbackUntil) <= now().getTime()) return null;
    const older = previousManifest(row);
    if (!older) return null;
    return {
      version: row.previousVersion,
      until: row.rollbackUntil,
      label: `Version ${row.previousVersion}, possible jusqu’au ${frDay(row.rollbackUntil)}.`,
      refusal: movingRefusal(row, older, {}, true),
    };
  }

  function previousManifest(row) {
    if (row.previousSource === 'registry') {
      const dir = host().store().packageDirFor(row.id, { source: 'registry', version: row.previousVersion });
      if (!dir) return null;
      try {
        return require('../plugins/manifest').parseManifest(require('fs').readFileSync(require('path').join(dir, 'manifest.json'), 'utf8'));
      } catch {
        return null;
      }
    }
    const copy = host().runningCopy(row.id);
    return copy && copy.manifest.version === row.previousVersion ? copy.manifest : null;
  }

  // Rules 10, 12, 20 — what this plugin is offered: an update for an installed one, a version (and
  // the requirements installed with it) for an available one. Only a release runs packages; a
  // development tree runs its sources and is offered nothing.
  function packageView(entry, row) {
    const incompatible = row ? host().state().incompatible[entry.id] || null : null;
    if (!packages()) return { update: null, offer: row ? null : sourceOffer(entry), incompatible, rollback: null };
    const src = sources();
    if (!row) {
      const offer = bestCandidate(entry.id, src, env());
      if (!offer) {
        const refusal = bestRefusal(entry.id, src, env()) || { code: 'UNAVAILABLE', message: 'Indisponible.' };
        return { update: null, incompatible: null, rollback: null, offer: { version: null, requirements: [], refusal } };
      }
      return { update: null, incompatible: null, rollback: null, offer: offerOf(entry.id, offer.manifest, offer.version) };
    }
    if (incompatible) {
      const target = bestCandidate(entry.id, src, env(), { except: row.version });
      return {
        offer: null,
        rollback: rollbackView(row),
        incompatible: { ...incompatible, compatibleVersion: target ? target.version : null },
        update: target ? updateView(row, target) : null,
      };
    }
    const target = bestCandidate(entry.id, src, env(), { above: row.version });
    return { offer: null, incompatible: null, rollback: rollbackView(row), update: target ? updateView(row, target) : null };
  }

  // Rules 9–10 — what an install takes along: the requirements to install or switch on first, in order.
  const stepView = ({ id, name, version, op }) => ({ id, name, version, op });

  const planLine = (p) => (p.op === 'activate' ? `Active aussi ${p.name}.` : `Installe aussi ${p.name} ${p.version}.`);

  function offerOf(id, manifest, version) {
    const { plan, refusal } = requirementPlan(manifest, planCtx());
    const confirm = plan.length ? { title: `Installer ${nameOf(id)}`, message: plan.map(planLine).join(' '), label: 'Tout installer' } : null;
    return { version, requirements: plan.map(stepView), refusal, confirm };
  }

  // A development tree installs from its sources (rule 10): the offer is the source manifest's.
  const sourceOffer = (entry) => offerOf(entry.id, entry, entry.version);

  // Rule 55 — the cycle the target manifest would close, with the others as they are installed.
  function cycleRefusal(id, manifest, substitute = {}) {
    const cycle = graph({ ...substitute, [id]: manifest }).cycleOf(id);
    return cycle ? { code: 'REQUIREMENT_CYCLE', message: `Dépendance circulaire : ${cycleLabel(cycle, nameOf)}.` } : null;
  }

  // Rule 55 — an active plugin never moves onto a requirement that is installed but off (rule 37).
  function inactiveRefusal(row, manifest) {
    if (!row.enabled) return null;
    const { plan } = requirementPlan(manifest, planCtx());
    const off = plan.filter((p) => p.op === 'activate');
    return off.length ? { code: 'REQUIREMENT_INACTIVE', message: `Nécessite ${off.map((p) => p.name).join(', ')} : à activer d’abord.` } : null;
  }

  // Mirror of rule 37 seen from the requirement: an active dependant never stays on a requirement whose new
  // version its declared range refuses, or it would be unloaded at the next boot.
  function dependantRangeRefusal(row, manifest, substitute = {}, rollback = false) {
    const g = graph({ ...substitute, [row.id]: manifest });
    for (const d of g.dependantsOf(row.id, { activeOnly: true })) {
      const edge = g.requirementsOf(d).find((e) => e.id === row.id);
      if (edge && !satisfies(manifest.version, edge.range)) {
        return { code: 'REQUIRED_BY_RANGE', message: `${nameOf(d)} nécessite ${nameOf(row.id)} ${rangeNeed(edge.range, manifest.version)} : ${rollback ? 'à remettre à sa version précédente ou à désactiver' : 'à mettre à jour'} d’abord.` };
      }
    }
    return null;
  }

  // Rules 55 and 58 — every refusal of moving `row` onto `manifest` (an update, or a rollback to an older one).
  // `substitute` holds the other manifests moving in the same pass (update-all).
  function movingRefusal(row, manifest, substitute = {}, rollback = false) {
    const { plan, refusal } = requirementPlan(manifest, planCtx(substitute));
    const toInstall = plan.filter((p) => p.op === 'install');
    const missing = toInstall.length ? { code: 'REQUIREMENT_MISSING', message: `Nécessite ${toInstall.map((p) => p.name).join(', ')} : à installer d’abord.` } : null;
    return cycleRefusal(row.id, manifest, substitute) || refusal || missing || inactiveRefusal(row, manifest)
      || dependantRangeRefusal(row, manifest, substitute, rollback);
  }

  function updateView(row, target) {
    return {
      version: target.version,
      changelog: changelogBetween(target.manifest, row.version, target.version),
      refusal: movingRefusal(row, target.manifest),
    };
  }

  /**
   * specs/plugins-phase-0-foundation.md rule 25 — the state a card tells and the action it offers:
   * an active plugin that still lacks something reads « Actif · à connecter » and offers
   * « Configurer », the others « Réglages » when they have a place to be set up. The plugin says what
   * it lacks (`ctx.setupStatus`); a check that throws counts as nothing missing.
   */
  function setupView(id, state) {
    const path = PLUGIN_SETTINGS_PLACES[id] || null;
    if (state !== 'active') return { needed: false, label: null, path, action: null };
    const record = reg.get(id);
    let missing = null;
    if (record && record.setupStatus) {
      try {
        missing = record.setupStatus() || null;
      } catch {
        missing = null;
      }
    }
    if (missing && path) return { needed: true, label: `Actif · ${missing}`, missing, path, action: 'Configurer' };
    return { needed: false, label: 'Actif', path, action: path ? 'Réglages' : null };
  }

  const reasonOf = (blocker) => blocker.message.replace(/\.$/, '');
  const namesOf = (ids) => ids.map(nameOf).join(', ');
  const refs = (ids) => ids.map((id) => ({ id, name: nameOf(id) }));

  // Rule 6–7 — the lines a card prints: what the plugin needs (each with its status) and who uses it.
  function dependenciesView(entry, row, g) {
    const src = packages() ? sources() : null;
    const requires = g.requirementsOf(entry.id).map(({ installedVersion, ...edge }) => ({
      ...edge,
      updateAvailable: Boolean(src && edge.status === 'outOfRange'
        && bestCandidate(edge.id, src, env(), { above: installedVersion, range: edge.range })),
    }));
    const usedBy = row ? g.usedBy(entry.id).map((d) => ({ ...d, label: d.state === 'active' ? d.name : `${d.name} (inactif)` })) : [];
    return { requires, usedBy };
  }

  // Rule 23 — the cycle that stops `id` from coming up: its own, or one it would have to switch on.
  const cycleAround = (g, id) => [id, ...g.requirementClosure(id)].map((member) => g.cycleOf(member)).find(Boolean) || null;

  // Rule 56 — a dependant inside the plugin's own strongly connected group does not block its removal:
  // that is how an installed cycle is taken apart. A dependant OUTSIDE the group blocks the removal of every
  // member, since it needs the whole group through the one it requires.
  const outsideGroup = (g, id) => {
    const group = g.groupOf(id);
    const members = group.length ? group : [id];
    return [...new Set(members.flatMap((member) => g.dependantsOf(member)))].filter((other) => other !== id && !group.includes(other));
  };

  // Rule 8 — every refusal a card can predict, said before the click.
  // Rule 37 for the ranges: a plugin does not come up over a requirement installed at a version it refuses.
  const outOfRangeEdge = (g, ids) => ids.flatMap((id) => g.requirementsOf(id)).find((e) => e.status === 'outOfRange');
  const staleMessage = (e) => `Nécessite ${e.name} ${rangeNeed(e.range, e.installedVersion, { of: 'plugin' })} (installé : ${e.installedVersion}).`;

  function actionsView(entry, row, g, blocker) {
    const none = { allowed: false, blockedBy: null };
    if (!row) return { activate: { ...none, alsoActivates: [], confirm: null }, deactivate: { ...none, alsoDeactivates: [], confirm: null }, uninstall: none };
    const id = entry.id;
    const cycle = cycleAround(g, id);
    let activate = { ...none, alsoActivates: [], confirm: null };
    if (!row.enabled) {
      const needed = g.requirementClosure(id);
      const missing = needed.filter((n) => !model.get(n));
      const off = needed.filter((n) => model.get(n) && !model.get(n).enabled);
      const unlicensed = off.filter((n) => !allows(n));
      const stale = outOfRangeEdge(g, [id, ...needed]);
      let blockedBy = null;
      if (cycle) blockedBy = `Dépendance circulaire : ${cycleLabel(cycle, nameOf)}.`;
      else if (missing.length) blockedBy = `Nécessite ${namesOf(missing)} : à installer d’abord.`;
      else if (stale) blockedBy = staleMessage(stale);
      else if (unlicensed.length) blockedBy = `Nécessite ${namesOf(unlicensed)}, hors forfait.`;
      const also = blockedBy ? [] : refs(off);
      activate = {
        allowed: !blockedBy,
        blockedBy,
        alsoActivates: also,
        confirm: also.length ? { title: `Activer ${nameOf(id)}`, message: `Active aussi : ${namesOf(also.map((a) => a.id))}.`, label: 'Tout activer' } : null,
      };
    }
    let deactivate = { ...none, alsoDeactivates: [], confirm: null };
    if (row.enabled) {
      const followers = g.activeDependantClosure(id);
      const stuck = followers.find((n) => blockerFor(n, model));
      let blockedBy = null;
      if (blocker) blockedBy = blocker.message;
      else if (stuck) blockedBy = `${nameOf(stuck)} ne peut pas être désactivé : ${reasonOf(blockerFor(stuck, model))}.`;
      const also = blockedBy ? [] : refs(followers);
      deactivate = {
        allowed: !blockedBy,
        blockedBy,
        alsoDeactivates: also,
        confirm: {
          title: `Désactiver ${nameOf(id)} ?`,
          message: also.length
            ? `Désactive aussi : ${namesOf(also.map((a) => a.id))}. Réglages et données gardés. À réactiver ensuite un par un.`
            : 'Ce qu’il ajoute s’arrête. Ses réglages et ses données sont gardés : le réactiver remet tout en place.',
          label: also.length ? 'Tout désactiver' : 'Désactiver',
        },
      };
    }
    const users = outsideGroup(g, id);
    const uninstallBlockedBy = users.length ? `Utilisé par ${namesOf(users)} : à désinstaller d’abord.` : (blocker && blocker.message) || null;
    return { activate, deactivate, uninstall: { allowed: !uninstallBlockedBy, blockedBy: uninstallBlockedBy } };
  }

  function view(entry, g = graph()) {
    const row = model.get(entry.id);
    const record = reg.get(entry.id);
    const pkg = packageView(entry, row);
    const lines = row && erasable(entry.id) ? dataLines(entry.id) : [];
    let state = !row ? 'available' : row.enabled ? 'active' : 'inactive';
    if (row && record && record.failed) state = 'failed';
    if (row && pkg.incompatible) state = 'incompatible';
    // A version installed from the registry describes itself (rule 2); otherwise the release's copy.
    const manifest = (row && row.manifest) || entry;
    const copy = host().runningCopy(entry.id);
    let version = row ? row.version || (copy && copy.manifest.version) || entry.version : entry.version;
    if (!row && pkg.offer && pkg.offer.version) version = pkg.offer.version;
    const blocker = state === 'available' ? null : blockerFor(entry.id, model);
    return {
      ...planView(entry.id),
      id: entry.id,
      name: manifest.name || entry.name,
      description: manifest.description || entry.description,
      icon: manifest.icon || entry.icon,
      surfaces: manifest.surfaces || entry.surfaces,
      requires: manifest.requires || entry.requires,
      version,
      source: row ? row.source : null,
      state,
      blocker,
      dependencies: dependenciesView(entry, row, g),
      actions: actionsView(entry, row, g, blocker),
      setup: setupView(entry.id, state),
      hasModule: Boolean(record) || Boolean(copy),
      erasable: erasable(entry.id),
      data: lines || [],
      dataUnknown: lines === null,
      ...pkg,
    };
  }

  // Rule 9 edge case: a registry that cannot be read is said discreetly, never as an error.
  function registryLine(status) {
    if (!status.configured) return null;
    if (status.state === 'ok') return `Registre lu ${agoLabel(status.lastOkAt, now())}.`;
    if (status.state === 'invalid') return 'Registre ignoré : signature invalide.';
    if (status.state === 'stale') return 'Registre ignoré : index plus ancien que le dernier lu.';
    if (status.state === 'unreachable') {
      return status.lastOkAt ? `Registre injoignable, dernière lecture ${agoLabel(status.lastOkAt, now())}.` : 'Registre injoignable.';
    }
    return null;
  }

  function statusView() {
    const g = graph();
    const views = catalogue().map((entry) => view(entry, g));
    const updates = views.filter((p) => p.update && !p.update.refusal && !p.outOfPlan);
    const n = updates.length;
    const regStatus = packages() ? host().registryClient().status() : { configured: false };
    const toConfigure = views.filter((p) => p.setup.needed && !p.outOfPlan).length;
    return {
      mode: host().mode(),
      // Rule 25 — the « À configurer (n) » filter of the Plugins page.
      toConfigure,
      registry: { ...regStatus, label: registryLine(regStatus) },
      updates: n,
      banner: n ? `${n} mise${n > 1 ? 's' : ''} à jour disponible${n > 1 ? 's' : ''}` : null,
      updateIds: updates.map((p) => p.id),
      canRestart: packages() ? host().state().restart.supervised : false,
    };
  }

  /**
   * Fetches (registry) or points at (archive) the package of `candidate`, verified (rule 11). Throws a
   * PackageError — nothing moved — or returns { manifest, dir, sha256 }.
   */
  async function acquire(id, candidate) {
    if (candidate.source === 'registry') {
      return host().store().fetchFromRegistry({
        id, version: candidate.version, sha256: candidate.sha256, size: candidate.size,
        url: host().registryClient().packageUrl(id, candidate.version),
      });
    }
    const pkg = host().store().bundled()[id];
    return { manifest: pkg.manifest, dir: pkg.dir, sha256: pkg.sha256 };
  }

  function refusePackageError(err, res) {
    const code = err && err.code;
    if (!PACKAGE_STATUS[code]) throw err;
    console.error(`[plugins] package refused: ${err.message}`);
    return res.status(PACKAGE_STATUS[code]).json({ error: code, message: MESSAGES[code] });
  }

  // Rule 13 — a package installed while the app runs: loaded, registered, mounted, migrated, then
  // recorded. Returns null, or the refusal to send.
  async function installPackage(id, candidate, undo = [], installed = [], restartOwed = false) {
    const pkg = await acquire(id, candidate);
    if (candidate.source === 'registry') {
      const before = host().store().readCurrent(id);
      host().store().setCurrent(id, candidate.version);
      undo.push(() => (before ? host().store().setCurrent(id, before) : host().store().clearCurrent(id)));
    }
    const loaded = host().state().loaded[id];
    let restart = false;
    // Loaded at this version but failed at boot: registered afresh, like a failed live install.
    const failedLoaded = loaded === candidate.version && Boolean(reg.get(id) && reg.get(id).failed);
    if (restartOwed || (loaded && loaded !== candidate.version)) {
      restart = true;
    } else if (loaded && !failedLoaded) {
      try {
        loader().migrate(getDb(), id);
      } catch (err) {
        console.error(`[plugin:${id}] install migration failed:`, err && err.message ? err.message : err);
        return { status: 500, body: { error: 'PLUGIN_MIGRATION_FAILED', plugin: id } };
      }
    } else {
      let mod;
      try {
        mod = loader().requirePackage(id, pkg.dir);
      } catch (err) {
        mod = { id, register() { throw err; } };
      }
      if (!loader().registerLive(mod, { db: getDb() })) {
        return { status: 500, body: { error: 'PLUGIN_REGISTER_FAILED', plugin: id, message: 'Échec du démarrage.' } };
      }
      if (!loaded) {
        host().setLoaded(id, candidate.version, pkg.manifest.contentHash);
        undo.push(() => host().unsetLoaded(id));
      }
      try {
        loader().migrate(getDb(), id);
      } catch (err) {
        console.error(`[plugin:${id}] install migration failed:`, err && err.message ? err.message : err);
        return { status: 500, body: { error: 'PLUGIN_MIGRATION_FAILED', plugin: id } };
      }
    }
    model.install(id, { version: candidate.version, source: candidate.source, manifest: pkg.manifest, sha256: pkg.sha256 });
    undo.push(() => model.uninstall(id));
    if (restart) model.markHooksPending(id);
    if (!restart) {
      loader().beginInstall(id);
      installed.push(id);
      await loader().runInstallHooks(id);
    }
    return { restart };
  }

  /**
   * Second review m3 — one plugin operation at a time: `work(restart)` runs under the lock, which is
   * released on every way out except the restart (the next process starts unlocked).
   */
  async function underLock(res, work) {
    const state = host().state();
    if (state.updating) return res.status(409).json({ error: 'UPDATE_IN_PROGRESS', message: MESSAGES.UPDATE_IN_PROGRESS });
    state.updating = true;
    let restarting = false;
    const restart = (body) => {
      restarting = true;
      return restartNow(res, body);
    };
    try {
      return await work(restart);
    } finally {
      if (!restarting) state.updating = false;
    }
  }

  // The target of an update: `version` when asked (an incompatible plugin, rule 14), else the newest.
  function updateTarget(row, version) {
    const src = sources();
    if (version) {
      const target = bestCandidate(row.id, src, env(), { range: version });
      if (!target || target.version !== version || target.version === row.version) return null;
      // An older version only for a plugin this core cannot run (rule 14); otherwise only newer.
      const older = compare(target.version, row.version) < 0;
      return older && !host().state().incompatible[row.id] ? null : target;
    }
    return bestCandidate(row.id, src, env(), { above: row.version });
  }

  function refuseIfBusy(res) {
    if (!host().state().updating) return false;
    res.status(409).json({ error: 'UPDATE_IN_PROGRESS', message: MESSAGES.UPDATE_IN_PROGRESS });
    return true;
  }

  function refuseUpdateConditions(res) {
    if (!packages()) { res.status(409).json({ error: 'NO_UPDATE', message: MESSAGES.NO_UPDATE }); return true; }
    if (refuseIfBusy(res)) return true;
    if (!host().state().restart.supervised) { res.status(412).json({ error: 'RESTART_UNAVAILABLE', message: MESSAGES.RESTART_UNAVAILABLE }); return true; }
    return false;
  }

  // Switches one plugin to an acquired package and keeps the previous copy for the window (rule 16).
  function switchTo(row, target, pkg) {
    if (target.source === 'registry') host().store().setCurrent(row.id, target.version);
    model.switchVersion(row.id, { version: target.version, source: target.source, manifest: pkg.manifest, sha256: pkg.sha256 }, {
      rollbackUntil: new Date(now().getTime() + ROLLBACK_DAYS * DAY_MS).toISOString(),
    });
    const keep = [];
    if (target.source === 'registry') keep.push(target.version);
    if (row.source === 'registry' && row.version) keep.push(row.version);
    host().store().prune(row.id, keep);
  }

  function restartNow(res, body = {}) {
    res.status(202).json({ restarting: true, ...body });
    host().state().restart.schedule({ reason: 'plugin update' });
  }

  // Rules 9, 11 — a requirement installed but off is switched on: its migrations, then its row. Its
  // activation hooks wait for the whole operation to commit. Returns { restart: false } or the failure.
  function switchOn(id, undo, activated) {
    if (reg.get(id)) {
      try {
        loader().migrate(getDb(), id);
      } catch (err) {
        console.error(`[plugin:${id}] activation migration failed:`, err && err.message ? err.message : err);
        return { status: 500, body: { error: 'PLUGIN_MIGRATION_FAILED', plugin: id } };
      }
    }
    model.setEnabled(id, true);
    undo.push(() => {
      model.setEnabled(id, false);
      loader().markInactive(id);
    });
    if (reg.get(id)) activated.push(id);
    return { restart: false };
  }

  // specs/plugin-dependencies.md rule 44 — the confirmation carries the ids the operator saw. 'none': nothing
  // confirmed (the plan is only proposed); 'ok': the same set; 'stale': the closure moved since the click.
  function confirmation(given, expected) {
    if (!Array.isArray(given) ? !given : !given.length) return 'none';
    const same = Array.isArray(given) && given.length === expected.length && expected.every((id) => given.includes(id));
    return same ? 'ok' : 'stale';
  }

  function refuseStale(res, expected) {
    res.status(409).json({ error: 'CONFIRMATION_STALE', message: MESSAGES.CONFIRMATION_STALE, requirements: refs(expected) });
    return true;
  }

  // Rule 9 — without `withRequirements` the plan is only proposed: the card sends the flag once the operator
  // confirmed the lines. A plan of switch-ons alone keeps rule 38's answer; one with installs says REQUIREMENTS.
  function refuseIfUnconfirmed(plan, req, res) {
    const ids = plan.map((p) => p.id);
    const confirmed = confirmation(req.body && req.body.withRequirements, ids);
    if (confirmed === 'stale' && plan.length) return refuseStale(res, ids);
    if (!plan.length || confirmed === 'ok') return false;
    if (plan.every((p) => p.op === 'activate')) {
      res.status(409).json({
        error: 'REQUIREMENT_INACTIVE', requires: plan.map((p) => p.id), requirements: plan.map(stepView), message: `Nécessite ${namesOf(plan.map((p) => p.id))} : à activer d’abord.`,
      });
      return true;
    }
    res.status(409).json({
      error: 'REQUIREMENTS', message: `Nécessite aussi : ${plan.map((p) => p.name).join(', ')}.`, requirements: plan.map(stepView),
    });
    return true;
  }

  // specs/plugin-dependencies.md rule 10 — the same plan in a development tree: the requirements'
  // rows are installed or switched on first, from the sources, under the same confirmation. All or
  // nothing: a step that fails undoes the rows written before it.
  async function installFromSources(entry, req, res) {
    const { plan, refusal } = requirementPlan(entry, planCtx());
    if (refusal) return res.status(409).json({ error: refusal.code, message: refusal.message });
    if (refuseIfUnconfirmed(plan, req, res)) return undefined;
    const undo = [];
    const activated = [];
    const installed = [];
    try {
      for (const step of [...plan, { id: entry.id, op: 'install' }]) {
        const failure = step.op === 'activate' ? switchOn(step.id, undo, activated) : sourceInstall(step.id, undo, installed);
        if (failure.status) {
          undo.reverse().forEach((revert) => revert());
          return res.status(failure.status).json(failure.body);
        }
      }
      for (const id of installed) await loader().runInstallHooks(id); // eslint-disable-line no-await-in-loop
      [...activated, ...installed].forEach((id) => loader().runActivateHooks(id));
      return res.json(view(entry));
    } finally {
      installed.forEach((id) => loader().endInstall(id));
    }
  }

  // A module's tables are created first (phase 1 rule 6); a failed migration leaves the plugin available.
  function sourceInstall(id, undo, installed) {
    if (reg.get(id)) {
      try {
        loader().migrate(getDb(), id);
      } catch (err) {
        console.error(`[plugin:${id}] install migration failed:`, err && err.message ? err.message : err);
        return { status: 500, body: { error: 'PLUGIN_MIGRATION_FAILED', plugin: id } };
      }
    }
    model.install(id);
    undo.push(() => model.uninstall(id));
    if (reg.get(id)) {
      loader().beginInstall(id);
      installed.push(id);
    }
    return { restart: false };
  }

  // A plugin left unloaded at boot because its requirement was missing is registered as soon as the
  // requirement is live, so installing it does not call for a restart.
  // Synchronous on purpose (activate answers right after). Returns the ids brought up, so the caller can ask the browser to reload its plugin bundles.
  function reviveDependants() {
    const state = host().state();
    const revived = [];
    let progressed = true;
    // Until nothing more comes back: a plugin revived makes its own dependants ready.
    while (progressed) {
      progressed = false;
      for (const row of model.list()) {
        const left = state.incompatible[row.id];
        const needs = (row.manifest && row.manifest.requires) || [];
        // An enabled dependant needs its requirements enabled too (rule 37), not only loaded.
        const unmet = needs.find((r) => !(state.loaded[r.id] && satisfies(state.loaded[r.id], r.range)
          && (!row.enabled || (model.get(r.id) && model.get(r.id).enabled))));
        if (left && left.code === 'REQUIREMENT_MISSING' && unmet) {
          // Still waiting: say which requirement is still missing, not the one that just came up.
          state.incompatible[row.id] = { ...left, message: `Nécessite ${nameOf(unmet.id)}.` };
        } else if (left && left.code === 'REQUIREMENT_MISSING') {
          try {
            const mod = loader().requirePackage(row.id, host().store().packageDirFor(row.id, row));
            if (loader().registerLive(mod, { db: getDb() })) {
              try {
                loader().migrate(getDb(), row.id);
              } catch (err) {
                // Registered, mounted and scheduled already: failed, like a migration failing at boot, so nothing of it runs.
                reg.markFailed(row.id, err);
                delete state.incompatible[row.id];
                throw err;
              }
              host().setLoaded(row.id, row.version, row.manifest.contentHash);
              delete state.incompatible[row.id];
              if (row.enabled) loader().runActivateHooks(row.id);
              revived.push(row.id);
              progressed = true;
            }
          } catch (err) {
            console.error(`[plugin:${row.id}] late registration failed:`, err && err.message ? err.message : err);
          }
        }
      }
    }
    return revived;
  }

  // POST /api/plugins/:id/install in a release (rules 10–13): the requirements first when the
  // confirmation included them (`withRequirements`), then the plugin itself.
  async function installFromPackages(entry, req, res) {
    const offer = bestCandidate(entry.id, sources(), env());
    if (!offer) {
      const refusal = bestRefusal(entry.id, sources(), env()) || { code: 'UNAVAILABLE', message: 'Indisponible.' };
      return res.status(409).json({ error: refusal.code, message: refusal.message });
    }
    const { plan, refusal } = requirementPlan(offer.manifest, planCtx());
    if (refusal) return res.status(409).json({ error: refusal.code, message: refusal.message });
    if (refuseIfUnconfirmed(plan, req, res)) return undefined;
    const steps = [
      ...plan.map((p) => (p.op === 'install'
        ? { id: p.id, op: 'install', candidate: bestCandidate(p.id, sources(), env(), { range: p.version }) }
        : { id: p.id, op: 'activate' })),
      { id: entry.id, op: 'install', candidate: offer },
    ];
    const state = host().state();
    // A version other than the one still loaded needs a restart (rule 13): refused up front without a
    // supervisor, like an update.
    const needsRestart = steps.some((st) => st.op === 'install' && state.loaded[st.id] && state.loaded[st.id] !== st.candidate.version);
    // The reconciliation never restarts the process (specs/plugin-operator-provisioning.md rule 17).
    if (needsRestart && req.noRestart) {
      return res.status(409).json({ error: 'RESTART_REQUIRED', message: 'Redémarrage nécessaire — passer par Versions › Plugins.' });
    }
    if (needsRestart && !state.restart.supervised) {
      return res.status(412).json({ error: 'RESTART_UNAVAILABLE', message: MESSAGES.RESTART_UNAVAILABLE });
    }
    // Rule 29 — one install at a time, and all or nothing: a requirement installed for a plugin whose
    // own install then fails is undone — its row, its `current` pointer and its bundle in the list the
    // browser loads. Its server code, already registered, stays in memory, inert (not live) until the
    // next restart.
    return underLock(res, async (restart) => {
      const undo = [];
      // The activation hooks wait for the whole install to commit: a requirement undone with its dependant
      // must not have announced itself (specs/plugin-removal-resilience.md rule 17).
      const installed = [];
      const activated = [];
      const rollback = () => undo.reverse().forEach((step) => step());
      try {
        let restartWanted = false;
        for (const step of steps) {
          let result;
          try {
            result = step.op === 'activate'
              ? switchOn(step.id, undo, activated)
              : await installPackage(step.id, step.candidate, undo, installed, restartWanted); // eslint-disable-line no-await-in-loop
          } catch (err) {
            rollback();
            return refusePackageError(err, res);
          }
          if (result.status) {
            rollback();
            return res.status(result.status).json(result.body);
          }
          restartWanted = restartWanted || result.restart;
        }
        if (restartWanted) {
          // The switched-on requirements ran no activation hook either (rule 41 of phase 4), nor did those
          // installed live earlier in the plan: they owe them at boot.
          [...steps.filter((st) => st.op === 'activate').map((st) => st.id), ...installed].forEach((id) => model.markHooksPending(id, 'activate'));
          return restart({ version: offer.version });
        }
        [...activated, ...installed].forEach((id) => loader().runActivateHooks(id));
        reviveDependants();
        // The browser loads the new bundle at its next page load (rule 18): the page reloads.
        return res.json({ ...view(entry), reload: true });
      } finally {
        installed.forEach((id) => loader().endInstall(id));
      }
    });
  }

  // Rule 12 — one transaction: the plugin's own clean-up, its tables, its settings, its ledger rows.
  function purge(id) {
    const db = getDb();
    const { tables = [], purge: extra } = reg.get(id).data;
    db.transaction(() => {
      if (extra) extra(db);
      tables.forEach((table) => db.exec(`DROP TABLE IF EXISTS "${table.replace(/"/g, '')}"`));
      settingsModel().deleteAll(id);
      forgetPluginMigrations(db, id);
    })();
  }

  // Resolves `:id` or answers 404; returns the catalogue entry.
  function resolve(req, res) {
    const entry = entryFor(req.params.id);
    if (!entry) res.status(404).json({ error: 'UNKNOWN_PLUGIN' });
    return entry;
  }

  // specs/plugins-phase-4-registry.md rule 12 — a plugin another installed plugin requires stays
  // installed; rule 36 — and stays active while an ACTIVE plugin requires it (one the licence does not
  // allow is not live, so it does not count). The reconciliation (`reconciling`) ignores the dependants
  // the licence does not allow when it uninstalls: they sit out of the plan with their state kept (rule 21).
  // specs/plugin-dependencies.md rule 12 — the answer names them, for the card that asks to take them along.
  function refuseIfRequiredBy(entry, res, { activeOnly = false, reconciling = false } = {}) {
    const g = graph();
    const dependents = activeOnly
      ? g.dependantsOf(entry.id, { activeOnly: true })
      : outsideGroup(g, entry.id).filter((id) => !reconciling || allows(id));
    if (!dependents.length) return false;
    const step = activeOnly ? 'désactiver' : 'désinstaller';
    res.status(409).json({
      error: 'REQUIRED_BY', requiredBy: dependents, dependents: refs(dependents), message: `Nécessaire à ${namesOf(dependents)} : à ${step} d’abord.`,
    });
    return true;
  }

  function refuseIfBlocked(entry, res) {
    const blocker = blockerFor(entry.id, model);
    if (!blocker) return false;
    res.status(409).json({ error: 'PLUGIN_BLOCKED', code: blocker.code, message: blocker.message });
    return true;
  }

  return {
    // GET /api/plugins — on an operator-managed space only what a feature needs: the live plugins,
    // each as { id, name, icon, setup } (specs/plugin-operator-provisioning.md rule 5).
    list(req, res) {
      const g = graph();
      if (!operatorManaged()) return res.json(catalogue().map((entry) => view(entry, g)));
      const live = catalogue().filter((entry) => {
        const row = model.get(entry.id);
        return Boolean(row && row.enabled && reg.isLive(entry.id));
      });
      return res.json(live.map((entry) => view(entry, g)).map(({ id, name, icon, setup }) => ({ id, name, icon, setup })));
    },

    /** The same views, for the core's own readers (the Paramètres summary, rule 25). */
    views() {
      const g = graph();
      return catalogue().map((entry) => view(entry, g));
    },

    // POST /api/plugins/:id/install — rule 4: installed and active in one step. A module's tables are
    // created first (phase 1 rule 6); a failed migration leaves the plugin available.
    async install(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (model.get(entry.id)) return res.status(409).json({ error: 'ALREADY_INSTALLED' });
      if (refuseIfOutOfPlan(entry, res)) return undefined;
      if (packages()) return installFromPackages(entry, req, res);
      return installFromSources(entry, req, res);
    },

    // GET /api/plugins/page?path=/comptabilite — specs/plugins-phase-p-productisation.md rules 40, 42:
    // the address of a page whose plugin is off reads « Plugin inactif », not « Page introuvable ».
    // A page shows while any of its plugins is active: then the address answers like a core page.
    pageOwner(req, res) {
      const g = graph();
      const plugins = pluginsOfPage(req.query && req.query.path)
        .map((id) => view(entryFor(id) || bareEntry(id, { name: PLUGIN_DISPLAY_NAMES[id] }), g))
        .map((p) => ({ id: p.id, name: p.name, state: p.state }));
      if (!plugins.length || plugins.some((p) => p.state === 'active')) return res.json({ plugins: [], message: null });
      // Non-breaking spaces: a closing « » » never starts a line on its own.
      const names = plugins.map((p) => `«\u00a0${p.name}\u00a0»`);
      const message = names.length === 1
        ? `Cette page dépend du plugin ${names[0]}, qui n’est pas activé.`
        : 'Cette page dépend de plugins qui ne sont pas activés.';
      return res.json({ plugins, message });
    },

    // GET /api/plugins/status — the banner, the registry line (rules 9, 20).
    status(req, res) {
      return res.json(statusView());
    },

    // POST /api/plugins/refresh — « Rechercher des mises à jour » (rule 9).
    async refresh(req, res) {
      if (packages()) await host().registryClient().refresh();
      return res.json(statusView());
    },

    // POST /api/plugins/:id/update — rules 11, 13, 14: verified package, switch, restart.
    async update(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      const row = model.get(entry.id);
      if (!row) return res.status(409).json({ error: 'NOT_INSTALLED' });
      if (refuseUpdateConditions(res)) return undefined;
      if (refuseIfOutOfPlan(entry, res)) return undefined;
      const requested = req.body && typeof req.body.version === 'string' ? req.body.version : null;
      const target = updateTarget(row, requested);
      if (!target) return res.status(409).json({ error: 'NO_UPDATE', message: MESSAGES.NO_UPDATE });
      const refusal = updateView(row, target).refusal;
      if (refusal) return res.status(409).json({ error: refusal.code, message: refusal.message });
      return underLock(res, async (restart) => {
        try {
          const pkg = await acquire(entry.id, target);
          switchTo(row, target, pkg);
        } catch (err) {
          return refusePackageError(err, res);
        }
        return restart({ version: target.version });
      });
    },

    // POST /api/plugins/update-all — « Tout mettre à jour »: every package verified first, then one
    // switch and one restart. A refused package leaves every plugin as it was.
    async updateAll(req, res) {
      if (refuseUpdateConditions(res)) return undefined;
      let targets = catalogue().map((entry) => {
        const row = model.get(entry.id);
        if (!row || host().state().incompatible[entry.id] || !licence().allowsPlugin(entry.id)) return null;
        const target = updateTarget(row, null);
        return target ? { row, target } : null;
      }).filter(Boolean);
      // Each target is judged on the graph with every target substituted; dropping one can change another's verdict.
      let firstRefusal = null;
      for (;;) {
        const substitute = Object.fromEntries(targets.map((t) => [t.row.id, t.target.manifest]));
        const kept = targets.filter((t) => {
          const refusal = movingRefusal(t.row, t.target.manifest, substitute);
          firstRefusal = firstRefusal || refusal;
          return !refusal;
        });
        if (kept.length === targets.length) break;
        targets = kept;
      }
      if (!targets.length) {
        return res.status(409).json(firstRefusal ? { error: firstRefusal.code, message: firstRefusal.message } : { error: 'NO_UPDATE', message: MESSAGES.NO_UPDATE });
      }
      return underLock(res, async (restart) => {
        const acquired = [];
        try {
          for (const t of targets) acquired.push({ ...t, pkg: await acquire(t.row.id, t.target) }); // eslint-disable-line no-await-in-loop
        } catch (err) {
          return refusePackageError(err, res);
        }
        acquired.forEach(({ row, target, pkg }) => switchTo(row, target, pkg));
        return restart({ updated: acquired.map((t) => ({ id: t.row.id, version: t.target.version })) });
      });
    },

    // POST /api/plugins/:id/rollback — rule 16: the previous copy, inside its 7 days.
    rollback(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      const row = model.get(entry.id);
      if (!row) return res.status(409).json({ error: 'NOT_INSTALLED' });
      if (refuseUpdateConditions(res)) return undefined;
      if (!rollbackView(row)) return res.status(409).json({ error: 'NO_ROLLBACK', message: MESSAGES.NO_ROLLBACK });
      const older = previousManifest(row);
      const refusal = movingRefusal(row, older, {}, true);
      if (refusal) return res.status(409).json({ error: refusal.code, message: refusal.message });
      return underLock(res, async (restart) => {
        const manifest = older;
        if (row.previousSource === 'registry') host().store().setCurrent(row.id, row.previousVersion);
        model.rollBack(row.id, manifest);
        return restart({ version: row.previousVersion });
      });
    },

    // POST /api/plugins/:id/activate — specs/plugin-dependencies.md rule 11: `withRequirements` switches on
    // the requirements that are off first, in order, all or nothing. One not installed is never a side effect.
    activate(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      // Rules 12, 36 and 37 read the rows an install in flight is still writing: wait for it.
      if (refuseIfBusy(res)) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      if (refuseIfOutOfPlan(entry, res)) return undefined;
      const g = graph();
      const cycle = cycleAround(g, entry.id);
      if (cycle) return res.status(409).json({ error: 'REQUIREMENT_CYCLE', message: `Dépendance circulaire : ${cycleLabel(cycle, nameOf)}.` });
      const needed = g.requirementClosure(entry.id);
      const missing = needed.filter((id) => !model.get(id));
      if (missing.length) {
        return res.status(409).json({
          error: 'REQUIREMENT_MISSING', requires: missing, requirements: refs(missing), message: `Nécessite ${namesOf(missing)} : à installer d’abord.`,
        });
      }
      const stale = outOfRangeEdge(g, [entry.id, ...needed]);
      if (stale) return res.status(409).json({ error: 'REQUIREMENT_OUT_OF_RANGE', requires: [stale.id], message: staleMessage(stale) });
      const off = needed.filter((id) => !model.get(id).enabled);
      const unlicensed = off.filter((id) => !allows(id));
      if (unlicensed.length) {
        return res.status(409).json({
          error: 'REQUIREMENT_OUT_OF_PLAN', requires: unlicensed, requirements: refs(unlicensed), message: `Nécessite ${namesOf(unlicensed)}, hors forfait.`,
        });
      }
      const confirmed = confirmation(req.body && req.body.withRequirements, off);
      if (confirmed === 'stale' && off.length) return refuseStale(res, off);
      if (off.length && confirmed !== 'ok') {
        return res.status(409).json({
          error: 'REQUIREMENT_INACTIVE', requires: off, requirements: refs(off), message: `Nécessite ${namesOf(off)} : à activer d’abord.`,
        });
      }
      const undo = [];
      const activated = [];
      for (const id of [...off, entry.id]) {
        const failure = switchOn(id, undo, activated);
        if (failure.status) {
          undo.reverse().forEach((revert) => revert());
          return res.status(failure.status).json(failure.body);
        }
      }
      activated.forEach((id) => loader().runActivateHooks(id));
      // A dependant left unloaded for want of this requirement comes up in the same operation (no await inside):
      // the browser reloads to import its bundle.
      const revived = reviveDependants();
      return res.json(revived.length ? { ...view(entry), reload: true, revived } : view(entry));
    },

    // POST /api/plugins/:id/deactivate — rule 5: data and settings kept. specs/plugin-dependencies.md
    // rule 12: `withDependents` switches off the active plugins that need it first, deepest first;
    // a business blocker on any of them refuses the whole operation and names that plugin.
    deactivate(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      // Rules 12, 36 and 37 read the rows an install in flight is still writing: wait for it.
      if (refuseIfBusy(res)) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      const reconciling = Boolean(req.reconciling);
      const closure = graph().activeDependantClosure(entry.id);
      const confirmed = reconciling ? 'none' : confirmation(req.body && req.body.withDependents, closure);
      if (confirmed === 'stale' && closure.length) return refuseStale(res, closure);
      const cascade = confirmed === 'ok';
      if (!cascade && refuseIfRequiredBy(entry, res, { activeOnly: true, reconciling })) return undefined;
      const followers = cascade ? closure : [];
      const stuck = followers.find((id) => blockerFor(id, model));
      if (stuck) {
        const blocker = blockerFor(stuck, model);
        return res.status(409).json({
          error: 'PLUGIN_BLOCKED', code: blocker.code, plugin: stuck, message: `${nameOf(stuck)} ne peut pas être désactivé : ${reasonOf(blocker)}.`,
        });
      }
      if (refuseIfBlocked(entry, res)) return undefined;
      [...followers, entry.id].forEach((id) => {
        model.setEnabled(id, false);
        loader().markInactive(id);
      });
      return res.json(view(entry));
    },

    // DELETE /api/plugins/:id — rule 6: back to « Disponibles », data kept. `?purge=1` also erases
    // the data of a plugin module (phase 1 rules 12, 21–24).
    uninstall(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      // Rules 12, 36 and 37 read the rows an install in flight is still writing: wait for it.
      if (refuseIfBusy(res)) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      const wantsPurge = req.query && (req.query.purge === '1' || req.query.purge === 'true');
      if (wantsPurge && !erasable(entry.id)) return res.status(409).json({ error: 'NOT_ERASABLE' });
      if (refuseIfRequiredBy(entry, res, { reconciling: Boolean(req.reconciling) })) return undefined;
      if (refuseIfBlocked(entry, res)) return undefined;
      if (wantsPurge) {
        let databaseErased = false;
        try {
          purge(entry.id);
          databaseErased = true;
          // Rule 15 — the plugin's own files go with its tables.
          host().store().eraseData(entry.id);
        } catch (err) {
          console.error(`[plugin:${entry.id}] erasure failed:`, err && err.message ? err.message : err);
          // Rule 12: a failed erasure leaves the plugin installed and inactive. The message says what is
          // true: the database step is one transaction, the files step comes after it.
          model.setEnabled(entry.id, false);
          loader().markInactive(entry.id);
          return res.status(500).json({
            error: 'PLUGIN_PURGE_FAILED',
            message: databaseErased
              ? 'Effacement incomplet : les données sont effacées, pas les fichiers. À relancer.'
              : 'Échec de l’effacement : rien n’a été effacé.',
          });
        }
      }
      model.uninstall(entry.id);
      loader().markInactive(entry.id);
      return res.json(view(entry));
    },

    // GET /api/plugins/:id/settings — the declared keys; a secret reads `<key>Set` (rule 7).
    getSettings(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      const record = reg.get(entry.id);
      if (!record || !record.settings.length) return res.status(404).json({ error: 'NO_SETTINGS' });
      return res.json(settingsModel().httpView(entry.id, record.settings));
    },

    // PUT /api/plugins/:id/settings — '' on a secret keeps it, null clears it, a value replaces it.
    saveSettings(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      const record = reg.get(entry.id);
      if (!record || !record.settings.length) return res.status(404).json({ error: 'NO_SETTINGS' });
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const unknown = Object.keys(body).filter((key) => !record.settings.some((k) => k.key === key));
      if (unknown.length) return res.status(400).json({ error: 'UNKNOWN_SETTING', keys: unknown });
      // A declared `validate(value, body) → message | null` refuses the whole write (specs/plugins-phase-2-hosts.md
      // rule 15: the linen stock and laundry day keep the checks the core settings form had). `body` is
      // the whole write, for a key that depends on another one sent with it
      // (specs/google-vacation-rentals-feed.md rule 16: « Envoi » needs the partner id).
      const errors = {};
      record.settings.forEach(({ key, validate }) => {
        if (!validate || !Object.prototype.hasOwnProperty.call(body, key)) return;
        const message = validate(body[key], body);
        if (message) errors[key] = message;
      });
      if (Object.keys(errors).length) return res.status(400).json({ error: 'INVALID_SETTING', errors });
      record.settings.forEach(({ key, secret, afterSave }) => {
        if (!Object.prototype.hasOwnProperty.call(body, key)) return;
        const value = body[key];
        if (secret && value === '') return;
        const stored = value == null ? '' : String(value).trim();
        settingsModel().set(entry.id, key, stored, { secret: Boolean(secret) });
        if (afterSave) afterSave(stored);
      });
      return res.json(settingsModel().httpView(entry.id, record.settings));
    },
  };
}

const defaultController = createController();

module.exports = defaultController;
module.exports.createController = createController;
