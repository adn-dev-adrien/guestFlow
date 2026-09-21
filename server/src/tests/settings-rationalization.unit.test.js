/**
 * Settings rationalization — specs/settings-rationalization.md.
 * One file for the whole spec: dropped settings, derived settings, moved settings.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('module');
const Database = require('better-sqlite3');

const settingsModel = require('../models/settingsModel');
const schoolHolidaysModel = require('../models/schoolHolidaysModel');
const { shapeResponse } = require('../utils/settingsResponse');
const { __test: { SMTP_FIELDS } } = require('../controllers/settingsController');
const { smtpPortForSecure } = require('../utils/settingsValidation');
const { resolveEmailIdentity } = require('../utils/emailIdentity');
const {
  DEAD_SETTINGS_COLUMNS,
  IDENTITY_MIGRATION,
  AUTO_SEND_MIGRATION,
  runSettingsRationalizationMigration,
} = require('../utils/settingsRationalizationMigration');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function baselineDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT OR IGNORE INTO app_settings (id) VALUES (1)').run();
  return db;
}

function settingsColumns(db) {
  return db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name);
}

// A pre-rationalization install: the baseline plus every dead column and the stray table.
function legacyDb() {
  const db = baselineDb();
  for (const column of DEAD_SETTINGS_COLUMNS) {
    db.exec(`ALTER TABLE app_settings ADD COLUMN ${column} TEXT DEFAULT ''`);
  }
  db.exec('CREATE TABLE payment_methods (id INTEGER PRIMARY KEY, label TEXT)');
  db.exec("INSERT INTO payment_methods (label) VALUES ('Carte')");
  return db;
}

// ---------- rules 9-10 — dead settings are dropped ----------

test('rules 9-10: a fresh install never creates the dead columns', () => {
  const columns = settingsColumns(baselineDb());
  for (const column of DEAD_SETTINGS_COLUMNS) {
    assert.equal(columns.includes(column), false, `${column} is not in schema.sql any more`);
  }
});

test('rules 9-10: the migration drops every dead column and the stray payment_methods table', () => {
  const db = legacyDb();
  db.prepare("UPDATE app_settings SET companyName = 'Domaine Solio' WHERE id = 1").run();

  const { dropped } = runSettingsRationalizationMigration(db);

  assert.deepEqual([...dropped].sort(), [...DEAD_SETTINGS_COLUMNS].sort());
  const columns = settingsColumns(db);
  for (const column of DEAD_SETTINGS_COLUMNS) assert.equal(columns.includes(column), false);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payment_methods'").get();
  assert.equal(table, undefined);
  assert.equal(db.prepare('SELECT companyName FROM app_settings WHERE id = 1').get().companyName, 'Domaine Solio',
    'the live settings survive the drop');
});

test('rules 9-10: the migration is idempotent', () => {
  const db = legacyDb();
  runSettingsRationalizationMigration(db);
  assert.deepEqual(runSettingsRationalizationMigration(db).dropped, []);
  assert.deepEqual(runSettingsRationalizationMigration(baselineDb()).dropped, []);
});

test('rule 9: the settings model no longer exposes the payment timings', () => {
  const model = settingsModel.create(baselineDb());
  assert.equal(typeof model.paymentTimings, 'undefined');
});

// ---------- rule 11 — the SMTP port is derived, never stored ----------

test('rule 11: implicit TLS means 465, STARTTLS means 587', () => {
  assert.equal(smtpPortForSecure(true), 465);
  assert.equal(smtpPortForSecure(1), 465);
  assert.equal(smtpPortForSecure('1'), 465);
  assert.equal(smtpPortForSecure(false), 587);
  assert.equal(smtpPortForSecure(0), 587);
  assert.equal(smtpPortForSecure(undefined), 587);
});

test('rule 11: the email service gets the port of the security mode', () => {
  const model = settingsModel.create(baselineDb());
  model.upsert({ smtpHost: 'smtp.example.com', smtpSecure: 1 });
  assert.equal(model.decryptedSmtpSettings().port, 465);
  model.upsert({ smtpSecure: 0 });
  assert.equal(model.decryptedSmtpSettings().port, 587);
});

test('rule 11: the SMTP field map has no port entry, so a sent port cannot be stored', () => {
  assert.equal(SMTP_FIELDS.some((f) => f.input === 'port'), false);
  assert.equal(SMTP_FIELDS.some((f) => f.column === 'smtpPort'), false);
});

// ---------- rule 13 — the school-holiday sync cadence is fixed ----------

test('rule 13: the sync cadence is 60 days / 24 months whatever the legacy columns hold', () => {
  const db = baselineDb();
  db.prepare('INSERT OR IGNORE INTO school_holidays_sync_state (id) VALUES (1)').run();
  db.prepare('UPDATE school_holidays_sync_state SET syncIntervalDays = 7, syncHorizonMonths = 3 WHERE id = 1').run();
  const state = schoolHolidaysModel.create(db).getSyncState();
  assert.equal(state.syncIntervalDays, 60);
  assert.equal(state.syncHorizonMonths, 24);
  assert.equal(schoolHolidaysModel.SYNC_INTERVAL_DAYS, 60);
  assert.equal(schoolHolidaysModel.SYNC_HORIZON_MONTHS, 24);
});

// ---------- bug 2 — the English devis footer round-trips ----------

test('rule 23 (bug 2): GET /settings returns the English devis footer', () => {
  const shaped = shapeResponse({ quoteFooterText: 'Merci', quoteFooterTextEn: 'Thank you' });
  assert.equal(shaped.quote.footerText, 'Merci');
  assert.equal(shaped.quote.footerTextEn, 'Thank you');
});

// ---------- rule 12 — one email address, typed once ----------

test('rule 12: every address and name falls back to Établissement', () => {
  assert.deepEqual(resolveEmailIdentity({ companyEmail: ' contact@solio.fr ', companyName: 'Domaine Solio' }), {
    fromEmail: 'contact@solio.fr',
    username: 'contact@solio.fr',
    fromName: 'Domaine Solio',
    recipient: 'contact@solio.fr',
  });
  assert.equal(resolveEmailIdentity({}).fromName, 'GuestFlow', 'no company name → the product name');
});

test('rule 12: an override wins, and the login / recipient follow the overridden sending address', () => {
  const identity = resolveEmailIdentity({
    companyEmail: 'contact@solio.fr', companyName: 'Domaine Solio',
    smtpFromEmail: 'no-reply@solio.fr', smtpFromName: 'Adrien',
  });
  assert.equal(identity.fromEmail, 'no-reply@solio.fr');
  assert.equal(identity.username, 'no-reply@solio.fr');
  assert.equal(identity.recipient, 'no-reply@solio.fr');
  assert.equal(identity.fromName, 'Adrien');
  assert.equal(resolveEmailIdentity({ companyEmail: 'a@b.fr', smtpUsername: 'login-42' }).username, 'login-42');
  assert.equal(resolveEmailIdentity({ companyEmail: 'a@b.fr', notificationRecipientEmail: 'me@b.fr' }).recipient, 'me@b.fr');
});

test('rule 12: the settings model sends with the resolved identity', () => {
  const model = settingsModel.create(baselineDb());
  model.upsert({ smtpHost: 'smtp.example.com', companyEmail: 'contact@solio.fr', companyName: 'Domaine Solio' });
  assert.equal(model.smtpConfigured(), true, 'the contact email is enough to send');
  const smtp = model.decryptedSmtpSettings();
  assert.equal(smtp.fromEmail, 'contact@solio.fr');
  assert.equal(smtp.user, 'contact@solio.fr');
  assert.equal(smtp.fromName, 'Domaine Solio');
  assert.equal(model.notificationSettings().recipientEmail, 'contact@solio.fr');
});

test('rule 12: GET /settings returns each override and what it falls back to when left empty', () => {
  const shaped = shapeResponse({
    companyEmail: 'contact@solio.fr', companyName: 'Domaine Solio',
    smtpFromEmail: 'no-reply@solio.fr', smtpUsername: 'login-42',
  });
  assert.equal(shaped.smtp.fromEmail, 'no-reply@solio.fr');
  assert.equal(shaped.smtp.username, 'login-42');
  assert.equal(shaped.smtp.fromName, '', 'no override');
  assert.deepEqual(shaped.smtp.derived, {
    fromEmail: 'contact@solio.fr', // the contact email
    username: 'no-reply@solio.fr', // the sending address in force
    fromName: 'Domaine Solio', // the company name
  });
  assert.equal(shaped.notifications.derivedRecipient, 'no-reply@solio.fr');
  assert.equal('port' in shaped.smtp, false);
});

test('§5: the migration blanks every value equal to its fallback and changes no effective value', () => {
  const db = legacyDb();
  db.prepare(`UPDATE app_settings SET companyEmail = 'contact@solio.fr', companyName = 'Domaine Solio',
    smtpFromEmail = 'Contact@solio.fr', smtpUsername = 'contact@solio.fr', smtpFromName = 'Domaine Solio',
    notificationRecipientEmail = 'contact@solio.fr' WHERE id = 1`).run();
  const before = resolveEmailIdentity(db.prepare('SELECT * FROM app_settings WHERE id = 1').get());

  assert.equal(runSettingsRationalizationMigration(db).identityNormalised, true);

  const row = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
  assert.deepEqual([row.smtpFromEmail, row.smtpUsername, row.smtpFromName, row.notificationRecipientEmail], ['', '', '', '']);
  assert.deepEqual({ ...resolveEmailIdentity(row), fromEmail: resolveEmailIdentity(row).fromEmail.toLowerCase() },
    { ...before, fromEmail: before.fromEmail.toLowerCase() });
});

test('§5: a genuine override survives, the old « GuestFlow » default is dropped, and it runs once', () => {
  const db = legacyDb();
  db.prepare(`UPDATE app_settings SET companyEmail = 'contact@solio.fr', companyName = 'Domaine Solio',
    smtpFromEmail = 'no-reply@solio.fr', smtpUsername = 'login-42', smtpFromName = 'GuestFlow' WHERE id = 1`).run();
  runSettingsRationalizationMigration(db);
  let row = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
  assert.equal(row.smtpFromEmail, 'no-reply@solio.fr');
  assert.equal(row.smtpUsername, 'login-42');
  assert.equal(row.smtpFromName, '', 'the sender name now follows the company name');
  assert.ok(db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(IDENTITY_MIGRATION));

  // Set deliberately equal afterwards: a second boot does not touch it.
  db.prepare("UPDATE app_settings SET smtpFromEmail = 'contact@solio.fr' WHERE id = 1").run();
  runSettingsRationalizationMigration(db);
  row = db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
  assert.equal(row.smtpFromEmail, 'contact@solio.fr');
});

// ---------- rule 17b — automatic sending is decided per template ----------

function withTemplates(db) {
  db.exec(`INSERT INTO email_templates (stableKey, name, subject, body, dayOffset, sendMode, enabled) VALUES
    ('arrival_reminder_7d', 'J-7', 'S', 'B', -7, 'auto', 1),
    ('deposit_request', 'Acompte', 'S', 'B', 0, 'manual', 1)`);
  return db;
}
const modes = (db) => db.prepare('SELECT stableKey, sendMode FROM email_templates ORDER BY stableKey').all()
  .map((r) => `${r.stableKey}:${r.sendMode}`);

test('rule 17b: with the master switch OFF, every template goes back to « manual » before the switch is dropped', () => {
  const db = withTemplates(legacyDb());
  db.prepare("UPDATE app_settings SET emailAutoSendEnabled = '0' WHERE id = 1").run();
  const { templatesSetToManual, dropped } = runSettingsRationalizationMigration(db);
  assert.equal(templatesSetToManual, 1);
  assert.deepEqual(modes(db), ['arrival_reminder_7d:manual', 'deposit_request:manual']);
  assert.ok(dropped.includes('emailAutoSendEnabled'));
});

test('rule 17b: with the master switch ON, the templates keep their mode', () => {
  const db = withTemplates(legacyDb());
  db.prepare("UPDATE app_settings SET emailAutoSendEnabled = '1' WHERE id = 1").run();
  assert.equal(runSettingsRationalizationMigration(db).templatesSetToManual, 0);
  assert.deepEqual(modes(db), ['arrival_reminder_7d:auto', 'deposit_request:manual']);
});

test('rule 17b: a database that never had the switch reads as OFF, and the step runs once', () => {
  const db = withTemplates(baselineDb());
  runSettingsRationalizationMigration(db);
  assert.deepEqual(modes(db), ['arrival_reminder_7d:manual', 'deposit_request:manual']);
  assert.ok(db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(AUTO_SEND_MIGRATION));

  // The operator switches a template to « auto » afterwards: the next boot leaves it alone.
  db.prepare("UPDATE email_templates SET sendMode = 'auto' WHERE stableKey = 'arrival_reminder_7d'").run();
  runSettingsRationalizationMigration(db);
  assert.deepEqual(modes(db), ['arrival_reminder_7d:auto', 'deposit_request:manual']);
});

// ---------- rule 17a — past reservations are unlocked per fiche ----------


function reservationsControllerWith(stored, captures) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (id === '../models/reservationsModel') {
      return new Proxy({}, { get: (_, key) => {
        if (key === 'getForArchiveCheck') return () => stored;
        if (key === 'remove') return (rid) => { captures.removed = rid; };
        return () => null;
      } });
    }
    if (id === '../utils/googleCalendarSync') return { scheduleDelete() {}, scheduleUpsert() {} };
    return origRequire.call(this, id);
  };
  try {
    delete require.cache[require.resolve('../controllers/reservationsController')];
    return require('../controllers/reservationsController');
  } finally {
    Module.prototype.require = origRequire;
  }
}

function fakeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

const ENDED = { id: 9, endDate: '2020-01-05' };
const admin = { roles: ['admin'] };
const reception = { roles: ['reception'] };

test('rule 17a: a stay that has ended cannot be deleted without an explicit unlock', () => {
  const captures = {};
  const res = fakeRes();
  reservationsControllerWith(ENDED, captures).remove({ params: { id: '9' }, query: {}, user: admin }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(captures.removed, undefined);
});

test('rule 17a: an admin who unlocked the fiche can delete it', () => {
  const captures = {};
  const res = fakeRes();
  reservationsControllerWith(ENDED, captures).remove({ params: { id: '9' }, query: { unlockPast: '1' }, user: admin }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(captures.removed, '9');
});

test('rule 17a: the unlock flag means nothing coming from another role', () => {
  const captures = {};
  const res = fakeRes();
  reservationsControllerWith(ENDED, captures).remove({ params: { id: '9' }, query: { unlockPast: '1' }, body: { unlockPast: true }, user: reception }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(captures.removed, undefined);
});

// ---------- rule 17 — the Plateformes page reads every setting as stored ----------

const platformsModel = require('../models/platformsModel');

test('rule 17: listSettings reports each platform\'s real tourist-tax mode, deposit and payout', () => {
  const db = baselineDb();
  db.exec(`INSERT INTO platforms (name, commissionPercent, collectsTouristTax, touristTaxRemittedByPlatform, platformTakesDeposit)
    VALUES ('direct', 5, 1, 1, 0), ('Airbnb', 15.5, 1, 1, 0), ('Abracadaroom', 20, 0, 0, 0), ('Lodgify', 5, 1, 0, 1)`);
  const rows = new Map(platformsModel.create(db).listSettings().map((p) => [p.name, p]));
  assert.equal(rows.get('Airbnb').touristTaxCollection, 'platform');
  assert.equal(rows.get('Abracadaroom').touristTaxCollection, 'owner');
  assert.equal(rows.get('Lodgify').touristTaxCollection, 'platform_reversed');
  assert.equal(rows.get('Lodgify').takesDeposit, true);
  assert.equal(rows.get('Lodgify').payoutDueDays, null, 'an own channel has no payout');
  assert.equal(rows.get('direct').touristTaxCollection, null);
  assert.equal(rows.get('Airbnb').payoutDueDays, 10);
});

// ---------- rule 23a — the property form is validated server-side ----------

const { validatePropertyInput } = require('../utils/propertyValidation');

test('rule 23a: at least one bed, and the beds must sleep the guests — checked when capacity changes', () => {
  assert.equal(validatePropertyInput({ maxGuests: '2', doubleBeds: '0', singleBeds: '0' }).doubleBeds, 'Il faut au moins un lit.');
  assert.match(validatePropertyInput({ maxGuests: '6', doubleBeds: '1', singleBeds: '2' }).maxGuests, /Seulement 4 couchages pour 6/);
  assert.deepEqual(validatePropertyInput({ maxGuests: '6', doubleBeds: '2', singleBeds: '2' }), {});
  // An unrelated edit of a property already stored in that state is not blocked.
  const stored = { maxGuests: 6, doubleBeds: 1, singleBeds: 2 };
  assert.deepEqual(validatePropertyInput({ maxGuests: '6', doubleBeds: '1', singleBeds: '2', defaultCautionAmount: '400' }, stored), {});
});

test('rule 23a: deposit %, tax %, amounts and included guests are bounded', () => {
  const errors = validatePropertyInput({
    maxGuests: '4', depositEnabled: 'true', depositPercent: '100',
    touristTaxPercentage: '120', defaultCautionAmount: '-5', basePriceIncludedGuests: '5', name: '  ',
  }, { maxGuests: 4, doubleBeds: 2, singleBeds: 0 });
  assert.ok(errors.depositPercent);
  assert.ok(errors.touristTaxPercentage);
  assert.ok(errors.defaultCautionAmount);
  assert.match(errors.basePriceIncludedGuests, /capacité \(4\)/);
  assert.ok(errors.name);
  // Deposit OFF → its percentage is not judged (it is kept, not used).
  assert.equal(validatePropertyInput({ depositEnabled: 'false', depositPercent: '100' }).depositPercent, undefined);
});

// ---------- rule 17c — the J-7 hooks are written alone ----------

const propertiesModel = require('../models/propertiesModel');

function propertiesDb() {
  const db = baselineDb();
  require('../utils/guestEmailSequenceSchema').applyGuestEmailSequenceSchema(db);
  db.exec("INSERT INTO properties (id, name, maxGuests, defaultCautionAmount) VALUES (1, 'La Granja', 6, 500), (2, 'L''Estiva', 4, 400)");
  return db;
}

test('rule 17c: saving the hooks writes the two hook columns and nothing else', () => {
  const db = propertiesDb();
  const model = propertiesModel.buildModel(db);
  const result = model.saveEmailHooks([{ propertyId: 1, emailHook: ' Le soleil se lève. ', emailHookEn: 'The sun rises.' }]);
  assert.equal(result.data.find((h) => h.propertyId === 1).emailHook, 'Le soleil se lève.');
  const row = db.prepare('SELECT defaultCautionAmount, maxGuests FROM properties WHERE id = 1').get();
  assert.deepEqual({ ...row }, { defaultCautionAmount: 500, maxGuests: 6 });
  assert.equal(model.saveEmailHooks([{ propertyId: 99, emailHook: 'x' }]).status, 400);
  assert.equal(model.saveEmailHooks('nope').status, 400);
});

// ---------- rule 15 — the options catalogue leaves out the per-property auto-options ----------

function optionsControllerWith(rows) {
  const modelPath = require.resolve('../models/optionsModel');
  const controllerPath = require.resolve('../controllers/optionsController');
  const saved = require.cache[modelPath];
  delete require.cache[controllerPath];
  require.cache[modelPath] = { id: modelPath, filename: modelPath, loaded: true, exports: { list: () => rows } };
  try {
    return require('../controllers/optionsController');
  } finally {
    delete require.cache[controllerPath];
    if (saved) require.cache[modelPath] = saved; else delete require.cache[modelPath];
  }
}

function listed(controller, query) {
  let body;
  controller.list({ query }, { json: (value) => { body = value; return value; } });
  return body.map((o) => o.id);
}

test('rule 15: the catalogue view hides early arrival / late departure; every other caller gets them', () => {
  const controller = optionsControllerWith([
    { id: 1, autoOptionType: null },
    { id: 2, autoOptionType: 'early_check_in' },
    { id: 3, autoOptionType: 'late_check_out' },
  ]);
  assert.deepEqual(listed(controller, { view: 'catalogue' }), [1]);
  assert.deepEqual(listed(controller, {}), [1, 2, 3]);
});
