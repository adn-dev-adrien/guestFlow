#!/usr/bin/env node
/**
 * Creates the first administrator of a hosted instance — run by the control plane at onboarding
 * (specs/control-plane-plans-and-access.md rule 7), with `DB_PATH` pointing at that instance's
 * database:
 *
 *   DB_PATH=/srv/guestflow/<slug>/data/guestflow.db node scripts/create-first-admin.js --email a@b.fr --name "Claire Martin"
 *
 * Prints one JSON line on stdout, `{ "created": true, "temporaryPassword": "…" }`, which the control
 * plane emails to the customer. The password is never logged anywhere else.
 *
 * Optional (specs/hosting-h1-fleet-runtime.md rules 24–25):
 *   --company "<name>"            the user's company, shown by the instance as the account's company
 *   --establishment '<json>'      { name, email, address, phone, tva } — fills the empty fields of the
 *                                 establishment (`seeded` lists the columns written)
 *   --reissue unused|always       an existing account gets a new provisional password: `unused` only
 *                                 when nobody ever signed in to it, `always` in any case (and its
 *                                 second step is turned off)
 *
 * Opening the database runs this code's migrations. So on an existing database the script first
 * replays them on a copy, and refuses when they would change anything: a script of another version
 * than the instance must never move the customer's schema ahead of (or behind) the code that runs it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

function schemaOf(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const hasMigrations = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'migrations'").get();
    return {
      objects: db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all(),
      migrations: hasMigrations ? db.prepare('SELECT name FROM migrations ORDER BY name').all().map((r) => r.name) : [],
    };
  } finally {
    db.close();
  }
}

// → null when this code's migrations leave the database as it is, else what they would change.
function pendingChanges(dbPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-first-admin-probe-'));
  try {
    const copy = path.join(dir, 'probe.db');
    const src = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      src.prepare('VACUUM INTO ?').run(copy);
    } finally {
      src.close();
    }
    const before = schemaOf(copy);
    const probe = spawnSync(process.execPath, [__filename, '--probe'], {
      env: { ...process.env, DB_PATH: copy }, encoding: 'utf8', timeout: 60000,
    });
    if (probe.status !== 0) throw new Error(`migration probe failed: ${String(probe.stderr).trim().split('\n').pop()}`);
    const after = schemaOf(copy);
    const added = after.migrations.filter((m) => !before.migrations.includes(m));
    const changed = JSON.stringify(after.objects) !== JSON.stringify(before.objects);
    return added.length || changed ? { added, changed } : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const email = arg('email');
if (!process.argv.includes('--probe') && (!email || !process.env.DB_PATH)) {
  console.error('usage: DB_PATH=… node scripts/create-first-admin.js --email <email> [--name <name>]');
  process.exit(2);
}

if (process.argv.includes('--probe')) {
  require('../src/database');
  process.exit(0);
}

try {
  if (fs.existsSync(process.env.DB_PATH)) {
    const pending = pendingChanges(process.env.DB_PATH);
    if (pending) {
      console.error(`Base de l’instance d’une autre version (${pending.added.length} migration(s)${pending.changed ? ', schéma différent' : ''}) : lancer le script de sa version.`);
      process.exit(3);
    }
  }
  require('../src/database');
  const usersModel = require('../src/models/usersModel');
  const settingsModel = require('../src/models/settingsModel');
  const twoFactorModel = require('../src/models/twoFactorModel').default;
  const { generateTemporaryPassword } = require('../src/utils/passwordGenerator');
  const { createFirstAdmin, seedEstablishment } = require('../src/utils/firstAdmin');
  let establishment = null;
  if (arg('establishment')) {
    try {
      establishment = JSON.parse(arg('establishment'));
    } catch {
      console.error('--establishment : JSON illisible.');
      process.exit(2);
    }
  }
  const result = createFirstAdmin({
    usersModel, twoFactorModel, generatePassword: () => generateTemporaryPassword(), email, name: arg('name'),
    companyName: arg('company') || '', reissue: arg('reissue') || 'never',
  });
  const seeded = establishment ? seedEstablishment({ settingsModel, establishment }) : [];
  process.stdout.write(`${JSON.stringify(establishment ? { ...result, seeded } : result)}\n`);
  process.exit(0);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
