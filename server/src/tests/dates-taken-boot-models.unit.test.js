// specs/payment-link-lifecycle.md rules 12, 61 (review of #907, B1) — the one-shots that withdraw links at boot (the
// upgrade's dates-taken migration, a duplicate set aside) run while database.js is still being evaluated. They must
// load no model: a model required then keeps the half-built database module for the life of the process, and the
// first boot after the install served 500s on /api/reservations. Booted in a child process on a real file.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { localIsoDate } = require('../utils/localDate');

const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return localIsoDate(d); };
const ROOT = path.join(__dirname, '..', '..');

function boot(file, probe) {
  const run = spawnSync(process.execPath, ['--trace-warnings', '-e', probe], { cwd: ROOT, env: { ...process.env, DB_PATH: file, SKIP_MIGRATIONS: '' }, encoding: 'utf8' });
  const line = String(run.stdout || '').trim().split('\n').pop();
  return { out: line && line.startsWith('{') ? JSON.parse(line) : null, stderr: String(run.stderr || ''), status: run.status };
}

test('rules 12, 61: boot one-shots withdrawing links leave every model working', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-boot-'));
  const file = path.join(dir, 'boot.db');
  assert.equal(boot(file, "require('./src/database'); console.log('{}'); process.exit(0);").status, 0);

  const db = new Database(file);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Logement')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Lina', 'Exemple')").run();
  const add = (kind, platform, start, end) => Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, platform, adults, finalPrice)
    VALUES (?, 1, 1, ?, ?, ?, 2, 300)`).run(kind, start, end, platform).lastInsertRowid);
  add('reservation', 'Booking', inDays(40), inDays(43));
  const devisId = add('devis', 'direct', inDays(41), inDays(44));
  const link = (reservationId) => Number(db.prepare(`INSERT INTO payment_links (reservationId, type, amountCents, provider, providerLinkId, url, status)
    VALUES (?, 'deposit', 9000, 'qonto', ?, 'https://pay.example.test/b1', 'open')`).run(reservationId, `pl_b1_${reservationId}`).lastInsertRowid);
  const takenLink = link(devisId);
  // A copy the old « platform disabled » filter hid, holding an open link, sitting on a visible stay.
  db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, isActive, disabled) VALUES (1, 'Lodgify', '', 'lodgify', 'Lodgify', 0, 1)").run();
  add('reservation', 'direct', inDays(60), inDays(64));
  const copy = add('reservation', 'Lodgify', inDays(61), inDays(63));
  const copyLink = link(copy);
  db.prepare("DELETE FROM migrations WHERE name IN ('dates_taken_links_withdrawn_v1', 'calendar_parity_superseded_v1')").run();
  db.close();

  const { out, stderr } = boot(file, `
    const db = require('./src/database');
    const reservations = require('./src/models/reservationsModel');
    const links = require('./src/models/paymentLinksModel');
    console.log(JSON.stringify({
      row: Boolean(reservations.getRow(${devisId})),
      taken: links.findById(${takenLink}).cancelReason,
      copy: links.findById(${copyLink}).cancelReason,
      list: Array.isArray(reservations.list ? reservations.list({}) : []),
    }));
    process.exit(0);`);
  assert.ok(out, stderr.slice(-2000));
  assert.deepEqual(out, { row: true, taken: 'dates-taken', copy: 'superseded', list: true });
  assert.doesNotMatch(stderr, /circular dependency/i);
});
