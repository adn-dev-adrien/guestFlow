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
const { compare } = require('../utils/semverRange');
const {
  MESSAGES, rangeRefusal, bestCandidate, bestRefusal, requirementPlan, changelogBetween, dependentsOf,
} = require('../utils/pluginOffers');

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
  const planCtx = () => ({
    sources: sources(), env: env(), installed: installedVersions(), nameOf, allows: (id) => licence().allowsPlugin(id),
  });

  const erasable = (id) => Boolean(reg.get(id) && reg.get(id).data);

  // Rule 12 — what « Effacer aussi ses données » would erase, as the server counts it.
  function dataLines(id) {
    const record = reg.get(id);
    if (!record || !record.data || !record.data.describe) return [];
    try {
      return record.data.describe(getDb()) || [];
    } catch {
      return [];
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
    if (!previousManifest(row)) return null;
    return { version: row.previousVersion, until: row.rollbackUntil, label: `Version ${row.previousVersion}, possible jusqu’au ${frDay(row.rollbackUntil)}.` };
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
    if (!packages()) return { update: null, offer: null, incompatible, rollback: null };
    const src = sources();
    if (!row) {
      const offer = bestCandidate(entry.id, src, env());
      if (!offer) {
        const refusal = bestRefusal(entry.id, src, env()) || { code: 'UNAVAILABLE', message: 'Indisponible.' };
        return { update: null, incompatible: null, rollback: null, offer: { version: null, requirements: [], refusal } };
      }
      const { plan, refusal } = requirementPlan(offer.manifest, planCtx());
      return {
        update: null, incompatible: null, rollback: null,
        offer: { version: offer.version, requirements: plan.map(({ id, name, version }) => ({ id, name, version })), refusal },
      };
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

  function updateView(row, target) {
    const { plan, refusal } = requirementPlan(target.manifest, planCtx());
    const missing = plan.length ? { code: 'REQUIREMENT_MISSING', message: `Nécessite ${plan.map((p) => p.name).join(', ')} : à installer d’abord.` } : null;
    return {
      version: target.version,
      changelog: changelogBetween(target.manifest, row.version, target.version),
      refusal: refusal || missing,
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

  function view(entry) {
    const row = model.get(entry.id);
    const record = reg.get(entry.id);
    const pkg = packageView(entry, row);
    let state = !row ? 'available' : row.enabled ? 'active' : 'inactive';
    if (row && record && record.failed) state = 'failed';
    if (row && pkg.incompatible) state = 'incompatible';
    // A version installed from the registry describes itself (rule 2); otherwise the release's copy.
    const manifest = (row && row.manifest) || entry;
    const copy = host().runningCopy(entry.id);
    let version = row ? row.version || (copy && copy.manifest.version) || entry.version : entry.version;
    if (!row && pkg.offer && pkg.offer.version) version = pkg.offer.version;
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
      blocker: state === 'available' ? null : blockerFor(entry.id, model),
      setup: setupView(entry.id, state),
      hasModule: Boolean(record) || Boolean(copy),
      erasable: erasable(entry.id),
      data: row && erasable(entry.id) ? dataLines(entry.id) : [],
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
    const views = catalogue().map(view);
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
  async function installPackage(id, candidate, undo = [], installed = []) {
    const pkg = await acquire(id, candidate);
    if (candidate.source === 'registry') {
      const before = host().store().readCurrent(id);
      host().store().setCurrent(id, candidate.version);
      undo.push(() => (before ? host().store().setCurrent(id, before) : host().store().clearCurrent(id)));
    }
    const loaded = host().state().loaded[id];
    let restart = false;
    if (loaded && loaded !== candidate.version) {
      restart = true;
    } else if (!loaded) {
      let mod;
      try {
        mod = loader().requirePackage(id, pkg.dir);
      } catch (err) {
        mod = { id, register() { throw err; } };
      }
      if (!loader().registerLive(mod, { db: getDb() })) {
        return { status: 500, body: { error: 'PLUGIN_REGISTER_FAILED', plugin: id, message: 'Échec du démarrage.' } };
      }
      host().setLoaded(id, candidate.version, pkg.manifest.contentHash);
      undo.push(() => host().unsetLoaded(id));
      try {
        loader().migrate(getDb(), id);
      } catch (err) {
        console.error(`[plugin:${id}] install migration failed:`, err && err.message ? err.message : err);
        return { status: 500, body: { error: 'PLUGIN_MIGRATION_FAILED', plugin: id } };
      }
    }
    model.install(id, { version: candidate.version, source: candidate.source, manifest: pkg.manifest, sha256: pkg.sha256 });
    undo.push(() => model.uninstall(id));
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

  function refuseUpdateConditions(res) {
    if (!packages()) { res.status(409).json({ error: 'NO_UPDATE', message: MESSAGES.NO_UPDATE }); return true; }
    if (host().state().updating) { res.status(409).json({ error: 'UPDATE_IN_PROGRESS', message: MESSAGES.UPDATE_IN_PROGRESS }); return true; }
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
    const withRequirements = Boolean(req.body && req.body.withRequirements);
    if (plan.length && !withRequirements) {
      return res.status(409).json({
        error: 'REQUIREMENTS',
        message: `Nécessite aussi : ${plan.map((p) => p.name).join(', ')}.`,
        requirements: plan.map(({ id, name, version }) => ({ id, name, version })),
      });
    }
    const steps = [...plan.map((p) => ({ id: p.id, candidate: bestCandidate(p.id, sources(), env(), { range: p.version }) })), { id: entry.id, candidate: offer }];
    const state = host().state();
    // A version other than the one still loaded needs a restart (rule 13): refused up front without a
    // supervisor, like an update.
    const needsRestart = steps.some((st) => state.loaded[st.id] && state.loaded[st.id] !== st.candidate.version);
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
      const rollback = () => undo.reverse().forEach((step) => step());
      try {
        let restartWanted = false;
        for (const step of steps) {
          let result;
          try {
            result = await installPackage(step.id, step.candidate, undo, installed); // eslint-disable-line no-await-in-loop
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
        if (restartWanted) return restart({ version: offer.version });
        installed.forEach((id) => loader().runActivateHooks(id));
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
  // installed; rule 36 — and stays active while an ACTIVE plugin requires it.
  // The reconciliation (`req.reconciling`) ignores the dependants the licence does not allow: they sit
  // out of the plan with their state kept (rule 21), and the operator cannot act on them.
  function refuseIfRequiredBy(entry, res, { activeOnly = false, reconciling = false } = {}) {
    const others = model.list().filter((r) => r.id !== entry.id && (!activeOnly || r.enabled)
      && (!reconciling || licence().allowsPlugin(r.id)));
    const dependents = dependentsOf(entry.id, Object.fromEntries(others.map((r) => [r.id, r.manifest || entryFor(r.id)])));
    if (!dependents.length) return false;
    const names = dependents.map((m) => m.name || nameOf(m.id)).join(', ');
    const step = activeOnly ? 'désactiver' : 'désinstaller';
    res.status(409).json({
      error: 'REQUIRED_BY', requiredBy: dependents.map((m) => m.id), message: `Nécessaire à ${names} : à ${step} d’abord.`,
    });
    return true;
  }

  // Rule 37 — the mirror of rule 36: a plugin is activated only once every plugin it requires is
  // installed and active, else it would run without what it is built on.
  function refuseIfRequirementInactive(entry, res) {
    const row = model.get(entry.id);
    const manifest = (row && row.manifest) || entry;
    const inactive = (manifest.requires || []).map((r) => r.id).filter((id) => {
      const required = model.get(id);
      return !required || !required.enabled;
    });
    if (!inactive.length) return false;
    const names = inactive.map(nameOf).join(', ');
    res.status(409).json({
      error: 'REQUIREMENT_INACTIVE', requires: inactive, message: `Nécessite ${names} : à activer d’abord.`,
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
      if (!operatorManaged()) return res.json(catalogue().map(view));
      const live = catalogue().filter((entry) => {
        const row = model.get(entry.id);
        return Boolean(row && row.enabled && reg.isLive(entry.id));
      });
      return res.json(live.map(view).map(({ id, name, icon, setup }) => ({ id, name, icon, setup })));
    },

    /** The same views, for the core's own readers (the Paramètres summary, rule 25). */
    views() {
      return catalogue().map(view);
    },

    // POST /api/plugins/:id/install — rule 4: installed and active in one step. A module's tables are
    // created first (phase 1 rule 6); a failed migration leaves the plugin available.
    async install(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (model.get(entry.id)) return res.status(409).json({ error: 'ALREADY_INSTALLED' });
      if (refuseIfOutOfPlan(entry, res)) return undefined;
      if (packages()) return installFromPackages(entry, req, res);
      if (reg.get(entry.id)) {
        try {
          loader().migrate(getDb(), entry.id);
        } catch (err) {
          console.error(`[plugin:${entry.id}] install migration failed:`, err && err.message ? err.message : err);
          return res.status(500).json({ error: 'PLUGIN_MIGRATION_FAILED', plugin: entry.id });
        }
      }
      model.install(entry.id);
      if (reg.get(entry.id)) {
        loader().beginInstall(entry.id);
        try {
          await loader().runInstallHooks(entry.id);
          loader().runActivateHooks(entry.id);
        } finally {
          loader().endInstall(entry.id);
        }
      }
      return res.json(view(entry));
    },

    // GET /api/plugins/page?path=/comptabilite — specs/plugins-phase-p-productisation.md rules 40, 42:
    // the address of a page whose plugin is off reads « Plugin inactif », not « Page introuvable ».
    // A page shows while any of its plugins is active: then the address answers like a core page.
    pageOwner(req, res) {
      const plugins = pluginsOfPage(req.query && req.query.path)
        .map((id) => view(entryFor(id) || bareEntry(id, { name: PLUGIN_DISPLAY_NAMES[id] })))
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
      const targets = catalogue().map((entry) => {
        const row = model.get(entry.id);
        if (!row || host().state().incompatible[entry.id] || !licence().allowsPlugin(entry.id)) return null;
        const target = updateTarget(row, null);
        return target && !updateView(row, target).refusal ? { row, target } : null;
      }).filter(Boolean);
      if (!targets.length) return res.status(409).json({ error: 'NO_UPDATE', message: MESSAGES.NO_UPDATE });
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
      return underLock(res, async (restart) => {
        const manifest = previousManifest(row);
        if (row.previousSource === 'registry') host().store().setCurrent(row.id, row.previousVersion);
        model.rollBack(row.id, manifest);
        return restart({ version: row.previousVersion });
      });
    },

    // POST /api/plugins/:id/activate
    activate(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      if (refuseIfOutOfPlan(entry, res)) return undefined;
      if (refuseIfRequirementInactive(entry, res)) return undefined;
      model.setEnabled(entry.id, true);
      if (reg.get(entry.id)) loader().runActivateHooks(entry.id);
      return res.json(view(entry));
    },

    // POST /api/plugins/:id/deactivate — rule 5: data and settings kept.
    deactivate(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      if (refuseIfRequiredBy(entry, res, { activeOnly: true, reconciling: Boolean(req.reconciling) })) return undefined;
      if (refuseIfBlocked(entry, res)) return undefined;
      model.setEnabled(entry.id, false);
      loader().markInactive(entry.id);
      return res.json(view(entry));
    },

    // DELETE /api/plugins/:id — rule 6: back to « Disponibles », data kept. `?purge=1` also erases
    // the data of a plugin module (phase 1 rules 12, 21–24).
    uninstall(req, res) {
      const entry = resolve(req, res);
      if (!entry) return undefined;
      if (!model.get(entry.id)) return res.status(409).json({ error: 'NOT_INSTALLED' });
      const wantsPurge = req.query && (req.query.purge === '1' || req.query.purge === 'true');
      if (wantsPurge && !erasable(entry.id)) return res.status(409).json({ error: 'NOT_ERASABLE' });
      if (refuseIfRequiredBy(entry, res, { reconciling: Boolean(req.reconciling) })) return undefined;
      if (refuseIfBlocked(entry, res)) return undefined;
      if (wantsPurge) {
        try {
          purge(entry.id);
          // Rule 15 — the plugin's own files go with its tables.
          host().store().eraseData(entry.id);
        } catch (err) {
          console.error(`[plugin:${entry.id}] erasure failed:`, err && err.message ? err.message : err);
          // Rule 12: a failed erasure leaves the plugin installed and inactive.
          model.setEnabled(entry.id, false);
          return res.status(500).json({ error: 'PLUGIN_PURGE_FAILED', message: 'Échec de l’effacement : rien n’a été effacé.' });
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
