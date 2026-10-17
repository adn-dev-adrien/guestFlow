/**
 * The `litestream` backup driver (specs/hosting-h1-fleet-runtime.md H-D3, rules 12–14, 21): every
 * instance database streams its WAL to EU object storage through one Litestream service, running as
 * the instances' unprivileged user. Its configuration is root-owned and written by the root wrapper
 * `guestflow-litestream-apply` (deploy/hosting/) from the list of databases the console passes —
 * snapshots every 24 h, kept 30 days. Listings and restores read the replica by URL, with the object
 * storage keys from the console's environment. The uploads folder is synced each night with rclone
 * to the same bucket; rclone also purges a customer's copies at erasure.
 *
 * A replica is keyed by the customer, not the slug (`c<id>`): a rename never loses its history.
 */

const path = require('path');
const { splitCommand } = require('./exec');

// `litestream generations` → [{ start, end }] (ISO), one per generation of each replica.
function parseGenerations(stdout) {
  const rows = [];
  for (const line of String(stdout).split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length >= 5) rows.push({ start: cols[cols.length - 2], end: cols[cols.length - 1] });
  }
  return rows.filter((r) => !Number.isNaN(Date.parse(r.start)) && !Number.isNaN(Date.parse(r.end)));
}

// The replica of one database, as Litestream reads it by URL (no configuration needed): a restore or
// a listing works the same for an instance that is replicated now and for one whose replication was
// stopped at deprovisioning — its copies are kept until the erasure.
function replicaUrl({ url, key, endpoint, region }) {
  const params = new URLSearchParams();
  if (endpoint) params.set('endpoint', endpoint);
  if (region) params.set('region', region);
  const q = params.toString();
  return `${url.replace(/\/+$/, '')}/${key}/db${q ? `?${q}` : ''}`;
}

function createLitestreamBackupDriver({
  exec, listReplicas, url, endpoint = '', region = '', credentials = {},
  litestreamBin = 'litestream', applyCommand = 'sudo -n /usr/local/sbin/guestflow-litestream-apply', rcloneBin = 'rclone', rcloneRemote,
}) {
  const apply = splitCommand(applyCommand);
  // The object storage keys go to Litestream through its environment, never into a file.
  const env = { PATH: process.env.PATH, ...credentials };
  const replica = (inst) => replicaUrl({ url, key: inst.key, endpoint, region });

  // H-D3 with rule 21: the console never writes Litestream's configuration (Litestream runs it). It
  // hands the list of databases to a root wrapper that validates every entry, writes the file and
  // restarts the service.
  async function sync(extra = null, without = null) {
    const replicas = listReplicas().filter((r) => r.key !== (without && without.key));
    if (extra && !replicas.some((r) => r.key === extra.key)) replicas.push(extra);
    await exec(apply.file, [...apply.prefix, ...replicas.map((r) => `${r.key}=${r.dbPath}`)]);
  }

  async function generations(inst) {
    const { stdout } = await exec(litestreamBin, ['generations', replica(inst)], { env });
    return parseGenerations(stdout);
  }

  return {
    name: 'litestream',
    replicaUrl: replica,
    addReplica: (inst) => sync(inst),
    removeReplica: (inst) => sync(null, inst),
    async purge(inst) {
      await exec(rcloneBin, ['purge', `${rcloneRemote.replace(/\/+$/, '')}/${inst.key}`]);
    },
    // Rule 10: Litestream ships the WAL every second; the update's own snapshot is the local copy.
    async snapshotNow() {
      return null;
    },
    async tick() {
      return null;
    },
    async lastReplicatedAt(inst) {
      const rows = await generations(inst);
      return rows.length ? rows.map((r) => r.end).sort().pop() : null;
    },
    async window(inst) {
      const rows = await generations(inst);
      return rows.length ? { from: rows.map((r) => r.start).sort()[0], to: rows.map((r) => r.end).sort().pop() } : null;
    },
    async restore(inst, { at = null, output }) {
      const args = ['restore', '-o', output];
      if (at) args.push('-timestamp', new Date(at).toISOString());
      args.push(replica(inst));
      await exec(litestreamBin, args, { env, timeout: 30 * 60 * 1000 });
      return at ? new Date(at).toISOString() : null;
    },
    async syncUploads(inst) {
      await exec(rcloneBin, ['sync', path.join(inst.dir, 'uploads'), `${rcloneRemote.replace(/\/+$/, '')}/${inst.key}/uploads`]);
    },
    // The console's own database, copied nightly (it is not replicated by Litestream, which runs as
    // the instances' user and cannot read the console's directory).
    async syncConsole(file) {
      await exec(rcloneBin, ['copy', file, `${rcloneRemote.replace(/\/+$/, '')}/console/`]);
    },
  };
}

module.exports = { createLitestreamBackupDriver, parseGenerations, replicaUrl };
