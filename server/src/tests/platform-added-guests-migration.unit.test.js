// specs/platform-added-guests-tourist-tax.md §5 and rules 19, 21 — the one-shot backfill, on a real boot of a
// seeded file: it runs once in production with no undo, and a wrong paid base bills every platform fiche.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');

function boot(file) {
  const run = spawnSync(process.execPath, ['-e', "require('./src/database'); process.exit(0);"], {
    cwd: ROOT, env: { ...process.env, DB_PATH: file, SKIP_MIGRATIONS: '' }, encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
}

const NEW_COLUMNS = ['platformPaidOccupants', 'touristTaxAddedGuestsAdults', 'touristTaxDeclaredWithAddedAmount'];
const FEATURE_COLUMNS = ['platformPaidAdults', 'touristTaxAddedGuestsAmount', 'touristTaxAddedGuestsDeclaredAt', ...NEW_COLUMNS];

function bootedFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-added-guests-mig-'));
  const file = path.join(dir, 'boot.db');
  boot(file);
  const db = new Database(file);
  db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (900, 'Lodge', 8)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (900, 'Test', 'Client')").run();
  return { db, file, dir };
}

let nextId = 9000;
function stay(db, row) {
  nextId += 1;
  const full = {
    id: nextId, propertyId: 900, clientId: 900, startDate: '2099-03-01', endDate: '2099-03-03', kind: 'reservation',
    children: 0, teens: 0, finalPrice: 500, touristTaxTotal: 7.2, ...row,
  };
  const keys = Object.keys(full);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => full[k]));
  return nextId;
}

function dropColumns(db, columns) {
  db.exec('DROP TRIGGER IF EXISTS reservations_clear_added_guests_declared');
  for (const column of columns) db.exec(`ALTER TABLE reservations DROP COLUMN ${column}`);
}

const read = (db, id) => db.prepare(`SELECT platformPaidGuests, platformPaidAdults, platformPaidOccupants, touristTaxAddedGuestsAmount,
  touristTaxAddedGuestsAdults, touristTaxDeclaredWithAddedAmount, finalPrice, touristTaxTotal FROM reservations WHERE id = ?`).get(id);

test('§5, rule 19: a boot from before the feature takes the current party as the paid base, and moves no amount', () => {
  const { db, file, dir } = bootedFile();
  const withBrut = stay(db, { platform: 'Canal', platformGrossAmount: 600, adults: 3, children: 1, teens: 1, platformPaidGuests: 7 });
  const childLeft = stay(db, { platform: 'Canal', platformGrossAmount: 600, adults: 2, children: 1, platformPaidGuests: 4 });
  const noBrut = stay(db, { platform: 'Canal', platformGrossAmount: null, adults: 3 });
  const direct = stay(db, { platform: 'direct', platformGrossAmount: 600, adults: 3 });
  const upperDirect = stay(db, { platform: 'Direct', platformGrossAmount: 600, adults: 3 });
  dropColumns(db, FEATURE_COLUMNS);
  db.close();

  boot(file);

  const after = new Database(file);
  assert.deepEqual(read(after, withBrut), {
    platformPaidGuests: 7, platformPaidAdults: 3, platformPaidOccupants: 5, touristTaxAddedGuestsAmount: 0,
    touristTaxAddedGuestsAdults: null, touristTaxDeclaredWithAddedAmount: null, finalPrice: 500, touristTaxTotal: 7.2,
  });
  assert.equal(read(after, childLeft).platformPaidOccupants, 3, 'the party, not the old head count');
  assert.equal(read(after, childLeft).platformPaidGuests, 4, 'the supplement keeps what the platform billed');
  for (const id of [noBrut, direct, upperDirect]) {
    assert.equal(read(after, id).platformPaidAdults, null);
    assert.equal(read(after, id).platformPaidOccupants, null);
  }
  after.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('§5, rules 19, 21: a boot from v3.21.0 keeps the base of a stay that already moved, so its stored tax stays', () => {
  const { db, file, dir } = bootedFile();
  const adultAdded = stay(db, {
    platform: 'Canal', platformGrossAmount: 600, adults: 3, platformPaidGuests: 2, platformPaidAdults: 2, touristTaxAddedGuestsAmount: 2.4,
  });
  const childRemoved = stay(db, {
    platform: 'Canal', platformGrossAmount: 600, adults: 2, children: 1, platformPaidGuests: 4, platformPaidAdults: 2, touristTaxAddedGuestsAmount: 8.04,
  });
  const adultLeft = stay(db, {
    platform: 'Canal', platformGrossAmount: 600, adults: 2, platformPaidGuests: 3, platformPaidAdults: 3,
  });
  const untouched = stay(db, {
    platform: 'Canal', platformGrossAmount: 600, adults: 2, children: 1, platformPaidGuests: 4, platformPaidAdults: 2,
  });
  const movedNoPersons = stay(db, {
    platform: 'Canal', platformGrossAmount: 600, adults: 3, children: 1, platformPaidGuests: null, platformPaidAdults: 2, touristTaxAddedGuestsAmount: 2.4,
  });
  dropColumns(db, NEW_COLUMNS);
  db.close();

  boot(file);

  const after = new Database(file);
  assert.equal(read(after, movedNoPersons).platformPaidOccupants, 4, 'moved, but no persons stored: the current party');
  assert.equal(read(after, adultAdded).platformPaidOccupants, 2);
  assert.equal(read(after, adultAdded).touristTaxAddedGuestsAdults, 1);
  assert.equal(read(after, adultAdded).touristTaxAddedGuestsAmount, 2.4);
  assert.equal(read(after, childRemoved).platformPaidOccupants, 4);
  assert.equal(read(after, childRemoved).touristTaxAddedGuestsAdults, 0, 'D12: a gap, nobody added');
  assert.equal(read(after, adultLeft).platformPaidOccupants, 3);
  assert.equal(read(after, untouched).platformPaidOccupants, 3, 'no tax stored yet: the party is the base, nothing to bill');
  assert.equal(read(after, untouched).touristTaxAddedGuestsAdults, null);
  after.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('§5: the backfill runs once, a second boot leaves a later party alone', () => {
  const { db, file, dir } = bootedFile();
  const id = stay(db, { platform: 'Canal', platformGrossAmount: 600, adults: 2, platformPaidGuests: 2 });
  dropColumns(db, FEATURE_COLUMNS);
  db.close();
  boot(file);
  const between = new Database(file);
  between.prepare('UPDATE reservations SET adults = 3 WHERE id = ?').run(id);
  between.close();

  boot(file);

  const after = new Database(file);
  assert.equal(read(after, id).platformPaidAdults, 2);
  assert.equal(read(after, id).platformPaidOccupants, 2);
  const trigger = after.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name = 'reservations_clear_added_guests_declared'").get();
  assert.equal(trigger.n, 1, 'and no trigger is doubled');
  after.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
