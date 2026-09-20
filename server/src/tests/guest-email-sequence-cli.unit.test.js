// specs/guest-email-sequence.md §3.6 — the simulation CLI, run for real against a database file.
// It exists to be pointed at a COPY OF PRODUCTION before automatic sending is turned on, so the one
// thing it must never do is write: the test checks the target byte for byte around the run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const { applyGuestEmailSequenceSchema } = require('../utils/guestEmailSequenceSchema');

const CLI = path.join(__dirname, '..', '..', '..', 'scripts', 'simulate-guest-email-sequence.mjs');
const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

/** A database file that looks like a copy of production: a past stay, sending not yet activated. */
function targetDatabase() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-sequence-cli-')), 'copy.db');
  const db = new Database(file);
  db.exec(SCHEMA);
  applyGuestEmailSequenceSchema(db);
  db.prepare("INSERT INTO properties (id, name, nameArticle) VALUES (1, 'La Granja', 'à')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Camille', 'Martin', 'camille@example.fr')").run();
  db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, createdAt, platform, adults, finalPrice)
              VALUES ('reservation', 1, 1, '2027-07-10', '2027-07-17', '2027-03-02 10:00:00', 'direct', 2, 1240)`).run();
  db.close();
  return file;
}

const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const run = (file, args, env = {}) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8',
  env: { ...process.env, SIMULATION_DB_PATH: file, ...env },
});

// rule 32 — the target is opened read-only, and GuestFlow's own DB_PATH is forced in memory before
// any module loads: even handed the target as DB_PATH, no migration can reach it.
test('the CLI never writes a byte to the database it reads', () => {
  const file = targetDatabase();
  const before = digest(file);

  const result = run(file, ['--from', '2027-07-01', '--to', '2027-07-20', '--json'], { DB_PATH: file });

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(report.rows.length > 0, 'the past stay produces rows');
  assert.equal(digest(file), before, 'the target database is untouched');
  for (const sidecar of ['-wal', '-shm', '-journal']) {
    assert.equal(fs.existsSync(file + sidecar), false, `no ${sidecar} left behind`);
  }
});

// rule 32 — the target is named explicitly or nothing runs: no default that could hit production.
test('without SIMULATION_DB_PATH the CLI refuses to run', () => {
  const result = run('', [], { SIMULATION_DB_PATH: '' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /SIMULATION_DB_PATH/);
});
