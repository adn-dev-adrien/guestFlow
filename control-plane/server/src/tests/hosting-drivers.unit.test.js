// specs/hosting-h1-fleet-runtime.md — the host drivers (H-D1 to H-D6): what each one writes and the
// exact commands it runs, through an injected exec. The systemd unit template (rule 1.5), the Caddy
// site, closed page and redirect (rules 1.6, 3, 5) with a refused reload that keeps the previous
// file, the Litestream configuration and commands (rules 12, 14), the instance environment (rules
// 1.1–1.3, 18) and the local backup's points in time (rule 14).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { createSystemdProcessDriver, parseShow, stateOf } = require('../utils/drivers/process-systemd');
const { createCaddyProxyDriver, siteFile } = require('../utils/drivers/proxy-caddy');
const { createNoneProxyDriver } = require('../utils/drivers/proxy-none');
const { createLitestreamBackupDriver, configYaml, parseGenerations } = require('../utils/drivers/backup-litestream');
const { createLocalBackupDriver } = require('../utils/drivers/backup-local');
const { createMailDriver } = require('../utils/drivers/mail-platform');
const { createDrivers } = require('../utils/drivers');
const { buildEnv, writeEnv, readEnv, parseEnv, serializeEnv } = require('../utils/instanceEnv');

const DEPLOY = path.resolve(__dirname, '..', '..', '..', '..', 'deploy', 'hosting');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cp-drivers-'));

function recordingExec(answers = {}) {
  const calls = [];
  const exec = async (file, args = []) => {
    const line = [file, ...args].join(' ');
    calls.push(line);
    for (const [prefix, answer] of Object.entries(answers)) {
      if (line.startsWith(prefix)) {
        if (answer instanceof Error) throw answer;
        return { stdout: answer, stderr: '' };
      }
    }
    return { stdout: '', stderr: '' };
  };
  return { exec, calls };
}

const inst = (over = {}) => ({ customerId: 12, key: 'c12', slug: 'aulnes', dir: '/srv/guestflow/instances/aulnes', dbPath: '/srv/guestflow/instances/aulnes/data/guestflow.db', port: 4407, version: '3.9.0', ...over });

test('rule 1 — the unit template runs the version named in the instance env file, with a memory limit and restart on failure (H-D1)', () => {
  const unit = fs.readFileSync(path.join(DEPLOY, 'guestflow@.service'), 'utf8');
  assert.match(unit, /^EnvironmentFile=\/srv\/guestflow\/instances\/%i\/env$/m);
  assert.match(unit, /^ExecStart=\/usr\/bin\/node \$\{GUESTFLOW_RELEASE_DIR\}\/server\/src\/index\.js$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^MemoryMax=\d+M$/m);
  assert.match(unit, /^User=guestflow$/m);
});

test('rule 1 — the systemd driver enables, stops and restarts guestflow@<slug> through the configured command', async () => {
  const { exec, calls } = recordingExec({
    'systemctl show guestflow@aulnes.service': 'LoadState=loaded\nActiveState=active\nUnitFileState=enabled\nMemoryCurrent=104857600\nMemoryMax=536870912\n',
  });
  const d = createSystemdProcessDriver({ exec, releasesDir: '/srv/guestflow/releases', systemctl: 'sudo -n /usr/local/sbin/guestflow-systemctl' });
  await d.enableNow(inst());
  await d.restart(inst());
  await d.disableNow(inst());
  assert.deepEqual(calls, [
    'sudo -n /usr/local/sbin/guestflow-systemctl enable --now guestflow@aulnes.service',
    'sudo -n /usr/local/sbin/guestflow-systemctl restart guestflow@aulnes.service',
    'sudo -n /usr/local/sbin/guestflow-systemctl disable --now guestflow@aulnes.service',
  ]);
  assert.equal(await d.state(inst()), 'running');
  assert.deepEqual(await d.memory(inst()), { current: 104857600, max: 536870912 });
  assert.equal(stateOf(parseShow('LoadState=not-found\nActiveState=inactive')), 'absent');
  assert.equal(stateOf(parseShow('LoadState=loaded\nActiveState=inactive\nUnitFileState=enabled')), 'failed');
  assert.equal(stateOf(parseShow('LoadState=loaded\nActiveState=inactive\nUnitFileState=disabled')), 'stopped');
});

test('rule 1 — the root wrapper accepts only the instance units and the Litestream restart', () => {
  const { spawnSync } = require('child_process');
  const wrapper = path.join(DEPLOY, 'guestflow-systemctl');
  // Every allowed call ends in `exec /usr/bin/systemctl`; a refused one exits 64 before.
  for (const args of [['enable', '--now', 'nginx.service'], ['stop', 'guestflow@a.service ssh.service'], ['restart', 'guestflow@../x.service'], ['kill', 'guestflow@aulnes.service'], ['enable', '--now', 'guestflow@aulnes.service', 'ssh.service']]) {
    const res = spawnSync('bash', [wrapper, ...args], { encoding: 'utf8' });
    assert.equal(res.status, 64, args.join(' '));
  }
  assert.match(fs.readFileSync(path.join(DEPLOY, 'guestflow.sudoers'), 'utf8'), /^guestflow ALL=\(root\) NOPASSWD: \/usr\/local\/sbin\/guestflow-systemctl$/m);
});

test('rules 1, 3, 5 — Caddy: one site per address, the closed page, the 301, then a reload', async () => {
  const dir = tmp();
  const { exec, calls } = recordingExec();
  const d = createCaddyProxyDriver({ exec, domain: 'guestflow.fr', sitesDir: dir, closedDir: '/srv/guestflow/closed' });
  await d.writeSite(inst());
  assert.equal(fs.readFileSync(path.join(dir, 'aulnes.caddy'), 'utf8'), siteFile({ host: 'aulnes.guestflow.fr', port: 4407 }));
  assert.match(fs.readFileSync(path.join(dir, 'aulnes.caddy'), 'utf8'), /aulnes\.guestflow\.fr \{\n\tencode zstd gzip\n\treverse_proxy 127\.0\.0\.1:4407\n\}/);
  await d.writeClosed('aulnes');
  assert.match(fs.readFileSync(path.join(dir, 'aulnes.caddy'), 'utf8'), /root \* \/srv\/guestflow\/closed\n\trewrite \* \/index\.html\n\tfile_server/);
  assert.deepEqual(d.route('aulnes'), { kind: 'closed' });
  await d.writeRedirect('aulnes', 'les-aulnes');
  assert.match(fs.readFileSync(path.join(dir, 'aulnes.caddy'), 'utf8'), /redir https:\/\/les-aulnes\.guestflow\.fr\{uri\} permanent/);
  await d.remove('aulnes');
  assert.equal(fs.existsSync(path.join(dir, 'aulnes.caddy')), false);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c === 'caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile'));
  assert.equal(d.healthUrl(inst()), 'https://aulnes.guestflow.fr/api/version');
  assert.deepEqual(d.instanceEnv(), { TRUST_PROXY_HOPS: '1', HTTPS_ENABLED: 'true', GUESTFLOW_TLS_UPSTREAM: '1', GUESTFLOW_LISTEN_HOST: '127.0.0.1' });
});

test('edge case — a reload Caddy refuses keeps the previous configuration and names Caddy’s message', async () => {
  const dir = tmp();
  let refuse = false;
  const exec = async () => { if (refuse) throw new Error('adapting config using caddyfile: unrecognized directive'); return { stdout: '' }; };
  const d = createCaddyProxyDriver({ exec, domain: 'guestflow.fr', sitesDir: dir });
  await d.writeSite(inst());
  const before = fs.readFileSync(path.join(dir, 'aulnes.caddy'), 'utf8');
  refuse = true;
  await assert.rejects(d.writeClosed('aulnes'), /^Error: Caddy : adapting config using caddyfile: unrecognized directive \(configuration précédente conservée\)$/);
  assert.equal(fs.readFileSync(path.join(dir, 'aulnes.caddy'), 'utf8'), before);
  await assert.rejects(d.writeSite(inst({ slug: 'neuf' })));
  assert.equal(fs.existsSync(path.join(dir, 'neuf.caddy')), false, 'a new site refused leaves no file');
});

test('rule 15 — the certificate expiry is read from what Caddy serves', async () => {
  const d = createCaddyProxyDriver({ exec: async () => ({}), domain: 'guestflow.fr', sitesDir: tmp(), peerCertificate: async (host) => (host === 'aulnes.guestflow.fr' ? { valid_to: 'Jan  2 10:00:00 2027 GMT' } : null) });
  assert.equal(await d.certExpiry('aulnes'), '2027-01-02T10:00:00.000Z');
  assert.equal(await d.certExpiry('moulin'), null);
});

test('rule 12 — Litestream: one entry per database, 24 h snapshots kept 30 days, keyed by customer; restart after each change', async () => {
  const written = {};
  const { exec, calls } = recordingExec();
  const replicas = [inst(), inst({ customerId: 14, key: 'c14', slug: 'moulin', dbPath: '/srv/guestflow/instances/moulin/data/guestflow.db' })];
  const d = createLitestreamBackupDriver({
    exec, writeFile: (f, t) => { written[f] = t; }, listReplicas: () => replicas.slice(0, 1),
    url: 's3://bucket/fleet/', endpoint: 'https://s3.fr-par.scw.cloud', region: 'fr-par', rcloneRemote: 'guestflow-backup:bucket/fleet',
    restartCommand: 'sudo -n /usr/local/sbin/guestflow-systemctl restart litestream',
  });
  await d.addReplica(replicas[1]);
  assert.equal(written['/etc/litestream.yml'], configYaml({ replicas, url: 's3://bucket/fleet/', endpoint: 'https://s3.fr-par.scw.cloud', region: 'fr-par' }));
  const yaml = written['/etc/litestream.yml'];
  assert.match(yaml, /- path: \/srv\/guestflow\/instances\/aulnes\/data\/guestflow\.db\n {4}replicas:\n {6}- type: s3\n {8}url: s3:\/\/bucket\/fleet\/c12\/db\n {8}endpoint: https:\/\/s3\.fr-par\.scw\.cloud\n {8}region: fr-par\n {8}retention: 720h\n {8}snapshot-interval: 24h/);
  assert.match(yaml, /url: s3:\/\/bucket\/fleet\/c14\/db/);
  await d.removeReplica(replicas[0]);
  assert.doesNotMatch(written['/etc/litestream.yml'], /c12/);
  await d.syncUploads(replicas[0]);
  await d.purge(replicas[0]);
  await d.restore(replicas[0], { at: '2026-10-07T08:30:00.000Z', output: '/tmp/x.db' });
  assert.deepEqual(calls, [
    'sudo -n /usr/local/sbin/guestflow-systemctl restart litestream',
    'sudo -n /usr/local/sbin/guestflow-systemctl restart litestream',
    'rclone sync /srv/guestflow/instances/aulnes/uploads guestflow-backup:bucket/fleet/c12/uploads',
    'rclone purge guestflow-backup:bucket/fleet/c12',
    'litestream restore -config /etc/litestream.yml -o /tmp/x.db -timestamp 2026-10-07T08:30:00.000Z /srv/guestflow/instances/aulnes/data/guestflow.db',
  ]);
  assert.match(configYaml({ replicas: [], url: 's3://b' }), /dbs: \[\]/);
});

test('rule 15 — the last replicated moment and the window come from `litestream generations`', async () => {
  const out = 'name  generation        lag   start                 end\ns3    a1b2c3d4e5f6a7b8  1s    2026-09-08T00:00:00Z  2026-10-08T09:59:58Z\ns3    0f0e0d0c0b0a0908  0s    2026-09-01T00:00:00Z  2026-09-08T00:00:00Z\n';
  assert.deepEqual(parseGenerations(out).length, 2);
  const { exec } = recordingExec({ 'litestream generations': out });
  const d = createLitestreamBackupDriver({ exec, writeFile: () => {}, listReplicas: () => [], url: 's3://b', rcloneRemote: 'r:b' });
  assert.equal(await d.lastReplicatedAt(inst()), '2026-10-08T09:59:58Z');
  assert.deepEqual(await d.window(inst()), { from: '2026-09-01T00:00:00Z', to: '2026-10-08T09:59:58Z' });
});

test('rule 14 — the local backup restores the newest copy at or before the moment asked', async () => {
  const dir = tmp();
  const db = path.join(dir, 'aulnes', 'data', 'guestflow.db');
  fs.mkdirSync(path.dirname(db), { recursive: true });
  const live = new Database(db);
  live.exec('CREATE TABLE reservations (id INTEGER PRIMARY KEY); INSERT INTO reservations VALUES (1)');
  let t = new Date('2026-10-08T08:00:00Z');
  const d = createLocalBackupDriver({ dir: path.join(dir, 'backups'), now: () => t, intervalMs: 600000 });
  const i = inst({ dir: path.join(dir, 'aulnes'), dbPath: db });
  await d.addReplica(i);
  t = new Date('2026-10-08T08:05:00Z');
  assert.equal(await d.tick(i), null, 'not yet: one copy per interval');
  live.exec('INSERT INTO reservations VALUES (2)');
  t = new Date('2026-10-08T08:11:00Z');
  assert.equal(await d.tick(i), '2026-10-08T08:11:00.000Z');
  live.close();
  assert.equal(await d.lastReplicatedAt(i), '2026-10-08T08:11:00.000Z');
  assert.deepEqual(await d.window(i), { from: '2026-10-08T08:00:00.000Z', to: '2026-10-08T08:11:00.000Z' });
  const count = async (at) => {
    const out = path.join(dir, `r-${Math.random()}.db`);
    await d.restore(i, { at, output: out });
    const r = new Database(out, { readonly: true });
    try { return r.prepare('SELECT COUNT(*) AS n FROM reservations').get().n; } finally { r.close(); }
  };
  assert.equal(await count('2026-10-08T08:10:00Z'), 1);
  assert.equal(await count('2026-10-08T08:12:00Z'), 2);
  await assert.rejects(d.restore(i, { at: '2026-10-07T00:00:00Z', output: path.join(dir, 'none.db') }), /Aucune sauvegarde à cette date/);
  await d.removeReplica(i);
  t = new Date('2026-10-08T09:00:00Z');
  assert.equal(await d.tick(i), null, 'a stopped replica takes no copy, and keeps the old ones');
  assert.ok(await d.lastReplicatedAt(i));
  await d.purge(i);
  assert.equal(await d.lastReplicatedAt(i), null);
});

test('rules 1, 18 — the instance env file: managed, its paths outside the release, its secrets kept, mode 600', () => {
  const dir = tmp();
  const vars = buildEnv({
    inst: { slug: 'aulnes', dir, port: 4407, version: '3.9.0' },
    releasesDir: '/srv/guestflow/releases',
    secrets: { GUESTFLOW_ENCRYPTION_KEY: 'a+b/c=', GUESTFLOW_SESSION_SECRET: 's"x' },
    licencePublicKey: 'MCowBQ==',
    extra: createMailDriver({ kind: 'platform', domain: 'guestflow.fr', env: { CP_PLATFORM_SMTP_HOST: 'smtp.brevo.com', CP_MAIL_DAILY_LIMIT: '250' } }).envFor({ dir }),
  });
  assert.equal(vars.GUESTFLOW_MANAGED, '1');
  assert.equal(vars.GUESTFLOW_SELF_UPDATE, 'off');
  assert.equal(vars.GUESTFLOW_RELEASE_DIR, '/srv/guestflow/releases/3.9.0');
  assert.equal(vars.DB_PATH, path.join(dir, 'data', 'guestflow.db'));
  assert.equal(vars.GUESTFLOW_UPLOADS_DIR, path.join(dir, 'uploads'));
  assert.equal(vars.GUESTFLOW_PLATFORM_SMTP_FROM, 'noreply@guestflow.fr');
  assert.equal(vars.GUESTFLOW_PLATFORM_MAIL_DAILY_LIMIT, '250');
  writeEnv(dir, vars);
  assert.equal(fs.statSync(path.join(dir, 'env')).mode & 0o777, 0o600);
  assert.deepEqual(readEnv(dir).GUESTFLOW_SESSION_SECRET, 's"x');
  assert.deepEqual(parseEnv(serializeEnv({ A: 'x\\y' })), { A: 'x\\y' });
});

test('H-D6 — the local drivers by default, the real ones by environment, and nothing else', () => {
  const base = { root: tmp(), releasesDir: '/r', dataDir: tmp(), domain: 'guestflow.test' };
  const local = createDrivers({ ...base, env: {} });
  assert.deepEqual([local.process.name, local.proxy.name, local.backup.name, local.mail.name], ['local', 'none', 'local', 'local']);
  const real = createDrivers({ ...base, env: { CP_PROCESS_DRIVER: 'systemd', CP_PROXY_DRIVER: 'caddy', CP_BACKUP_DRIVER: 'litestream', CP_MAIL_DRIVER: 'platform', CP_BACKUP_URL: 's3://b', CP_RCLONE_REMOTE: 'r:b' } });
  assert.deepEqual([real.process.name, real.proxy.name, real.backup.name, real.mail.name], ['systemd', 'caddy', 'litestream', 'platform']);
  assert.throws(() => createDrivers({ ...base, env: { CP_PROXY_DRIVER: 'nginx' } }), /driver « nginx » inconnu/);
  const none = createNoneProxyDriver({ root: base.root });
  assert.equal(none.healthUrl(inst()), 'http://127.0.0.1:4407/api/version');
});
