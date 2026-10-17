/**
 * The `local` backup driver (specs/hosting-h1-fleet-runtime.md H-D6): development and CI. Each
 * instance's database is copied with SQLite's online backup into `<dir>/<key>/snapshots/<time>.db`
 * every `intervalMs`; a point in time is the newest snapshot at or before it — the same contract as
 * Litestream's WAL replica, at a coarser grain. Snapshots older than the retention are dropped.
 */

const fs = require('fs');
const path = require('path');
const { backupTo } = require('../sqliteBackup');

const RETENTION_DAYS = 30;
const stampOf = (date) => date.toISOString().replace(/[:.]/g, '-');
const dateOf = (name) => {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
};

function createLocalBackupDriver({ dir, now = () => new Date(), intervalMs = 10 * 60 * 1000 }) {
  const base = (inst) => path.join(dir, inst.key);
  const snapDir = (inst) => path.join(base(inst), 'snapshots');
  const activeFile = (inst) => path.join(base(inst), '.active');

  function snapshots(inst) {
    try {
      return fs.readdirSync(snapDir(inst)).map((name) => ({ name, at: dateOf(name) })).filter((s) => s.at).sort((a, b) => a.at - b.at);
    } catch {
      return [];
    }
  }

  async function snapshotNow(inst) {
    const at = now();
    await backupTo(inst.dbPath, path.join(snapDir(inst), `${stampOf(at)}.db`));
    const cutoff = at.getTime() - RETENTION_DAYS * 86400000;
    for (const s of snapshots(inst)) if (s.at.getTime() < cutoff) fs.rmSync(path.join(snapDir(inst), s.name), { force: true });
    return at.toISOString();
  }

  return {
    name: 'local',
    async addReplica(inst) {
      fs.mkdirSync(snapDir(inst), { recursive: true });
      fs.writeFileSync(activeFile(inst), '');
      if (fs.existsSync(inst.dbPath)) await snapshotNow(inst);
    },
    // Rule 3: replication stops, the copies stay until the erasure.
    async removeReplica(inst) {
      fs.rmSync(activeFile(inst), { force: true });
    },
    // Rule 6: the copies go with the customer.
    async purge(inst) {
      fs.rmSync(base(inst), { recursive: true, force: true });
    },
    snapshotNow,
    // The continuous replication of Litestream, emulated: called by the probe every minute.
    async tick(inst) {
      if (!fs.existsSync(activeFile(inst)) || !fs.existsSync(inst.dbPath)) return null;
      const last = snapshots(inst).pop();
      if (last && now().getTime() - last.at.getTime() < intervalMs) return null;
      return snapshotNow(inst);
    },
    async lastReplicatedAt(inst) {
      const last = snapshots(inst).pop();
      return last ? last.at.toISOString() : null;
    },
    async window(inst) {
      const all = snapshots(inst);
      return all.length ? { from: all[0].at.toISOString(), to: all[all.length - 1].at.toISOString() } : null;
    },
    // Rule 14: the newest copy at or before `at` (the latest without `at`), written to `output`.
    async restore(inst, { at = null, output }) {
      const limit = at ? new Date(at).getTime() : Infinity;
      const pick = snapshots(inst).filter((s) => s.at.getTime() <= limit).pop();
      if (!pick) throw new Error(at ? 'Aucune sauvegarde à cette date.' : 'Aucune sauvegarde.');
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(path.join(snapDir(inst), pick.name), output);
      return pick.at.toISOString();
    },
    // The console's database: its nightly copy stays on this machine.
    async syncConsole() {},
    // Rule 12: the uploads, every night.
    async syncUploads(inst) {
      const uploads = path.join(inst.dir, 'uploads');
      if (!fs.existsSync(uploads)) return;
      fs.cpSync(uploads, path.join(base(inst), 'uploads'), { recursive: true });
    },
  };
}

module.exports = { createLocalBackupDriver, RETENTION_DAYS };
