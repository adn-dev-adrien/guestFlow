/**
 * The `litestream` backup driver (specs/hosting-h1-fleet-runtime.md H-D3, rules 12–14): every
 * instance database streams its WAL to EU object storage through one Litestream service, whose
 * configuration (`/etc/litestream.yml`) the console regenerates from the list of replicated
 * instances, then restarts. Snapshots every 24 h, kept 30 days. The uploads folder is synced each
 * night with rclone to the same bucket; rclone also purges a customer's copies at erasure.
 *
 * A replica is keyed by the customer, not the slug (`c<id>`): a rename never loses its history.
 */

const path = require('path');
const { splitCommand } = require('./exec');

const RETENTION = '720h';
const SNAPSHOT_INTERVAL = '24h';

function configYaml({ replicas, url, endpoint, region }) {
  const lines = ['# Written by the GuestFlow console (specs/hosting-h1-fleet-runtime.md) — edits are overwritten.', 'dbs:'];
  if (!replicas.length) return `${lines[0]}\ndbs: []\n`;
  for (const r of replicas) {
    lines.push(`  - path: ${r.dbPath}`, '    replicas:', '      - type: s3', `        url: ${url.replace(/\/+$/, '')}/${r.key}/db`);
    if (endpoint) lines.push(`        endpoint: ${endpoint}`);
    if (region) lines.push(`        region: ${region}`);
    lines.push(`        retention: ${RETENTION}`, `        snapshot-interval: ${SNAPSHOT_INTERVAL}`, '        sync-interval: 1s');
  }
  return `${lines.join('\n')}\n`;
}

// `litestream generations` → [{ start, end }] (ISO), one per generation of each replica.
function parseGenerations(stdout) {
  const rows = [];
  for (const line of String(stdout).split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length >= 5) rows.push({ start: cols[cols.length - 2], end: cols[cols.length - 1] });
  }
  return rows.filter((r) => !Number.isNaN(Date.parse(r.start)) && !Number.isNaN(Date.parse(r.end)));
}

function createLitestreamBackupDriver({
  exec, writeFile, listReplicas, configFile = '/etc/litestream.yml', url, endpoint = '', region = '',
  litestreamBin = 'litestream', restartCommand = 'sudo -n systemctl restart litestream', rcloneBin = 'rclone', rcloneRemote,
}) {
  const restart = splitCommand(restartCommand);

  async function sync(extra = null, without = null) {
    const replicas = listReplicas().filter((r) => r.key !== (without && without.key));
    if (extra && !replicas.some((r) => r.key === extra.key)) replicas.push(extra);
    writeFile(configFile, configYaml({ replicas, url, endpoint, region }));
    await exec(restart.file, restart.prefix);
  }

  async function generations(inst) {
    const { stdout } = await exec(litestreamBin, ['generations', '-config', configFile, inst.dbPath]);
    return parseGenerations(stdout);
  }

  return {
    name: 'litestream',
    configYaml: () => configYaml({ replicas: listReplicas(), url, endpoint, region }),
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
      const args = ['restore', '-config', configFile, '-o', output];
      if (at) args.push('-timestamp', new Date(at).toISOString());
      args.push(inst.dbPath);
      await exec(litestreamBin, args, { timeout: 30 * 60 * 1000 });
      return at ? new Date(at).toISOString() : null;
    },
    async syncUploads(inst) {
      await exec(rcloneBin, ['sync', path.join(inst.dir, 'uploads'), `${rcloneRemote.replace(/\/+$/, '')}/${inst.key}/uploads`]);
    },
  };
}

module.exports = { createLitestreamBackupDriver, configYaml, parseGenerations, RETENTION, SNAPSHOT_INTERVAL };
