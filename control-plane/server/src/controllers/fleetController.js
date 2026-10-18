/**
 * The page « Versions » and the operator's host actions (specs/hosting-h1-fleet-runtime.md rules 8,
 * 10, 11, 14): the releases installed on the host and how many instances run each, the newest
 * published one and its installation, a fleet update and its progress, a plugin push, and
 * « Restaurer à une date ». Payloads are ready to render.
 */

const { httpError } = require('../utils/httpError');
const { semver, plugins: gfPlugins } = require('../utils/gf');

const PHASE_LABELS = { downloading: 'Téléchargement…', verifying: 'Empreinte SHA-256 vérifiée…', extracting: 'Archive dépaquetée…', installing: 'Dépendances installées…' };
const ITEM_LABELS = { pending: 'En attente', running: 'En cours', done: 'Fait', rolled_back: 'Revenue en arrière', skipped: 'Non traitée' };
const UPDATE_LABELS = { running: 'En cours', done: 'Terminée', failed: 'Arrêtée' };
const SCOPE_LABELS = { all: 'toute la flotte', selection: 'une sélection', one: 'un client' };

const paris = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : null);

function createFleetController(ctx, customersController) {
  const { models, releases, fleetUpdater, restoreVerifier, instances } = ctx;
  const { customers, hosting } = models;
  let published = null;
  let install = null;

  function instanceRows() {
    return customers.list().filter((c) => !c.archivedAt).map((c) => ({ c, row: hosting.get(c.id) })).filter(({ row }) => row && row.version);
  }

  function updateView(update) {
    if (!update) return null;
    const names = new Map(customers.list().map((c) => [c.id, c.companyName]));
    return {
      id: update.id,
      kind: update.kind,
      title: update.kind === 'plugin' ? `${update.plugin_id} ${update.target_version}` : update.target_version,
      scopeLabel: SCOPE_LABELS[update.scope] || update.scope,
      state: update.state,
      stateLabel: UPDATE_LABELS[update.state],
      startedAt: paris(update.started_at),
      error: update.error,
      items: hosting.items(update.id).map((it) => ({
        customerId: it.customer_id,
        companyName: names.get(it.customer_id) || `#${it.customer_id}`,
        fromVersion: it.from_version,
        state: it.state,
        stateLabel: ITEM_LABELS[it.state],
        detail: it.detail || (it.state === 'pending' ? 'En attente' : ''),
      })),
    };
  }

  // H1 rule 28: a release that rolled an instance back and that no instance runs is « En échec »:
  // it is never the default target.
  function releaseRows(rows) {
    const rolledBack = hosting.rolledBackTargets();
    return releases.list().map((r) => {
      const on = rows.filter(({ row }) => row.version === r.version);
      const failed = rolledBack.has(r.version) && on.length === 0;
      return {
        version: r.version,
        installedAt: paris(r.installedAt),
        count: on.length,
        names: on.map(({ c }) => c.companyName),
        failed,
        statusLabel: failed ? 'En échec' : `${on.length} instance${on.length > 1 ? 's' : ''}`,
      };
    });
  }

  // Rule 11: each installed plugin, the versions the instances run and the registry's versions.
  function pluginPushView(rows) {
    const facts = rows.map(({ c }) => (instances.readFacts(c.slug) || {}).versions || {});
    const ids = [...new Set(facts.flatMap((f) => Object.keys(f)))].sort();
    return ids.map((id) => {
      const running = facts.filter((f) => id in f).map((f) => f[id] || '?');
      const counts = running.reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map());
      const versions = fleetUpdater.publishedPluginVersions(id);
      return {
        id,
        name: (gfPlugins.findPlugin(id) || { name: id }).name,
        count: running.length,
        runningLabel: [...counts].map(([v, n]) => `${v} × ${n}`).join(', '),
        versions,
        defaultVersion: versions[0] || null,
      };
    });
  }

  function view() {
    const rows = instanceRows();
    const releaseList = releaseRows(rows);
    const newest = releaseList[0] ? releaseList[0].version : null;
    const target = releaseList.find((r) => !r.failed);
    return {
      releases: releaseList,
      published: published && {
        version: published.version,
        installed: releases.has(published.version),
        newer: !newest || semver.isNewerVersion(published.version, newest),
        checkedAt: paris(published.checkedAt),
      },
      install,
      instances: rows.map(({ c, row }) => ({ id: c.id, companyName: c.companyName, version: row.version })),
      defaultTarget: target ? target.version : null,
      running: updateView(hosting.runningUpdate()),
      history: hosting.recentUpdates(8).filter((u) => u.state !== 'running').map(updateView),
      pluginPush: {
        available: fleetUpdater.pluginPushAvailable(),
        plugins: fleetUpdater.pluginPushAvailable() ? pluginPushView(rows) : [],
      },
    };
  }

  // The newest version published on GitHub (rule 8). Never throws: an unreachable GitHub says so.
  async function check() {
    const release = await releases.published().catch(() => null);
    if (!release) throw httpError(502, 'UNREACHABLE', 'Aucune version publiée lisible pour l’instant.');
    published = { ...release, checkedAt: ctx.now().toISOString() };
    return view();
  }

  // Rule 8, in the background: the page follows `install`.
  function installRelease(body, operator) {
    if (!published || published.version !== body.version) throw httpError(400, 'UNKNOWN', 'Version inconnue : vérifier d’abord les versions publiées.');
    if (install && install.state === 'running') throw httpError(409, 'BUSY', `Installation de la ${install.version} en cours.`);
    install = { version: body.version, state: 'running', label: 'Préparation…' };
    releases.install(published, { onPhase: (p) => { install = { ...install, label: PHASE_LABELS[p] || p }; } })
      .then(() => {
        install = { version: body.version, state: 'done', label: `${body.version} installée sur l’hôte.` };
        customersController.journal(null, operator, 'release', `Version ${body.version} installée sur l’hôte`);
      })
      .catch((err) => { install = { version: body.version, state: 'failed', label: err.message }; });
    return view();
  }

  // Rule 10: one customer, a selection, or the whole fleet (no `customerIds`).
  function startUpdate(body, operator) {
    const ids = Array.isArray(body.customerIds) ? body.customerIds.map(Number).filter(Boolean) : null;
    if (ids && !ids.length) throw httpError(400, 'INVALID', 'Aucun client choisi.');
    fleetUpdater.start({ targetVersion: String(body.targetVersion || ''), customerIds: ids, operator });
    return view();
  }

  // Rule 11.
  function pushPlugin(body, operator) {
    const ids = Array.isArray(body.customerIds) ? body.customerIds.map(Number).filter(Boolean) : null;
    fleetUpdater.start({
      kind: 'plugin', pluginId: String(body.pluginId || ''), targetVersion: String(body.version || ''), customerIds: ids, operator,
      installedPlugins: (c) => (instances.readFacts(c.slug) || {}).versions || {},
    });
    return view();
  }

  // Rule 14.
  async function restoreWindow(id) {
    const c = customersController.mustGet(id);
    const w = await restoreVerifier.window(c);
    if (!w) return { available: false, text: 'Aucune sauvegarde pour ce client.' };
    const to = ctx.now().toISOString();
    return { available: true, from: w.from, to, text: `Du ${paris(w.from)} au ${paris(to)}.` };
  }

  async function restore(id, body, operator) {
    const c = customersController.mustGet(id);
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    const out = await restoreVerifier.restoreAt(c, body.at, operator);
    return { ...customersController.view(c.id), notice: `Base restaurée (${out.reservations} réservation(s)).` };
  }

  return { view, check, installRelease, startUpdate, pushPlugin, restoreWindow, restore };
}

module.exports = { createFleetController };
