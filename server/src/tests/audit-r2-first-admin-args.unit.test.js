// specs/control-plane-plans-and-access.md rule 42 (audit R2, finding N4) — `create-first-admin.js` reads its
// arguments strictly: a value that looks like a flag is refused, never taken for the flag.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'create-first-admin.js');

function run(args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-first-admin-args-'));
  const dbPath = path.join(dir, 'guestflow.db');
  try {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, DB_PATH: dbPath }, encoding: 'utf8' });
    return { ...r, dbCreated: fs.existsSync(dbPath) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('rule 42: --name --probe and --name --reissue are refused and touch no database', () => {
  for (const args of [['--email', 'a@b.fr', '--name', '--probe'], ['--email', 'a@b.fr', '--name', '--reissue', '--company', 'x']]) {
    const r = run(args);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /Arguments refusés/);
    assert.equal(r.dbCreated, false);
  }
});

test('rule 42: an unknown flag is refused, and the control plane call (empty name, JSON establishment) still works', () => {
  assert.equal(run(['--email', 'a@b.fr', '--bogus', 'x']).status, 2);
  const r = run(['--email', 'a@b.fr', '--name', '', '--company', 'Les Aulnes', '--establishment', JSON.stringify({ name: 'Les Aulnes' }), '--reissue', 'unused']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout.trim().split('\n').pop()).created, true);
});
