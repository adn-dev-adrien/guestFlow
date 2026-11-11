// specs/guest-email-texts-made-simple.md rule 13 — the draft preview writes inside a transaction it always rolls back.
// A read-then-write transaction that starts while another connection holds the write lock and commits fails at once
// with SQLITE_BUSY_SNAPSHOT (the busy timeout does not apply), which answered 500 under load (E2E « Textes des emails »).
// It takes the write lock up front (BEGIN IMMEDIATE) and waits for the busy timeout instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');

const { seedProperty, seedClient, seedReservation } = require('./guestEmailSequenceFixtures');
const { ensureDefaultEmailTemplates } = require('../utils/defaultEmailTemplatesSeed');
const { applyGuestEmailSequenceSchema } = require('../utils/guestEmailSequenceSchema');
const { buildController: buildEmails } = require('../controllers/emailsController');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const emailPreferencesModel = require('../models/emailPreferencesModel');
const guestEmailSendsModel = require('../models/guestEmailSendsModel');
const { call, isoDay } = require('./emailTextsFixture');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const HOLD_MS = 400;

function fileSetup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-preview-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'main.db');
  const db = new Database(file);
  t.after(() => db.close());
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  applyGuestEmailSequenceSchema(db);
  ensureDefaultEmailTemplates(db, { logger: { log() {} } });
  db.prepare('INSERT INTO app_settings (id) VALUES (1)').run();
  seedProperty(db, { id: 1, name: 'Le Gîte', nameArticle: 'au', nameArticleConfirmed: 1 });
  seedClient(db, { id: 1 });
  seedReservation(db, { startDate: isoDay(5), endDate: isoDay(8), doubleBeds: 1 });
  const emails = buildEmails({
    database: db,
    templatesModel: emailTemplatesModel.buildModel(db),
    logModel: emailLogModel.buildModel(db),
    settingsModel: { read: () => ({ companyEmail: 'contact@lespres.fr' }), smtpConfigured: () => false, notificationSettings: () => ({}) },
    emailServiceFactory: () => ({ isConfigured: false }),
    ledger: guestEmailSendsModel.buildModel(db),
    preferences: emailPreferencesModel.buildModel(db),
  });
  return { db, file, emails, templateId: db.prepare("SELECT id FROM email_templates WHERE stableKey = 'arrival_reminder_1d'").get().id };
}

// Another process holds the write lock for HOLD_MS, then commits a change.
function holdWriteLock(file) {
  const code = `
    const Database = require(${JSON.stringify(require.resolve('better-sqlite3'))});
    const db = new Database(${JSON.stringify(file)});
    db.exec('BEGIN IMMEDIATE');
    console.log('locked');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${HOLD_MS});
    db.prepare("UPDATE properties SET name = 'Le Gîte 2' WHERE id = 1").run();
    db.exec('COMMIT');
  `;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  const locked = new Promise((resolve) => child.stdout.once('data', resolve));
  const exited = new Promise((resolve) => child.on('exit', resolve));
  return { locked, exited };
}

test('rule 13: a preview asked while another connection writes waits for it and answers 200, nothing saved', async (t) => {
  const { db, file, emails, templateId } = fileSetup(t);
  const before = db.prepare('SELECT COUNT(*) AS n FROM stay_texts').get().n;
  const writer = holdWriteLock(file);
  await writer.locked;

  const started = Date.now();
  const res = await call(emails.previewDraft, { body: { templateId, language: 'fr', draft: { texts: { 'text:house': { fr: 'Café et thé.' } } } } });
  await writer.exited;

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Date.now() - started >= HOLD_MS - 100, 'it waited for the writer');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stay_texts').get().n, before, 'rolled back');
});
