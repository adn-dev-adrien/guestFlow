// specs/migrations-baseline.md rule 4 — a clean upgrade boots without « [schema] baseline applique partiellement »
// (shadow trial of 4.0.0 on a 3.21.0 database: `no such column: provider`, payment_links being older than the
// baseline's index on its provider columns). The boot adds those columns before the baseline pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

test('a payment_links table of the previous release does not make the baseline partial', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-upgrade-'));
  const file = path.join(dir, 'guestflow.db');
  try {
    const old = new Database(file);
    old.exec(`CREATE TABLE payment_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, type TEXT NOT NULL,
      qontoPaymentLinkId TEXT, url TEXT, amountCents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'EUR',
      status TEXT NOT NULL DEFAULT 'open', qontoPaymentId TEXT, createdAt TEXT DEFAULT (datetime('now')), paidAt TEXT)`);
    old.prepare("INSERT INTO payment_links (reservationId, type, qontoPaymentLinkId, url, amountCents) VALUES (1, 'full', 'pl_old', 'https://pay.example.test/x', 1000)").run();
    old.close();

    const out = spawnSync(process.execPath, ['-e', "require('./src/database'); process.exit(0)"], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, DB_PATH: file, NODE_ENV: 'test' },
      encoding: 'utf8',
    });
    const log = `${out.stdout}\n${out.stderr}`;
    assert.equal(out.status, 0, log);
    assert.ok(!/baseline applique partiellement/.test(log), log);

    const after = new Database(file, { readonly: true });
    const row = after.prepare('SELECT provider, providerLinkId FROM payment_links').get();
    after.close();
    assert.deepEqual({ ...row }, { provider: 'qonto', providerLinkId: 'pl_old' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
