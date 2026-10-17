#!/usr/bin/env node
/**
 * The real-host scenarios of specs/hosting-h1-fleet-runtime.md, run INSIDE the throwaway host after
 * inside.sh bootstrapped it: everything goes through the console's HTTP API behind Caddy, and the
 * results are read on the host itself (systemd, /proc, the object storage). Prints one line per check
 * and exits non-zero when one fails.
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');

const CONSOLE = 'https://console.gf.test';
const SRC = '/srv/guestflow/console/src';
const results = [];
let cookie = '';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const shOk = (cmd) => spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function api(method, path, body) {
  const res = await fetch(`${CONSOLE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.message || ''}`);
  return data;
}

async function site(host, path = '/api/version') {
  const res = await fetch(`https://${host}${path}`, { redirect: 'manual' }).catch((e) => ({ status: 0, error: e }));
  if (!res.status) return { status: 0 };
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, text, json, location: res.headers.get('location') };
}

async function waitCustomer(id, timeoutMs = 180000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const c = await api('GET', `/api/customers/${id}`);
    if (!c.provisioningRunning || Date.now() > end) return c;
    await sleep(1000);
  }
}

async function waitUpdate(timeoutMs = 240000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await api('GET', '/api/fleet/versions');
    if (!v.running || Date.now() > end) return v.history[0];
    await sleep(1500);
  }
}

const customer = (slug, companyName) => ({
  companyName, contactName: 'Lab', contactEmail: `lab@${slug}.test`, slug, planCode: 'pro', billing: 'yearly', length: 12,
  startsAt: new Date().toISOString().slice(0, 10), trial: false, addons: [],
  billingStreet: '1 rue du Lab', billingPostcode: '07140', billingCity: 'Les Vans', billingCountry: 'FR',
});

const mainPid = (slug) => sh(`systemctl show -p MainPID --value guestflow@${slug}.service`);
const userOf = (pid) => sh(`ps -o user= -p ${pid}`);
const release = (v, extra = '') => sh(`sudo -u guestflow node ${SRC}/control-plane/server/scripts/dev-release.js /srv/guestflow/releases ${v} --copy-modules ${extra}`);
const sqlite = (db, sql) => sh(`sqlite3 ${db} "${sql}"`);

(async () => {
  // Login with the second factor read from the SMTP sink.
  await api('POST', '/api/auth/login', { email: 'ops@gf.test', password: 'lab-operator-pass!' });
  await sleep(1500);
  const code = sh("journalctl -u gf-smtp --no-pager -o cat | grep -oE '\\b[0-9]{6}\\b' | tail -n1");
  await api('POST', '/api/auth/verify', { code });
  check('console: login through Caddy with the emailed code', true);

  // 1. Two customers.
  const a = await api('POST', '/api/customers', customer('aulnes', 'Gîte des Aulnes'));
  const b = await api('POST', '/api/customers', customer('moulin', 'Le Moulin'));
  const ca = await waitCustomer(a.id);
  const cb = await waitCustomer(b.id);
  for (const c of [ca, cb]) {
    const bad = c.steps.filter((s) => s.status !== 'ok');
    check(`rule 1: ${c.slug} — ten steps ok`, !bad.length, bad.map((s) => `${s.step}: ${s.detail}`).join(' | '));
  }
  let va = await site('aulnes.gf.test');
  check('rule 1: aulnes answers through Caddy (TLS) on 9.0.0', va.json && va.json.version === '9.0.0', `${va.status} ${va.text && va.text.slice(0, 80)}`);
  const pa = mainPid('aulnes');
  const pb = mainPid('moulin');
  check('rule 21: one user per instance', userOf(pa) === `gf-c${a.id}` && userOf(pb) === `gf-c${b.id}`, `${userOf(pa)} / ${userOf(pb)}`);
  check('rule 21: Litestream runs as guestflow-backup', sh('ps -o user= -C litestream | head -n1') === 'guestflow-backup');
  check('rule 21: Caddy admin API is a 0660 socket of group caddy', sh('stat -c "%a %G" /run/caddy/admin.sock') === '660 caddy');
  check('B2: release files are group-readable, never group-writable', sh("find /srv/guestflow/releases/9.0.0 -type f -perm -g+w | wc -l") === '0'
    && sh("find /srv/guestflow/releases/9.0.0 -type f ! -perm -g+r | wc -l") === '0');
  check('B3: the database is 0660 in the instances group', sh(`stat -c '%a %G' /srv/guestflow/instances/aulnes/data/guestflow.db`) === '660 guestflow-app');
  check('M2: the env file is outside the instance directory', !fs.existsSync('/srv/guestflow/instances/aulnes/env') && sh('stat -c %a /srv/guestflow/envs/aulnes') === '600');

  // 2. Fleet update, then a forced rollback.
  release('9.1.0');
  await api('POST', '/api/fleet/updates', { targetVersion: '9.1.0' });
  let u = await waitUpdate();
  check('rule 10: fleet update to 9.1.0, one instance at a time', u.state === 'done' && u.items.every((i) => i.state === 'done'), JSON.stringify(u.items.map((i) => i.detail)));
  va = await site('aulnes.gf.test');
  check('rule 10: aulnes on 9.1.0 after the update', va.json && va.json.version === '9.1.0');
  release('9.2.0', '--broken');
  await api('POST', '/api/fleet/updates', { targetVersion: '9.2.0' });
  u = await waitUpdate();
  check('rule 10: a release that fails its health check is rolled back and stops the fleet update',
    u.state === 'failed' && u.items[0].state === 'rolled_back' && u.items.slice(1).every((i) => i.state === 'skipped'), `${u.error} | ${u.items.map((i) => i.state).join(',')}`);
  va = await site('aulnes.gf.test');
  const vb = await site('moulin.gf.test');
  check('rule 10: both instances still answer on 9.1.0', va.json && va.json.version === '9.1.0' && vb.json && vb.json.version === '9.1.0');

  // 3. Backups: replicated, listed by the console, restored at a date.
  const db = '/srv/guestflow/instances/aulnes/data/guestflow.db';
  sqlite(db, 'CREATE TABLE IF NOT EXISTS lab (x INTEGER); INSERT INTO lab VALUES (1);');
  await sleep(8000);
  const gens = sh(`set -a; . /etc/default/litestream; set +a; litestream generations -config /etc/litestream.yml ${db}`);
  check('rule 12: the replica of aulnes exists in the object storage', /s3\s+\w{16}/.test(gens), gens.split('\n')[1] || gens);
  const moment = new Date().toISOString();
  await sleep(2500);
  sqlite(db, 'INSERT INTO lab VALUES (2);');
  await sleep(4000);
  const w = await api('GET', `/api/customers/${a.id}/restore-window`);
  check('B1: the console lists the replica (restore window)', w.available === true, w.text);
  const r = await api('POST', `/api/customers/${a.id}/restore`, { at: moment });
  const rows = sqlite(db, 'SELECT COUNT(*) FROM lab;');
  check('rule 14: restore at a date brings back the moment', rows === '1', `${r.notice} rows=${rows}`);
  va = await site('aulnes.gf.test');
  check('rule 14: aulnes answers after the restore', va.json && va.json.version === '9.1.0');
  check('B3: the restored database is 0660 in the instances group', sh(`stat -c '%a %G' ${db}`) === '660 guestflow-app');

  // 4. Weekly verification (the scheduler's job, run now).
  const weekly = sh(`sudo -u guestflow bash -c 'set -a; . /srv/guestflow/console/env; set +a; cd ${SRC}/control-plane/server && node /hosting/test/weekly.js'`);
  const wk = JSON.parse(weekly.split('\n').pop());
  check('rule 13: weekly restore check of every replica', wk.length === 2 && wk.every((x) => x.ok), weekly.split('\n').pop());

  // 5. Probe: last backup on the fleet.
  await sleep(65000);
  const fleet = await api('GET', '/api/customers');
  const rowA = fleet.rows.find((x) => x.slug === 'aulnes');
  check('rule 15: the fleet shows version, process and last backup', rowA.version === '9.1.0' && rowA.process === 'En marche' && rowA.lastBackup, JSON.stringify({ v: rowA.version, p: rowA.process, b: rowA.lastBackup }));

  // 6. Isolation from inside aulnes.
  const ua = sh(`id -u gf-c${a.id}`);
  const ga = sh('getent group guestflow-app | cut -d: -f3');
  const pl = sh('pgrep -x litestream | head -n1');
  const inA = (cmd) => shOk(`nsenter --target ${pa} --mount --setuid ${ua} --setgid ${ga} -- sh -c '${cmd}' 2>&1`);
  check('rule 21: A reads its own database', inA('test -r /srv/guestflow/instances/aulnes/data/guestflow.db').status === 0);
  check('rule 21: A does not see B’s directory', inA('ls /srv/guestflow/instances').stdout.trim() === 'aulnes', inA('ls /srv/guestflow/instances').stdout.trim());
  check('rule 21: A cannot read B’s database', inA('cat /srv/guestflow/instances/moulin/data/guestflow.db >/dev/null').status !== 0);
  check('rule 21: A cannot see B’s /proc nor its environ', inA(`test -e /proc/${pb} || cat /proc/${pb}/environ`).status !== 0);
  check('rule 21: A cannot read Litestream’s environ', inA(`cat /proc/${pl}/environ`).status !== 0);
  check('rule 21: A cannot read the console directory', inA('ls /srv/guestflow/console').status !== 0);
  check('M2: A cannot read any env file', inA('cat /srv/guestflow/envs/aulnes').status !== 0);
  check('B2: A cannot write a release', inA('touch /srv/guestflow/releases/9.1.0/x').status !== 0);
  check('rule 21: A cannot reach Caddy’s admin socket', inA('test -e /run/caddy/admin.sock').status !== 0);
  const spoof = shOk(`curl -s -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 203.0.113.9' -H 'X-Guestflow-Proxy: guess' http://127.0.0.1:$(sed -n 's/^PORT="\\?\\([0-9]*\\)"\\?/\\1/p' /srv/guestflow/envs/moulin)/api/version`);
  check('rule 21: a direct loopback call still answers (its X-Forwarded-* are dropped, unit-tested)', spoof.stdout === '200');

  // 7. Deprovision, reactivate, rename, erase.
  await api('POST', `/api/customers/${a.id}/deprovision`, { confirmSlug: 'aulnes' });
  va = await site('aulnes.gf.test', '/');
  check('rule 3: deprovisioned — the closed page', /Cet espace a été fermé/.test(va.text || ''), `${va.status}`);
  await api('POST', `/api/customers/${a.id}/reactivate`);
  va = await site('aulnes.gf.test');
  check('rule 4: reactivated — answers again', va.json && va.json.version === '9.1.0');
  const keys = ['wordpress', 'ical', 'oauth', 'publicUrl', 'push'];
  await api('POST', `/api/customers/${b.id}/rename`, { slug: 'les-moulin', checked: keys });
  const nb = await site('les-moulin.gf.test');
  const old = await site('moulin.gf.test');
  check('rule 5: renamed — new address answers, old one 301', nb.json && nb.json.version === '9.1.0' && old.status === 301 && /les-moulin\.gf\.test/.test(old.location || ''), `${nb.status} ${old.status} ${old.location}`);
  check('rule 21: the user survives the rename', userOf(mainPid('les-moulin')) === `gf-c${b.id}`);
  await api('POST', `/api/customers/${b.id}/deprovision`, { confirmSlug: 'les-moulin' });
  await api('POST', `/api/customers/${b.id}/erase`, { confirmSlug: 'les-moulin' });
  const gone = shOk(`id gf-c${b.id}`).status !== 0 && !fs.existsSync('/srv/guestflow/instances/les-moulin')
    && !fs.existsSync('/etc/systemd/system/guestflow@les-moulin.service.d') && !fs.existsSync('/srv/guestflow/envs/les-moulin');
  check('rule 6: erased — user, unit drop-in, env file and directory gone', gone);
  const left = shOk(`set -a; . /srv/guestflow/console/env; set +a; rclone lsf -R ${'gfbackup:gf-backups/fleet'}/c${b.id}`).stdout.trim();
  check('rule 6: erased — its copies purged from the object storage', left === '', left);

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('ABORT', err.message);
  process.exit(2);
});
