// specs/hosting/self-update-and-releases.md rules 30b, 31, 57 (end-review verification V-3) — T10 and the schema floor
// (specs/pricing/pricing-components.md rule 85) run once the update helper has VERIFIED 4.2.0 (health + version), not when 4.2.0's own boot writes
// `done` itself. Three paths, the
// helper's status writes being the helper's own `write_status` (server/scripts/apply-update.sh), run by bash:
//   - a fresh install (no update in progress): T10 and the floor at boot;
//   - a verified update: the boot's own `done` waits, the helper's `done` runs T10;
//   - an update the helper rolls back after a failed health check: T10 never runs, the previous release's arrival-SAS upsert still works.
// A helper that died (only the boot's `done` left) ends the wait once its window has passed.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runPricingSalesMigration, runTrueLinesWhenVerified } = require('../utils/pricingSalesMigration');
const { awaitingVerification, HELPER_WINDOW_MS } = require('../utils/updateVerification');
const { readSchemaFloor } = require('../utils/schemaFloor');
const { createUpdateStateModel } = require('../models/updateStateModel');
const { resolvePaths } = require('../utils/deploymentPaths');
const { oldDatabase, seed } = require('./pricingSalesFixtures');

const HELPER = path.join(__dirname, '..', '..', 'scripts', 'apply-update.sh');
// v4.1.0 `models/reservationsModel.js` (writeSoldOptions, the arrival SAS): it needs the article key T10 removes.
const OLD_ARRIVAL_UPSERT = `INSERT INTO reservation_options (reservationId, optionId, quantity) VALUES (10, 2, 1)
  ON CONFLICT(reservationId, optionId) DO UPDATE SET quantity = excluded.quantity`;

function bootedDatabase({ deferTrueLines }) {
  const db = oldDatabase();
  seed(db);
  db.exec('ALTER TABLE reservation_custom_options ADD COLUMN sasLineKey TEXT');
  runPricingSalesMigration(db, { deferTrueLines });
  return db;
}

function updateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-v3-'));
  fs.mkdirSync(path.join(dir, 'data'));
  return { dir, model: createUpdateStateModel(resolvePaths({ DB_PATH: path.join(dir, 'data', 'guestflow.db') })) };
}

// The helper's own status write: its `write_status` function, cut out of the shipped script and run by bash with the helper's variables.
function helperWrites(model, phase, errorCode = '') {
  const script = fs.readFileSync(HELPER, 'utf8');
  const body = script.slice(script.indexOf('now_iso()'), script.indexOf('running_version()'));
  execFileSync('bash', ['-c', `${body}\nwrite_status "$1" "$2"`, 'helper', phase, errorCode], {
    env: { ...process.env, STATUS_FILE: model.paths.statusFile, FROM_VERSION: '4.1.0', TARGET: '4.2.0', STARTED_AT: '2026-11-20T09:00:00Z', LOG_FILE: '/dev/null' }, // date-literal-ok — a status-file timestamp handed to a child process
  });
}

const gate = (model, now) => () => awaitingVerification({ status: model.readStatus(), version: '4.2.0', now });
const ranT10 = (db) => readSchemaFloor(db) === '4.2.0';

test('V-3 — a fresh install (no update in progress): T10 and the floor at boot', () => {
  const { dir, model } = updateDir();
  try {
    assert.equal(model.readStatus().phase, 'idle');
    const db = bootedDatabase({ deferTrueLines: gate(model)() });
    assert.equal(ranT10(db), true);
    assert.throws(() => db.prepare(OLD_ARRIVAL_UPSERT).run(), /ON CONFLICT clause/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('V-3 — a verified update: the boot\'s own `done` waits; the helper\'s `done` runs T10 and raises the floor', () => {
  const { dir, model } = updateDir();
  try {
    helperWrites(model, 'swapping');
    helperWrites(model, 'restarting');
    const db = bootedDatabase({ deferTrueLines: gate(model)() });
    assert.equal(ranT10(db), false, 'deferred while the swap is in flight');
    model.reconcileOnBoot('4.2.0');
    assert.equal(model.readStatus().phase, 'done', 'rule 30b: the boot concludes the swap');
    assert.deepEqual(runTrueLinesWhenVerified(db, { awaiting: gate(model) }), { state: 'awaiting' }, 'the boot\'s verdict is not the helper\'s');
    assert.doesNotThrow(() => db.prepare(OLD_ARRIVAL_UPSERT).run());
    helperWrites(model, 'done');
    assert.deepEqual(runTrueLinesWhenVerified(db, { awaiting: gate(model) }), { state: 'ran', tables: 2 });
    assert.equal(ranT10(db), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('V-3 — the helper rolls back after a failed health check: T10 never runs, 4.1.0\'s upsert still works', () => {
  const { dir, model } = updateDir();
  try {
    helperWrites(model, 'swapping');
    helperWrites(model, 'restarting');
    const db = bootedDatabase({ deferTrueLines: gate(model)() });
    model.reconcileOnBoot('4.2.0');
    assert.deepEqual(runTrueLinesWhenVerified(db, { awaiting: gate(model) }), { state: 'awaiting' });
    helperWrites(model, 'swapping', 'HEALTHCHECK_TIMEOUT');
    assert.deepEqual(runTrueLinesWhenVerified(db, { awaiting: gate(model, Date.now() + HELPER_WINDOW_MS * 2) }), { state: 'awaiting' }, 'a rollback under way never runs it');
    helperWrites(model, 'rolled_back', 'HEALTHCHECK_TIMEOUT');
    assert.equal(ranT10(db), false);
    assert.doesNotThrow(() => db.prepare(OLD_ARRIVAL_UPSERT).run(), 'the previous release runs on this database');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('V-3 — a helper that died: the boot\'s `done` ends the wait once the helper\'s window has passed', () => {
  const { dir, model } = updateDir();
  try {
    helperWrites(model, 'restarting');
    const db = bootedDatabase({ deferTrueLines: gate(model)() });
    model.reconcileOnBoot('4.2.0');
    const concludedAt = Date.parse(model.readStatus().updatedAt);
    assert.deepEqual(runTrueLinesWhenVerified(db, { awaiting: gate(model, concludedAt + HELPER_WINDOW_MS - 1000) }), { state: 'awaiting' });
    assert.deepEqual(runTrueLinesWhenVerified(db, { awaiting: gate(model, concludedAt + HELPER_WINDOW_MS + 1000) }), { state: 'ran', tables: 2 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
