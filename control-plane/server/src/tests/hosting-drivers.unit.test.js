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
const { createLitestreamBackupDriver, parseGenerations } = require('../utils/drivers/backup-litestream');
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
  assert.match(unit, /^EnvironmentFile=\/srv\/guestflow\/envs\/%i$/m);
  assert.match(unit, /^ExecStart=\/usr\/bin\/node \$\{GUESTFLOW_RELEASE_DIR\}\/server\/src\/index\.js$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^MemoryMax=\d+M$/m);
  assert.match(unit, /^Group=guestflow-app$/m);
});

test('rule 21 — an instance runs under its own identity and sees only its directory; Litestream is unprivileged; Caddy’s admin API is a socket', () => {
  const unit = fs.readFileSync(path.join(DEPLOY, 'guestflow@.service'), 'utf8');
  for (const line of [
    'User=nobody', 'Group=guestflow-app', 'ProtectProc=invisible', 'ProcSubset=pid', 'TemporaryFileSystem=/srv/guestflow/instances:ro', 'BindPaths=/srv/guestflow/instances/%i',
    'ReadWritePaths=/srv/guestflow/instances/%i', 'ReadOnlyPaths=/srv/guestflow/releases', 'ProtectSystem=strict', 'ProtectHome=true',
    'PrivateTmp=true', 'NoNewPrivileges=true', 'CapabilityBoundingSet=',
  ]) assert.match(unit, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`, 'm'), line);
  assert.match(unit, /^InaccessiblePaths=\/srv\/guestflow\/console \/srv\/guestflow\/envs .*-\/run\/caddy/m);
  assert.doesNotMatch(unit, /^User=guestflow$/m, 'never the console’s user');
  const litestream = fs.readFileSync(path.join(DEPLOY, 'litestream.override.conf'), 'utf8');
  assert.match(litestream, /^User=guestflow-backup$/m);
  assert.match(litestream, /^ProtectProc=invisible$/m);
  assert.match(litestream, /^InaccessiblePaths=\/srv\/guestflow\/console/m);
  assert.match(fs.readFileSync(path.join(DEPLOY, 'Caddyfile'), 'utf8'), /^\tadmin unix\/\/run\/caddy\/admin\.sock\|0660$/m);
  assert.doesNotMatch(fs.readFileSync(path.join(DEPLOY, 'Caddyfile'), 'utf8'), /localhost:2019/);
  const boot = fs.readFileSync(path.join(DEPLOY, 'bootstrap-host.sh'), 'utf8');
  assert.match(boot, /chown root:root \/etc\/litestream\.yml && chmod 644 \/etc\/litestream\.yml/);
  assert.match(boot, /chown guestflow:guestflow-app "\$ROOT\/instances" && chmod 2770/);
  assert.match(boot, /chown guestflow:guestflow-app "\$ROOT\/releases" && chmod 2750/);
  assert.match(boot, /chown guestflow:guestflow "\$ROOT\/envs" && chmod 700/);
  assert.match(boot, /systemctl restart litestream/);
  assert.match(boot, /chown root:caddy \/etc\/caddy\/Caddyfile && chmod 640/);
  assert.doesNotMatch(boot, /664 .*litestream\.yml|litestream\.yml.*664/, 'the configuration is never group-writable');
  assert.doesNotMatch(fs.readFileSync(path.join(DEPLOY, 'guestflow-systemctl'), 'utf8'), /systemctl restart litestream/);
});

test('rule 1 — the systemd driver enables, stops and restarts guestflow@<slug> through the configured command', async () => {
  const { exec, calls } = recordingExec({
    'systemctl show guestflow@aulnes.service': 'LoadState=loaded\nActiveState=active\nUnitFileState=enabled\nMemoryCurrent=104857600\nMemoryMax=536870912\n',
  });
  const d = createSystemdProcessDriver({ exec, releasesDir: '/srv/guestflow/releases', systemctl: 'sudo -n /usr/local/sbin/guestflow-systemctl' });
  await d.enableNow(inst());
  await d.restart(inst());
  await d.disableNow(inst());
  await d.remove(inst(), { keepIdentity: true });
  await d.remove(inst());
  assert.deepEqual(calls, [
    'sudo -n /usr/local/sbin/guestflow-instance-identity ensure aulnes c12',
    'sudo -n /usr/local/sbin/guestflow-systemctl enable --now guestflow@aulnes.service',
    'sudo -n /usr/local/sbin/guestflow-systemctl reset-failed guestflow@aulnes.service',
    'sudo -n /usr/local/sbin/guestflow-systemctl restart guestflow@aulnes.service',
    'sudo -n /usr/local/sbin/guestflow-systemctl disable --now guestflow@aulnes.service',
    'sudo -n /usr/local/sbin/guestflow-systemctl disable --now guestflow@aulnes.service',
    'sudo -n /usr/local/sbin/guestflow-systemctl reset-failed guestflow@aulnes.service',
    'sudo -n /usr/local/sbin/guestflow-instance-identity forget aulnes c12',
    'sudo -n /usr/local/sbin/guestflow-systemctl disable --now guestflow@aulnes.service',
    'sudo -n /usr/local/sbin/guestflow-systemctl reset-failed guestflow@aulnes.service',
    'sudo -n /usr/local/sbin/guestflow-instance-identity remove aulnes c12',
  ], 'a rename keeps the instance’s user; an erasure removes it');
  assert.equal(await d.state(inst()), 'running');
  assert.deepEqual(await d.memory(inst()), { current: 104857600, max: 536870912 });
  assert.equal(stateOf(parseShow('LoadState=not-found\nActiveState=inactive')), 'absent');
  assert.equal(stateOf(parseShow('LoadState=loaded\nActiveState=inactive\nUnitFileState=enabled')), 'failed');
  assert.equal(stateOf(parseShow('LoadState=loaded\nActiveState=inactive\nUnitFileState=disabled')), 'stopped');
});

test('rule 1 — the root wrapper accepts only the instance units', () => {
  const { spawnSync } = require('child_process');
  const wrapper = path.join(DEPLOY, 'guestflow-systemctl');
  // Every allowed call ends in `exec /usr/bin/systemctl`; a refused one exits 64 before.
  for (const args of [['enable', '--now', 'nginx.service'], ['stop', 'guestflow@a.service ssh.service'], ['restart', 'guestflow@../x.service'], ['kill', 'guestflow@aulnes.service'], ['enable', '--now', 'guestflow@aulnes.service', 'ssh.service']]) {
    const res = spawnSync('bash', [wrapper, ...args], { encoding: 'utf8' });
    assert.equal(res.status, 64, args.join(' '));
  }
  assert.match(fs.readFileSync(path.join(DEPLOY, 'guestflow.sudoers'), 'utf8'), /^guestflow ALL=\(root\) NOPASSWD: \/usr\/local\/sbin\/guestflow-systemctl, \/usr\/local\/sbin\/guestflow-litestream-apply, \/usr\/local\/sbin\/guestflow-instance-identity$/m);
  assert.equal(spawnSync('bash', [wrapper, 'restart', 'litestream'], { encoding: 'utf8' }).status, 64, 'Litestream restarts only through its own wrapper');
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
  const envFile = path.join(dir, 'aulnes.env');
  writeEnv(envFile, { GUESTFLOW_PROXY_SECRET: 'xyz' });
  await d.writeSite(inst({ envFile }));
  assert.match(fs.readFileSync(path.join(dir, 'aulnes.caddy'), 'utf8'), /reverse_proxy 127\.0\.0\.1:4407 \{\n\t\theader_up X-Guestflow-Proxy xyz\n\t\}/, 'rule 21: the secret header');
  assert.equal(fs.statSync(path.join(dir, 'aulnes.caddy')).mode & 0o777, 0o640);
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

test('rule 12 — Litestream: the console hands target and databases to the root wrapper; listings and restores use a one-database config with the keys in the environment', async () => {
  const calls = [];
  const configs = [];
  const tmpDir = tmp();
  const exec = async (file, args, opts = {}) => {
    calls.push([file, ...args].join(' '));
    const i = args.indexOf('-config');
    if (i >= 0) configs.push({ text: fs.readFileSync(args[i + 1], 'utf8'), mode: fs.statSync(args[i + 1]).mode & 0o777, env: opts.env });
    return { stdout: '' };
  };
  const replicas = [inst(), inst({ customerId: 14, key: 'c14', slug: 'moulin', dbPath: '/srv/guestflow/instances/moulin/data/guestflow.db' })];
  const d = createLitestreamBackupDriver({
    exec, listReplicas: () => replicas.slice(0, 1), tmpDir,
    url: 's3://bucket/fleet/', endpoint: 'https://s3.fr-par.scw.cloud', region: 'fr-par', rcloneRemote: 'guestflow-backup:bucket/fleet',
    credentials: { LITESTREAM_ACCESS_KEY_ID: 'AK', LITESTREAM_SECRET_ACCESS_KEY: 'SK' },
  });
  await d.addReplica(replicas[1]);
  await d.removeReplica(replicas[0]);
  await d.syncUploads(replicas[0]);
  await d.purge(replicas[0]);
  await d.restore(replicas[0], { at: '2026-10-07T08:30:00.000Z', output: '/tmp/x.db' });
  const apply = 'sudo -n /usr/local/sbin/guestflow-litestream-apply --url s3://bucket/fleet/ --endpoint https://s3.fr-par.scw.cloud --region fr-par';
  assert.equal(calls[0], `${apply} c12=/srv/guestflow/instances/aulnes/data/guestflow.db c14=/srv/guestflow/instances/moulin/data/guestflow.db`);
  assert.equal(calls[1], apply);
  assert.equal(calls[2], 'rclone sync /srv/guestflow/instances/aulnes/uploads guestflow-backup:bucket/fleet/c12/uploads');
  assert.equal(calls[3], 'rclone sync /srv/guestflow/instances/aulnes/private-documents guestflow-backup:bucket/fleet/c12/private-documents');
  assert.equal(calls[4], 'rclone purge guestflow-backup:bucket/fleet/c12');
  assert.match(calls[5], /^litestream restore -config \S+litestream-c12-[0-9a-f]+\.yml -o \/tmp\/x\.db -timestamp 2026-10-07T08:30:00\.000Z \/srv\/guestflow\/instances\/aulnes\/data\/guestflow\.db$/);
  // Litestream 0.3 ignores a query in a replica URL: endpoint and region are in the file.
  assert.equal(configs[0].text, 'dbs:\n  - path: /srv/guestflow/instances/aulnes/data/guestflow.db\n    replicas:\n      - type: s3\n        url: s3://bucket/fleet/c12/db\n        endpoint: https://s3.fr-par.scw.cloud\n        force-path-style: true\n        region: fr-par\n');
  assert.equal(configs[0].mode, 0o600);
  assert.equal(configs[0].env.LITESTREAM_ACCESS_KEY_ID, 'AK', 'the keys travel in the environment');
  assert.ok(!configs[0].text.includes('SK') && !calls.join(' ').includes('SK'), 'never in a file nor on a command line');
  assert.deepEqual(fs.readdirSync(tmpDir), [], 'the config is removed after the call');
});

test('rule 21 — the root wrapper writes Litestream’s configuration from checked entries only', () => {
  const { spawnSync } = require('child_process');
  const wrapper = path.join(DEPLOY, 'guestflow-litestream-apply');
  const target = ['--url', 's3://gf-backups/fleet', '--endpoint', 'https://s3.fr-par.scw.cloud', '--region', 'fr-par'];
  const run = (args, t = target) => spawnSync('bash', [wrapper, '--dry-run', ...t, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  const ok = run(['c12=/srv/guestflow/instances/aulnes/data/guestflow.db', 'c14=/srv/guestflow/instances/moulin/data/guestflow.db']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /- path: \/srv\/guestflow\/instances\/aulnes\/data\/guestflow\.db\n {4}replicas:\n {6}- type: s3\n {8}url: s3:\/\/gf-backups\/fleet\/c12\/db\n {8}endpoint: https:\/\/s3\.fr-par\.scw\.cloud\n {8}force-path-style: true\n {8}region: fr-par\n {8}retention: 720h\n {8}snapshot-interval: 24h/);
  assert.doesNotMatch(ok.stdout, /exec/);
  assert.match(run([]).stdout, /dbs: \[\]/);
  for (const bad of ['c1=/etc/passwd', 'c1=/srv/guestflow/console/data/control-plane.db', 'c1=/srv/guestflow/instances/../x/data/guestflow.db',
    'exec=/srv/guestflow/instances/aulnes/data/guestflow.db', 'c1=/srv/guestflow/instances/aulnes/data/guestflow.db\nexec: sh']) {
    assert.equal(run([bad]).status, 64, bad);
  }
  assert.equal(run(['c1=/srv/guestflow/instances/aulnes/data/guestflow.db', 'c1=/srv/guestflow/instances/moulin/data/guestflow.db']).status, 64, 'one entry per key');
  assert.equal(run(['c1=/srv/guestflow/instances/aulnes/data/guestflow.db', 'c2=/srv/guestflow/instances/aulnes/data/guestflow.db']).status, 64, 'one entry per database');
  assert.equal(run(['c1=/srv/guestflow/instances/aulnes/data/guestflow.db'], ['--url', 's3://gf-backups/fleet', '--endpoint', '-', '--region', 'fr par; exec: x']).status, 65, 'the target is checked too');
  assert.equal(run(['c1=/srv/guestflow/instances/aulnes/data/guestflow.db'], ['--url', 'file:///etc', '--endpoint', '-', '--region', '-']).status, 65);
});

test('rule 21 — each instance gets its own user, keyed on the customer; the wrapper refuses anything else', () => {
  const { spawnSync } = require('child_process');
  const wrapper = path.join(DEPLOY, 'guestflow-instance-identity');
  const run = (...args) => spawnSync('bash', [wrapper, '--dry-run', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  const ok = run('ensure', 'aulnes', 'c12');
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /useradd --system --no-create-home --home-dir \/nonexistent --shell \/usr\/sbin\/nologin --gid guestflow-app gf-c12/);
  assert.match(ok.stdout, /guestflow@aulnes\.service\.d\/identity\.conf: User=gf-c12 Group=guestflow-app/);
  assert.match(run('forget', 'aulnes', 'c12').stdout, /^rm -rf \/etc\/systemd\/system\/guestflow@aulnes\.service\.d$/m);
  for (const bad of [['ensure', '../x', 'c12'], ['ensure', 'aulnes', '12'], ['ensure', 'aulnes', 'c12;id'], ['useradd', 'aulnes', 'c12'], ['ensure', 'aulnes']]) {
    assert.equal(run(...bad).status, 64, bad.join(' '));
  }
  const unit = fs.readFileSync(path.join(DEPLOY, 'guestflow@.service'), 'utf8');
  assert.match(unit, /^User=nobody$/m, 'without its drop-in the unit fails closed');
});

test('rule 15 — the last replicated moment and the window come from `litestream generations`', async () => {
  const out = 'name  generation        lag   start                 end\ns3    a1b2c3d4e5f6a7b8  1s    2026-09-08T00:00:00Z  2026-10-08T09:59:58Z\ns3    0f0e0d0c0b0a0908  0s    2026-09-01T00:00:00Z  2026-09-08T00:00:00Z\n';
  assert.deepEqual(parseGenerations(out).length, 2);
  const { exec } = recordingExec({ 'litestream generations': out });
  const d = createLitestreamBackupDriver({ exec, listReplicas: () => [], url: 's3://b', rcloneRemote: 'r:b' });
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
  writeEnv(path.join(dir, 'envs', 'aulnes'), vars);
  assert.equal(fs.statSync(path.join(dir, 'envs', 'aulnes')).mode & 0o777, 0o600);
  assert.deepEqual(readEnv(path.join(dir, 'envs', 'aulnes')).GUESTFLOW_SESSION_SECRET, 's"x');
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

test('rule 1 — two customers created together: Caddy reloads one after the other, Litestream keeps both', async () => {
  const dir = tmp();
  let inFlight = 0;
  let overlap = false;
  const exec = async () => {
    inFlight += 1;
    if (inFlight > 1) overlap = true;
    await new Promise((r) => setTimeout(r, 15));
    inFlight -= 1;
    return { stdout: '' };
  };
  const caddy = createCaddyProxyDriver({ exec, domain: 'guestflow.fr', sitesDir: dir });
  await Promise.all([caddy.writeSite(inst()), caddy.writeSite(inst({ slug: 'moulin', port: 4408 }))]);
  assert.equal(overlap, false, 'never two reloads at once');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['aulnes.caddy', 'moulin.caddy']);

  const applied = [];
  const listed = [];
  const lexec = async (file, args) => { applied.push(args.filter((a) => /^c\d+=/.test(a))); await new Promise((r) => setTimeout(r, 10)); return { stdout: '' }; };
  const ls = createLitestreamBackupDriver({ exec: lexec, listReplicas: () => [...listed], url: 's3://b/x', rcloneRemote: 'r:b' });
  const a = inst();
  const b = inst({ customerId: 14, key: 'c14', slug: 'moulin', dbPath: '/srv/guestflow/instances/moulin/data/guestflow.db' });
  listed.push(a, b);
  await Promise.all([ls.addReplica(a), ls.addReplica(b)]);
  assert.equal(applied.at(-1).length, 2, 'the last configuration lists both');
});

test('property documents are synced beside the uploads; a customer who never added one is not an error', async () => {
  const calls = [];
  const exec = async (file, args) => {
    calls.push([file, ...args].join(' '));
    if (args[0] === 'sync' && /private-documents/.test(args[1]) && calls.length === 4) {
      const err = new Error('failed'); err.stderr = 'Failed to sync: directory not found'; throw err;
    }
    return { stdout: '' };
  };
  const d = createLitestreamBackupDriver({
    exec, listReplicas: () => [], tmpDir: tmp(), url: 's3://bucket/fleet/', endpoint: 'https://e', region: 'fr-par', rcloneRemote: 'gf:bucket/fleet',
    credentials: { LITESTREAM_ACCESS_KEY_ID: 'AK', LITESTREAM_SECRET_ACCESS_KEY: 'SK' },
  });
  await d.syncUploads(inst());
  await d.syncUploads(inst());
  assert.deepEqual(calls.filter((c) => /private-documents/.test(c)).length, 2);
  const failing = createLitestreamBackupDriver({
    exec: async () => { const err = new Error('boom'); err.stderr = 'access denied'; throw err; },
    listReplicas: () => [], tmpDir: tmp(), url: 's3://b/f/', endpoint: 'https://e', region: 'r', rcloneRemote: 'gf:b/f', credentials: {},
  });
  await assert.rejects(failing.syncUploads(inst()), /boom|denied/);
});

test('the local backup copies the property documents with the uploads', async () => {
  const dir = tmp();
  const i = inst({ dir: path.join(dir, 'aulnes'), dbPath: path.join(dir, 'aulnes', 'data', 'guestflow.db') });
  const d = createLocalBackupDriver({ dir: path.join(dir, 'backups'), now: () => new Date('2026-10-08T08:00:00Z'), intervalMs: 600000 });
  fs.mkdirSync(path.join(dir, 'aulnes', 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'aulnes', 'uploads', 'logo.png'), 'png');
  await d.syncUploads(i);
  const find = (name) => fs.readdirSync(path.join(dir, 'backups'), { recursive: true }).filter((f) => String(f).endsWith(name));
  assert.equal(find('logo.png').length, 1);
  assert.equal(find('contrat.pdf').length, 0, 'no folder, no error');
  fs.mkdirSync(path.join(dir, 'aulnes', 'private-documents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'aulnes', 'private-documents', 'contrat.pdf'), 'pdf');
  await d.syncUploads(i);
  assert.equal(find('contrat.pdf').length, 1);
  assert.ok(find('contrat.pdf')[0].includes('private-documents'));
});
