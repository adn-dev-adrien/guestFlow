// specs/hosting-h1-fleet-runtime.md rules 24 and 25 — on the instance side: the first-admin script
// gives a lost invitation a new provisional password (`--reissue`), fills the establishment with what
// the console knows (`--establishment`, `--company`) without ever overwriting what the customer typed,
// and the address the hosting writes (`GUESTFLOW_PUBLIC_URL`) is the instance's public URL whenever
// none is typed — which turns on « mot de passe oublié ».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');
const { createFirstAdmin, seedEstablishment } = require('../utils/firstAdmin');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'create-first-admin.js');

function run(dbPath, args) {
  const out = execFileSync(process.execPath, [SCRIPT, ...args], {
    env: { PATH: process.env.PATH, DB_PATH: dbPath }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function fakeUsers(users) {
  const resets = [];
  return {
    resets,
    findByEmail: (e) => users[e] || null,
    resetUserPassword: (id, pw) => { resets.push([id, pw]); },
    createUser: () => { throw new Error('must not create'); },
  };
}

test('rule 24 — `unused` reissues only for an account nobody signed in to; `never` leaves it alone', () => {
  const fresh = { id: 4, lastLoginAt: null, mustChangePassword: 1 };
  const used = { id: 5, lastLoginAt: '2026-10-17 10:00:00', mustChangePassword: 0 };
  const usersModel = fakeUsers({ 'claire@aulnes.fr': fresh, 'marc@pins.fr': used });
  const gen = () => 'New-Tmp-Pass';
  assert.deepEqual(createFirstAdmin({ usersModel, generatePassword: gen, email: 'claire@aulnes.fr' }),
    { created: false, temporaryPassword: null, removedBootstrap: false });
  const again = createFirstAdmin({ usersModel, generatePassword: gen, email: 'claire@aulnes.fr', reissue: 'unused' });
  assert.equal(again.temporaryPassword, 'New-Tmp-Pass');
  assert.equal(again.reissued, true);
  assert.deepEqual(usersModel.resets, [[4, 'New-Tmp-Pass']]);
  const refused = createFirstAdmin({ usersModel, generatePassword: gen, email: 'marc@pins.fr', reissue: 'unused' });
  assert.equal(refused.temporaryPassword, null);
  assert.equal(refused.used, true);
  assert.equal(usersModel.resets.length, 1, 'a used account keeps its password');
  assert.throws(() => createFirstAdmin({ usersModel, generatePassword: gen, email: 'x@y.fr', reissue: 'maybe' }), /reissue/);
});

test('rule 24 — `always` resets any account and turns its second step off, recorded in its history', () => {
  const usersModel = fakeUsers({ 'marc@pins.fr': { id: 5, lastLoginAt: '2026-10-17 10:00:00', mustChangePassword: 0 } });
  const events = [];
  const twoFactorModel = {
    isEnabled: (id) => id === 5,
    disable: (id) => events.push(['disable', id]),
    addEvent: (id, event, actor) => events.push([event, id, actor]),
  };
  const r = createFirstAdmin({
    usersModel, twoFactorModel, generatePassword: () => 'Reset-Pass', email: 'marc@pins.fr', reissue: 'always', now: () => new Date('2026-10-18T10:00:00Z'),
  });
  assert.equal(r.temporaryPassword, 'Reset-Pass');
  assert.equal(r.secondStepOff, true);
  assert.deepEqual(events, [['disable', 5], ['disabled_by_script', 5, 'console']]);
});

test('rule 25 — the establishment is filled one empty field at a time, never over what was typed', () => {
  let row = { companyName: '', companyEmail: 'deja@saisi.fr', companyAddress: '', companyPhone: '', companyTva: '' };
  const settingsModel = { read: () => row, upsert: (p) => { row = { ...row, ...p }; } };
  const written = seedEstablishment({
    settingsModel,
    establishment: { name: 'Gîte des Aulnes', email: 'claire@aulnes.fr', address: '2 rue des Aulnes,\n33000 Bordeaux', tva: '' },
  });
  assert.deepEqual(written, ['companyName', 'companyAddress']);
  assert.equal(row.companyEmail, 'deja@saisi.fr');
  assert.equal(row.companyAddress, '2 rue des Aulnes, 33000 Bordeaux');
  assert.deepEqual(seedEstablishment({ settingsModel, establishment: null }), []);
});

test('rules 24, 25 — the real script: company and establishment seeded, then a lost invitation reissued', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-seed-'));
  const dbPath = path.join(dir, 'guestflow.db');
  try {
    const establishment = JSON.stringify({ name: 'Gîte des Aulnes', email: 'claire@aulnes.fr', address: '2 rue des Aulnes, 33000 Bordeaux', tva: 'FR12345678901' });
    const first = run(dbPath, ['--email', 'claire@aulnes.fr', '--name', 'Claire Martin', '--company', 'Gîte des Aulnes', '--establishment', establishment]);
    assert.equal(first.created, true);
    assert.deepEqual(first.seeded, ['companyName', 'companyEmail', 'companyAddress', 'companyTva']);
    const db = new Database(dbPath, { readonly: true });
    const s = db.prepare('SELECT companyName, companyEmail, companyAddress, companyTva FROM app_settings LIMIT 1').get();
    const u = db.prepare("SELECT companyName FROM users WHERE email = 'claire@aulnes.fr'").get();
    db.close();
    assert.deepEqual(s, { companyName: 'Gîte des Aulnes', companyEmail: 'claire@aulnes.fr', companyAddress: '2 rue des Aulnes, 33000 Bordeaux', companyTva: 'FR12345678901' });
    assert.equal(u.companyName, 'Gîte des Aulnes');
    const resent = run(dbPath, ['--email', 'claire@aulnes.fr', '--name', 'Claire Martin', '--reissue', 'unused']);
    assert.equal(resent.created, false);
    assert.match(resent.temporaryPassword, /^[A-Za-z2-9]{12}$/);
    assert.notEqual(resent.temporaryPassword, first.temporaryPassword);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rule 25 — GUESTFLOW_PUBLIC_URL is the public URL when none is typed; a typed one wins', () => {
  const { shapeResponse } = require('../utils/settingsResponse');
  const env = { GUESTFLOW_PUBLIC_URL: 'https://aulnes.guestflow.fr' };
  const shaped = shapeResponse({ publicUrl: '', companyName: 'Gîte des Aulnes', companyEmail: 'claire@aulnes.fr' }, env);
  assert.equal(shaped.smtp.derived.publicUrl, 'https://aulnes.guestflow.fr');
  const saved = process.env.GUESTFLOW_PUBLIC_URL;
  const dirs = [];
  const dbs = [];
  process.env.GUESTFLOW_PUBLIC_URL = 'https://aulnes.guestflow.fr';
  try {
    const { create: createSettingsModel } = require('../models/settingsModel');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-seed-url-'));
    dirs.push(dir);
    run(path.join(dir, 'guestflow.db'), ['--email', 'claire@aulnes.fr', '--name', 'Claire']);
    const db = new Database(path.join(dir, 'guestflow.db'));
    dbs.push(db);
    db.exec("UPDATE app_settings SET publicUrl = ''");
    const model = createSettingsModel(db);
    assert.equal(model.publicUrl(), 'https://aulnes.guestflow.fr');
    db.exec("UPDATE app_settings SET publicUrl = 'https://reservations.aulnes.fr'");
    assert.equal(model.publicUrl(), 'https://reservations.aulnes.fr');
  } finally {
    if (saved === undefined) delete process.env.GUESTFLOW_PUBLIC_URL; else process.env.GUESTFLOW_PUBLIC_URL = saved;
    dbs.forEach((d) => d.close());
    dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  }
});
