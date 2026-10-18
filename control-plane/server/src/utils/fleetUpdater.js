/**
 * Updating the fleet (specs/hosting-h1-fleet-runtime.md rules 10–11): one customer, a selection or
 * every instance, one at a time —
 *
 *   1. stop the instance, then snapshot its database (a consistent copy, and a backup forced
 *      through the driver) — stopped first, so a rollback loses nothing written meanwhile;
 *   2. switch the version (or apply the plugin update);
 *   3. start;
 *   4. check health within 60 s, on the expected version.
 *
 * A failed check puts that instance back: the previous version, the database of the snapshot, a
 * restart. The fleet update stops there, the remaining instances untouched, and shows the error.
 * Only one fleet update runs at a time; a restore waits for it, and an update waits for a restore
 * (edge case of §3; review 2026-10-17). Each instance is updated inside its customer's sequence
 * lock, so no creation step, restart or restore runs on it at the same time.
 */

const fs = require('fs');
const path = require('path');
const { backupTo, removeDatabaseFiles } = require('./sqliteBackup');
const { assertInside, shareDatabase } = require('./instanceFiles');
const { waitHealthy } = require('./health');
const { httpError } = require('./httpError');

const KEEP_SNAPSHOTS = 3;
const PHASES = { snapshot: 'Instantané de la base', switch: 'Bascule de version', restart: 'Redémarrage', health: 'Contrôle de santé' };


function createFleetUpdater({
  models, drivers, releases, provisioner, now, fetchImpl = fetch, healthTimeoutMs = 60000, journal = () => {},
  pluginInstaller = null, log = (msg) => console.log(msg),
}) {
  const { hosting, customers } = models;
  let current = null;
  const stamp = () => now().toISOString();

  function pruneSnapshots(dir) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.startsWith('before-update-')).sort();
    } catch {
      return;
    }
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_SNAPSHOTS))) fs.rmSync(path.join(dir, f), { force: true });
  }

  async function snapshot(inst, label) {
    const dir = path.join(inst.dir, 'data', 'backups');
    const file = path.join(dir, `before-update-${stamp().replace(/[:.]/g, '-')}-${label}.db`);
    assertInside(inst.dir, inst.dbPath);
    await backupTo(inst.dbPath, file);
    await drivers.backup.snapshotNow(inst).catch(() => null);
    pruneSnapshots(dir);
    return file;
  }

  // A process that has already exited is not waited for 60 s. `expect` = { version, plugin }.
  async function healthy(inst, expect) {
    const gone = async () => ((await drivers.process.state(inst)) === 'failed' ? 'le processus s’est arrêté au démarrage' : null);
    return waitHealthy({
      url: drivers.proxy.healthUrl(inst), expectVersion: expect.version, expectPlugin: expect.plugin || null, timeoutMs: healthTimeoutMs, fetchImpl, gone,
    });
  }

  // How each kind of update changes an instance, and undoes it.
  const KINDS = {
    release: {
      async apply(c, update) {
        const row = hosting.get(c.id);
        hosting.set(c.id, { previous_version: row.version, version: update.target_version });
        provisioner.syncEnv(c);
        return { version: update.target_version };
      },
      async revert(c, item) {
        hosting.set(c.id, { version: item.from_version, previous_version: null });
        provisioner.syncEnv(c);
        return { version: item.from_version };
      },
    },
    // Rule 11: a plugin version from the console's registry, pushed to the instances that have the
    // plugin installed (`pluginInstaller`: the instance's own script switches the package). The
    // health check also asks that the plugin loaded at that version; the rollback puts the snapshot's
    // database back — the row and its previous package — then `current` follows it.
    plugin: {
      async apply(c, update) {
        await pluginInstaller.install(provisioner.instanceOf(c), update.plugin_id, update.target_version);
        return { version: (hosting.get(c.id) || {}).version, plugin: { id: update.plugin_id, version: update.target_version } };
      },
      async revert(c, item, update) {
        await pluginInstaller.rollback(provisioner.instanceOf(c), update.plugin_id);
        return { version: (hosting.get(c.id) || {}).version };
      },
    },
  };

  async function updateOne(update, item) {
    const kind = KINDS[update.kind];
    const c = customers.get(item.customer_id);
    const set = (state, phase, detail = '', snap = null) => hosting.setItem(update.id, c.id, { state, phase, detail, snapshot: snap });
    set('running', 'snapshot', PHASES.snapshot);
    const before = provisioner.instanceOf(c);
    let snap;
    try {
      await drivers.process.stop(before);
      snap = await snapshot(before, update.target_version);
    } catch (err) {
      await drivers.process.start(before).catch(() => {});
      set('rolled_back', 'snapshot', `Instantané impossible : ${err.message}. Rien n’a changé.`);
      return { ok: false, error: `${c.companyName} : instantané impossible (${err.message}).` };
    }
    let failure = null;
    try {
      set('running', 'switch', PHASES.switch, snap);
      const expect = await kind.apply(c, update);
      set('running', 'restart', PHASES.restart, snap);
      await drivers.process.start(provisioner.instanceOf(c));
      set('running', 'health', PHASES.health, snap);
      const res = await healthy(provisioner.instanceOf(c), expect);
      if (!res.ok) failure = res.error;
    } catch (err) {
      failure = err.message;
    }
    if (!failure) {
      set('done', 'health', `${update.kind === 'plugin' ? `${update.plugin_id} ${update.target_version}` : update.target_version} répond.`, snap);
      journal(c.id, update.operator, 'update', update.kind === 'plugin'
        ? `Plugin ${update.plugin_id} mis à jour en ${update.target_version}`
        : `Mise à jour ${item.from_version} → ${update.target_version}`);
      return { ok: true };
    }
    // Back to where it was: the previous version, the snapshot's database, a restart.
    let back = '';
    try {
      const inst = provisioner.instanceOf(c);
      await drivers.process.stop(inst);
      removeDatabaseFiles(inst.dbPath);
      fs.copyFileSync(snap, inst.dbPath);
      shareDatabase(inst.dbPath);
      const expect = await kind.revert(c, item, update);
      await drivers.process.start(provisioner.instanceOf(c));
      const res = await healthy(provisioner.instanceOf(c), expect);
      const where = update.kind === 'plugin' ? `${update.plugin_id} ${item.from_version || 'précédent'}` : expect.version;
      back = res.ok ? `retour en ${where}, base de l’instantané remise` : `retour en ${where} sans réponse (${res.error})`;
    } catch (err) {
      back = `retour arrière impossible (${err.message})`;
    }
    set('rolled_back', 'health', `${failure} ; ${back}.`, snap);
    journal(c.id, update.operator, 'update', `${update.kind === 'plugin' ? `Plugin ${update.plugin_id} : mise à jour` : 'Mise à jour'} vers ${update.target_version} annulée : ${failure} ; ${back}`);
    return { ok: false, error: `${c.companyName} : ${failure}.` };
  }

  async function run(updateId) {
    const update = hosting.getUpdate(updateId);
    for (const item of hosting.items(updateId)) {
      const result = await provisioner.exclusive(item.customer_id, () => updateOne(update, item)).catch((err) => ({ ok: false, error: err.message }));
      if (!result.ok) {
        hosting.skipRest(updateId, 'Mise à jour arrêtée.');
        hosting.endUpdate(updateId, 'failed', stamp(), result.error);
        log(`[fleet] update ${updateId} stopped: ${result.error}`);
        return;
      }
    }
    hosting.endUpdate(updateId, 'done', stamp(), null);
  }

  // The instances an update reaches: provisioned, running, not archived, not already there.
  function eligible(customerIds) {
    const wanted = customerIds ? new Set(customerIds.map(Number)) : null;
    return customers.list()
      .filter((c) => !c.archivedAt && (!wanted || wanted.has(c.id)))
      .map((c) => ({ c, row: hosting.get(c.id) }))
      .filter(({ row }) => row && row.version && row.port);
  }

  /**
   * Starts an update in the background. `customerIds` null = the whole fleet.
   * → { updateId, count }
   */
  let restoring = 0;
  // A restore holds the fleet back while it runs (and the restore refuses while an update runs).
  async function whileRestoring(fn) {
    restoring += 1;
    try {
      return await fn();
    } finally {
      restoring -= 1;
    }
  }

  function start({ kind = 'release', pluginId = null, targetVersion, customerIds = null, operator, installedPlugins = () => null }) {
    if (current || hosting.runningUpdate()) throw httpError(409, 'UPDATE_RUNNING', 'Une mise à jour de la flotte est déjà en cours.');
    if (restoring) throw httpError(409, 'RESTORE_RUNNING', 'Restauration en cours : mise à jour impossible avant sa fin.');
    let targets;
    if (kind === 'plugin') {
      if (!pluginInstaller) throw httpError(412, 'NO_REGISTRY', 'Disponible avec le registre des plugins.');
      if (!pluginInstaller.published(pluginId).includes(targetVersion)) throw httpError(400, 'NOT_PUBLISHED', `${pluginId} ${targetVersion} n’est pas publié dans le registre.`);
      targets = eligible(customerIds)
        .map((t) => ({ ...t, from: (installedPlugins(t.c) || {})[pluginId] }))
        .filter((t) => t.from !== undefined && t.from !== targetVersion);
    } else {
      if (!releases.has(targetVersion)) throw httpError(400, 'NOT_INSTALLED', `La version ${targetVersion} n’est pas installée sur l’hôte.`);
      targets = eligible(customerIds).filter(({ row }) => row.version !== targetVersion);
    }
    if (!targets.length) throw httpError(400, 'NOTHING_TO_DO', 'Aucune instance à mettre à jour.');
    const scope = customerIds ? (customerIds.length === 1 ? 'one' : 'selection') : 'all';
    const updateId = hosting.createUpdate({
      kind, pluginId, targetVersion, scope, startedAt: stamp(), operator,
      items: targets.map(({ c, row, from }) => ({ customerId: c.id, fromVersion: kind === 'plugin' ? from || null : row.version })),
    });
    current = run(updateId).catch((err) => {
      hosting.endUpdate(updateId, 'failed', stamp(), err.message);
    }).finally(() => { current = null; });
    return { updateId, count: targets.length };
  }

  const busy = () => Boolean(current) || Boolean(hosting.runningUpdate());
  const whenIdle = () => (current || Promise.resolve());

  // A console restarted in the middle of an update cannot know where the instance stood: the update
  // is closed as failed, and the operator looks at the instance.
  function recover() {
    const stale = hosting.runningUpdate();
    if (stale && !current) {
      hosting.skipRest(stale.id, 'Console redémarrée pendant la mise à jour.');
      hosting.endUpdate(stale.id, 'failed', stamp(), 'Console redémarrée pendant la mise à jour : vérifier l’instance en cours.');
    }
  }

  return {
    start, busy, whenIdle, recover, whileRestoring, PHASES,
    pluginPushAvailable: () => Boolean(pluginInstaller),
    publishedPluginVersions: (id) => (pluginInstaller ? pluginInstaller.published(id) : []),
  };
}

module.exports = { createFleetUpdater, PHASES };
