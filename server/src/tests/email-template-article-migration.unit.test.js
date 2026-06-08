// Content migration: the shipped J-7 reminder upgrades "séjour à {{propertyName}}" →
// "séjour {{propertyWithArticle}}" on installs seeded before the article feature
// (specs/email-automation.md §3 rule 13). Mirrors the idempotent UPDATE in database.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const MIGRATION = `
  UPDATE email_templates
  SET subject   = REPLACE(subject, 'séjour à {{propertyName}}', 'séjour {{propertyWithArticle}}'),
      body      = REPLACE(body,    'séjour à {{propertyName}}', 'séjour {{propertyWithArticle}}'),
      updatedAt = datetime('now')
  WHERE stableKey = 'arrival_reminder_7d'
    AND (subject LIKE '%séjour à {{propertyName}}%' OR body LIKE '%séjour à {{propertyName}}%')
`;

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE email_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT, subject TEXT,
      body TEXT, dayOffset INTEGER, sendMode TEXT, enabled INTEGER, updatedAt TEXT
    );
  `);
  return db;
}

const SIGNATURE_MIGRATION = `
  UPDATE email_templates
  SET body      = REPLACE(body, '{{companyName}}', '{{senderName}}'),
      updatedAt = datetime('now')
  WHERE stableKey = 'arrival_reminder_7d'
    AND body LIKE '%{{companyName}}%'
`;

const OLD_BODY = [
  'Bonjour {{clientFirstName}},',
  'Votre séjour à {{propertyName}} approche, nous nous réjouissons de vous accueillir.',
  '- Logement : {{propertyName}}',
].join('\n');

test('upgrades the old phrasing in subject + body, leaves "- Logement :" untouched', () => {
  const db = freshDb();
  db.prepare("INSERT INTO email_templates (stableKey, subject, body) VALUES ('arrival_reminder_7d', 'Préparation de votre séjour à {{propertyName}}', ?)").run(OLD_BODY);

  db.prepare(MIGRATION).run();

  const row = db.prepare("SELECT subject, body FROM email_templates WHERE stableKey = 'arrival_reminder_7d'").get();
  assert.equal(row.subject, 'Préparation de votre séjour {{propertyWithArticle}}');
  assert.ok(row.body.includes('Votre séjour {{propertyWithArticle}} approche'));
  // The plain "Logement" line keeps the bare name token.
  assert.ok(row.body.includes('- Logement : {{propertyName}}'));
  assert.ok(!row.body.includes('séjour à {{propertyName}}'));
});

test('is idempotent: a second run changes nothing more', () => {
  const db = freshDb();
  db.prepare("INSERT INTO email_templates (stableKey, subject, body) VALUES ('arrival_reminder_7d', 'votre séjour à {{propertyName}}', ?)").run(OLD_BODY);
  db.prepare(MIGRATION).run();
  const after1 = db.prepare("SELECT subject, body FROM email_templates").get();
  db.prepare(MIGRATION).run();
  const after2 = db.prepare("SELECT subject, body FROM email_templates").get();
  assert.deepEqual(after1, after2);
});

test('does not touch operator templates without the shipped stableKey', () => {
  const db = freshDb();
  db.prepare("INSERT INTO email_templates (stableKey, subject, body) VALUES (NULL, 'votre séjour à {{propertyName}}', 'x')").run();
  db.prepare(MIGRATION).run();
  const row = db.prepare('SELECT subject FROM email_templates').get();
  assert.equal(row.subject, 'votre séjour à {{propertyName}}'); // unchanged
});

// ---- signature migration: {{companyName}} → {{senderName}} (rule 14) ----

test('signature migration swaps {{companyName}} for {{senderName}} on the shipped template', () => {
  const db = freshDb();
  db.prepare("INSERT INTO email_templates (stableKey, subject, body) VALUES ('arrival_reminder_7d', 'S', ?)")
    .run('À très bientôt,\n{{companyName}}');
  db.prepare(SIGNATURE_MIGRATION).run();
  const row = db.prepare("SELECT body FROM email_templates WHERE stableKey='arrival_reminder_7d'").get();
  assert.ok(row.body.includes('{{senderName}}'));
  assert.ok(!row.body.includes('{{companyName}}'));
});

test('signature migration is idempotent and leaves operator templates alone', () => {
  const db = freshDb();
  db.prepare("INSERT INTO email_templates (stableKey, subject, body) VALUES ('arrival_reminder_7d', 'S', '{{companyName}}')").run();
  db.prepare("INSERT INTO email_templates (stableKey, subject, body) VALUES (NULL, 'S', '{{companyName}}')").run();
  db.prepare(SIGNATURE_MIGRATION).run();
  const after1 = db.prepare("SELECT body FROM email_templates WHERE stableKey='arrival_reminder_7d'").get().body;
  db.prepare(SIGNATURE_MIGRATION).run();
  const after2 = db.prepare("SELECT body FROM email_templates WHERE stableKey='arrival_reminder_7d'").get().body;
  assert.equal(after1, after2); // idempotent
  // Operator template (no shipped stableKey) keeps {{companyName}}.
  assert.equal(db.prepare('SELECT body FROM email_templates WHERE stableKey IS NULL').get().body, '{{companyName}}');
});
