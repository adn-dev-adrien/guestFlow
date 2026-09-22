// specs/terms-acceptance-record.md §3.7 — `{{cgvUrl}}` in guest emails (pinned to the version the
// guest accepted, else the current one) and the one-shot migration of the stored confirmation template.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { buildContext } = require('../utils/emailContextBuilder');
const { renderTemplate } = require('../utils/emailTemplateRenderer');
const { loadTermsVersion } = require('../utils/reservationEmailGraph');
const { runConfirmationCgvLinkMigration, insertCgvParagraph } = require('../utils/migrateConfirmationCgvLink');
const { CONFIRMATION_BODY, CGV_SENTENCE_FR } = require('../utils/guestEmailSequenceTemplates');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function ctx(settings, termsVersion) {
  return buildContext({ reservation: { id: 1 }, client: null, property: null, settings, termsVersion });
}

test('cgvUrl — site origin + /cgv/?v=N, trailing slash tolerated', () => {
  const c = ctx({ publicSiteOrigin: 'https://domainesolio.com/' }, 3);
  assert.equal(c.vars.cgvUrl, 'https://domainesolio.com/cgv/?v=3');
  assert.equal(c.flags.hasCgvUrl, true);
});

test('cgvUrl — empty (and the paragraph gone) when no version is published', () => {
  const c = ctx({ publicSiteOrigin: 'https://domainesolio.com' }, null);
  assert.equal(c.vars.cgvUrl, '');
  assert.equal(c.flags.hasCgvUrl, false);
  const { body } = renderTemplate({ subject: '', body: CONFIRMATION_BODY }, c);
  assert.ok(!body.includes('conditions générales'));
  assert.ok(!/\n\n\n/.test(body), 'no blank line left behind');
});

test('the default confirmation renders the paragraph before « Une question »', () => {
  const { body } = renderTemplate({ subject: '', body: CONFIRMATION_BODY }, ctx({ publicSiteOrigin: 'https://domainesolio.com' }, 2));
  assert.match(body, /de votre séjour ici : https:\/\/domainesolio\.com\/cgv\/\?v=2\n\nUne question/);
});

function dbWithVersions() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'P')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'C', 'M')").run();
  db.prepare("INSERT INTO reservations (id, propertyId, clientId, startDate, endDate) VALUES (1, 1, 1, '2026-10-01', '2026-10-03'), (2, 1, 1, '2026-11-01', '2026-11-03')").run();
  const ins = db.prepare("INSERT INTO terms_versions (version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt) VALUES (?, '', '', '', '', '{}', 'h', '2026-09-01')");
  ins.run(1); ins.run(2);
  db.prepare("INSERT INTO terms_acceptances (reservationId, termsVersionId, acceptedAt) VALUES (1, 1, '2026-09-02')").run();
  return db;
}

test('loadTermsVersion — the accepted version wins over the current one', () => {
  const db = dbWithVersions();
  assert.equal(loadTermsVersion(db, 1), 1);
  assert.equal(loadTermsVersion(db, 2), 2, 'no acceptance (booked by phone) → current version');
});

test('loadTermsVersion — a schema without the CGV tables yields no link', () => {
  const db = new Database(':memory:');
  assert.equal(loadTermsVersion(db, 1), null);
});

test('migration — inserted before « Une question », once; EN handled; idempotent', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE email_templates (id INTEGER PRIMARY KEY, stableKey TEXT, body TEXT, bodyEn TEXT, updatedAt TEXT)');
  db.prepare("INSERT INTO email_templates (id, stableKey, body, bodyEn) VALUES (1, 'reservation_confirmation', ?, ?)")
    .run('Bonjour,\n\nUne question ? Appelez-nous.\n\nÀ bientôt', 'Hello,\n\nAny question? Call us.');
  assert.equal(runConfirmationCgvLinkMigration(db), 2);
  const row = db.prepare('SELECT body, bodyEn FROM email_templates').get();
  assert.equal(row.body, `Bonjour,\n\n{{#if hasCgvUrl}}${CGV_SENTENCE_FR}\n\n{{/if}}Une question ? Appelez-nous.\n\nÀ bientôt`);
  assert.match(row.bodyEn, /\{\{cgvUrl\}\}/);
  assert.equal(runConfirmationCgvLinkMigration(db), 0);
});

test('migration — an operator who removed « Une question » gets the paragraph at the end', () => {
  const out = insertCgvParagraph('Bonjour,\n\nÀ bientôt\n', CGV_SENTENCE_FR, 'Une question');
  assert.equal(out, `Bonjour,\n\nÀ bientôt\n\n{{#if hasCgvUrl}}${CGV_SENTENCE_FR}{{/if}}`);
});

test('migration — no confirmation template → nothing to do', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE email_templates (id INTEGER PRIMARY KEY, stableKey TEXT, body TEXT, bodyEn TEXT, updatedAt TEXT)');
  assert.equal(runConfirmationCgvLinkMigration(db), 0);
});
