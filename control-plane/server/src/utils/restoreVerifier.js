/**
 * Backups that are proven, and restores the operator can run (specs/hosting-h1-fleet-runtime.md
 * rules 13–14).
 *
 * Weekly (rule 13): each customer's latest backup is restored into a temporary folder, checked with
 * `PRAGMA integrity_check`, its reservations counted; the result is recorded and a failure is an
 * alert. Nothing touches the running instance.
 *
 * « Restaurer à une date » (rule 14): the instance stops, its current database is kept aside as
 * `guestflow.db.before-restore-<ts>`, the copy of that moment takes its place, and the instance
 * restarts and must pass its health check. Refused while a fleet update runs.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { verify } = require('./sqliteBackup');
const { waitHealthy } = require('./health');
const { httpError } = require('./httpError');

function createRestoreVerifier({ models, drivers, provisioner, fleetUpdater, now, fetchImpl = fetch, healthTimeoutMs = 60000, alerts, journal = () => {} }) {
  const { hosting, customers, provisioning } = models;
  const stamp = () => now().toISOString();

  // The customers whose backup exists: created up to their backup step, not erased. A deprovisioned
  // customer's copies are kept until the erasure and still checked: the drivers restore them by
  // replica (Litestream by URL), whether or not the instance is still replicated (review 2026-10-17).
  function replicated() {
    return customers.list().filter((c) => {
      const row = provisioning.get(c.id, 'backup');
      return row && row.status === 'ok';
    });
  }

  // Rule 13. → [{ customerId, ok, reservations, detail }]
  async function weekly() {
    const results = [];
    for (const c of replicated()) {
      const inst = provisioner.instanceOf(c);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `gf-restore-check-${c.id}-`));
      let result;
      try {
        await drivers.backup.restore(inst, { output: path.join(tmp, 'guestflow.db') });
        result = verify(path.join(tmp, 'guestflow.db'));
      } catch (err) {
        result = { ok: false, reservations: null, detail: err.message };
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
      const at = stamp();
      hosting.addCheck({ customerId: c.id, at, ok: result.ok, reservations: result.reservations, detail: result.detail });
      const key = `restore:${c.id}`;
      if (result.ok) {
        hosting.set(c.id, { last_backup_verified_at: at });
        alerts.close(key);
      } else {
        alerts.open({ key, customerId: c.id, kind: 'restore', severity: 'error', text: `${c.companyName} : la restauration de contrôle a échoué (${result.detail || 'base illisible'}).` });
      }
      results.push({ customerId: c.id, ...result });
    }
    return results;
  }

  // The moments « Restaurer à une date » can reach. → { from, to } | null
  async function window(c) {
    return drivers.backup.window(provisioner.instanceOf(c)).catch(() => null);
  }

  // Rule 14. Run inside the customer's sequence lock, and while it runs no fleet update starts.
  async function restoreAt(c, at, operator) {
    if (fleetUpdater.busy()) throw httpError(409, 'UPDATE_RUNNING', 'Mise à jour de la flotte en cours : restauration impossible avant sa fin.');
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) throw httpError(400, 'INVALID', 'Date invalide.');
    const range = await window(c);
    if (!range) throw httpError(409, 'NO_BACKUP', 'Aucune sauvegarde pour ce client.');
    if (when < new Date(range.from) || when > now()) throw httpError(400, 'OUT_OF_RANGE', 'Date hors de la période conservée.');
    return fleetUpdater.whileRestoring(() => provisioner.exclusive(c.id, () => swap(c, when, operator)));
  }

  async function swap(c, when, operator) {
    const inst = provisioner.instanceOf(c);
    const suffix = `.before-restore-${stamp().replace(/[:.]/g, '-')}`;
    const restored = `${inst.dbPath}.restoring`;
    fs.rmSync(restored, { force: true });
    await drivers.backup.restore(inst, { at: when.toISOString(), output: restored });
    const check = verify(restored);
    if (!check.ok) {
      fs.rmSync(restored, { force: true });
      throw httpError(422, 'BAD_BACKUP', `Sauvegarde illisible à cette date (${check.detail}).`);
    }
    await drivers.process.stop(inst);
    try {
      await drivers.backup.removeReplica(inst);
      // The current files are moved aside as they are — a corrupt or missing database must not
      // stop the restore that is meant to repair it (review 2026-10-17).
      for (const ext of ['', '-wal', '-shm']) {
        if (fs.existsSync(`${inst.dbPath}${ext}`)) fs.renameSync(`${inst.dbPath}${ext}`, `${inst.dbPath}${suffix}${ext}`);
      }
      fs.renameSync(restored, inst.dbPath);
    } finally {
      fs.rmSync(restored, { force: true });
      await drivers.process.start(inst);
      await drivers.backup.addReplica(inst).catch(() => {});
    }
    const res = await waitHealthy({ url: drivers.proxy.healthUrl(inst), expectVersion: inst.version, timeoutMs: healthTimeoutMs, fetchImpl });
    const label = when.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
    const aside = `${path.basename(inst.dbPath)}${suffix}`;
    journal(c.id, operator, 'restore', `Base restaurée au ${label} (${check.reservations} réservation(s)) ; l’ancienne gardée sous ${aside}`);
    if (!res.ok) throw httpError(502, 'UNHEALTHY', `Base restaurée, mais l’instance ne répond pas : ${res.error}.`);
    return { aside, reservations: check.reservations };
  }

  return { weekly, window, restoreAt };
}

module.exports = { createRestoreVerifier };
