/**
 * The `litestream` backup driver (specs/hosting-h1-fleet-runtime.md H-D3, rules 12–14, 21): every
 * instance database streams its WAL to EU object storage through one Litestream service, running as
 * its own unprivileged user. Its configuration is root-owned and written by the root wrapper
 * `guestflow-litestream-apply` (deploy/hosting/) from the target and the list of databases the console
 * passes — snapshots every 24 h, kept 30 days. Listings and restores use a one-database configuration
 * written for the call, with the object storage keys from the console's environment. The uploads folder is synced each night with rclone
 * to the same bucket; rclone also purges a customer's copies at erasure.
 *
 * A replica is keyed by the customer, not the slug (`c<id>`): a rename never loses its history.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
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

const replicaUrl = ({ url, key }) => `${url.replace(/\/+$/, '')}/${key}/db`;

// The configuration of ONE database, for a listing or a restore by the console. Litestream 0.3
// ignores an endpoint or a region given in a replica URL's query (review 2026-10-17): they must come
// from a configuration file. This one is written to the console's own directory, read once and
// removed; it carries no key (the keys travel in the environment). It works the same for an
// instance replicated now and for one whose replication stopped at deprovisioning.
function readerYaml({ dbPath, url, key, endpoint, region }) {
  const lines = ['dbs:', `  - path: ${dbPath}`, '    replicas:', '      - type: s3', `        url: ${replicaUrl({ url, key })}`];
  if (endpoint) lines.push(`        endpoint: ${endpoint}`, '        force-path-style: true');
  if (region) lines.push(`        region: ${region}`);
  return `${lines.join('\n')}\n`;
}

function createLitestreamBackupDriver({
  exec, listReplicas, url, endpoint = '', region = '', credentials = {},
  litestreamBin = 'litestream', applyCommand = 'sudo -n /usr/local/sbin/guestflow-litestream-apply', rcloneBin = 'rclone', rcloneRemote,
  rcloneEnv = null, tmpDir = os.tmpdir(),
}) {
  // A derived remote travels in rclone's environment (rule 27); a hand-made one reads rclone.conf.
  const rcloneOpts = rcloneEnv ? { env: { PATH: process.env.PATH, ...rcloneEnv } } : undefined;
  const rclone = (args) => exec(rcloneBin, args, rcloneOpts);
  const remote = () => {
    if (!rcloneRemote) throw new Error('Stockage objet non configuré (CP_BACKUP_URL).');
    return rcloneRemote.replace(/\/+$/, '');
  };
  const apply = splitCommand(applyCommand);
  // The object storage keys go to Litestream through its environment, never into a file.
  const env = { PATH: process.env.PATH, ...credentials };
  const replica = (inst) => replicaUrl({ url, key: inst.key });

  // Runs `litestream <command> -config <one-database file> … <db path>`, then removes the file.
  async function withConfig(inst, args, opts = {}) {
    fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    const file = path.join(tmpDir, `litestream-${inst.key}-${crypto.randomBytes(6).toString('hex')}.yml`);
    fs.writeFileSync(file, readerYaml({ dbPath: inst.dbPath, url, key: inst.key, endpoint, region }), { mode: 0o600, flag: 'wx' });
    try {
      return await exec(litestreamBin, [args[0], '-config', file, ...args.slice(1), inst.dbPath], { env, ...opts });
    } finally {
      fs.rmSync(file, { force: true });
    }
  }

  // H-D3 with rule 21: the console never writes Litestream's configuration (Litestream runs it). It
  // hands the list of databases to a root wrapper that validates every entry, writes the file and
  // restarts the service.
  // One rewrite at a time, each computed when its turn comes.
  let chain = Promise.resolve();
  function sync(extra = null, without = null) {
    const run = chain.catch(() => {}).then(async () => {
      const replicas = listReplicas().filter((r) => r.key !== (without && without.key));
      if (extra && !replicas.some((r) => r.key === extra.key)) replicas.push(extra);
      await exec(apply.file, [...apply.prefix, '--url', url, '--endpoint', endpoint || '-', '--region', region || '-',
        ...replicas.map((r) => `${r.key}=${r.dbPath}`)]);
    });
    chain = run;
    return run;
  }

  async function generations(inst) {
    const { stdout } = await withConfig(inst, ['generations']);
    return parseGenerations(stdout);
  }

  return {
    name: 'litestream',
    replicaUrl: replica,
    addReplica: (inst) => sync(inst),
    removeReplica: (inst) => sync(null, inst),
    async purge(inst) {
      await rclone(['purge', `${remote()}/${inst.key}`]);
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
      await withConfig(inst, args, { timeout: 30 * 60 * 1000 });
      return at ? new Date(at).toISOString() : null;
    },
    async syncUploads(inst) {
      await rclone(['sync', path.join(inst.dir, 'uploads'), `${remote()}/${inst.key}/uploads`]);
      // Property documents (settings-rationalization.md rule 32): the folder only exists once a document was added.
      await rclone(['sync', path.join(inst.dir, 'private-documents'), `${remote()}/${inst.key}/private-documents`])
        .catch((err) => { if (!/directory not found/i.test(String((err && (err.stderr || err.message)) || ''))) throw err; });
    },
    // The console's own database, copied nightly (it is not replicated by Litestream, which runs as
    // the instances' user and cannot read the console's directory).
    async syncConsole(file) {
      await rclone(['copy', file, `${remote()}/console/`]);
    },
  };
}

module.exports = { createLitestreamBackupDriver, parseGenerations, replicaUrl, readerYaml };
