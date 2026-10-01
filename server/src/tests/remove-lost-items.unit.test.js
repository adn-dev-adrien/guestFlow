// specs/guest-email-sequence.md rule 33 (removed 2026-09-28) — the stored templates lose their
// `{{lostItemsParagraph}}` line and `reservations.lostItems` is dropped, both idempotently.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  stripLostItemsToken, runStripLostItemsTokenMigration, dropLostItemsColumn,
} = require('../utils/removeLostItemsMigration');
const { J1_BODY, J1_BODY_EN } = require('../utils/guestEmailSequenceTemplates');

// The J+1 bodies as they were shipped before the removal (v3.4.0).
const OLD_J1 = [
  'Bonjour {{clientFirstName}},',
  '',
  'Et si quelque chose a manqué à votre séjour, dites-le nous.',
  '',
  '{{lostItemsParagraph}}',
  '',
  '{{#if hasInstagram}}{{instagramParagraph}}',
  '',
  '{{/if}}Le domaine change de visage à chaque saison.',
  '',
  'Avec toute notre amitié,',
  '{{senderName}}',
].join('\n');

function templatesDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE email_templates (id INTEGER PRIMARY KEY, stableKey TEXT, body TEXT, bodyEn TEXT, updatedAt TEXT);
           CREATE TABLE reservations (id INTEGER PRIMARY KEY, notes TEXT, lostItems TEXT NOT NULL DEFAULT '');`);
  return db;
}

test('the shipped J+1 bodies no longer quote the lost items', () => {
  assert.ok(!J1_BODY.includes('lostItems'));
  assert.ok(!J1_BODY_EN.includes('lostItems'));
  assert.ok(!/\n\n\n/.test(J1_BODY));
});

test('the token line goes with its blank line, the rest is untouched', () => {
  const out = stripLostItemsToken(OLD_J1);
  assert.equal(out, OLD_J1.replace('{{lostItemsParagraph}}\n\n', ''));
  assert.ok(!/\n\n\n/.test(out));
});

test('an operator-edited template: only the token goes, CRLF and inline uses included', () => {
  const edited = 'Bonjour,\r\n\r\nMerci pour tout !\r\n\r\n{{ lostItemsParagraph }}\r\n\r\nÀ bientôt.';
  assert.equal(stripLostItemsToken(edited), 'Bonjour,\r\n\r\nMerci pour tout !\r\n\r\nÀ bientôt.');
  assert.equal(stripLostItemsToken('Merci. {{lostItemsParagraph}} À bientôt.'), 'Merci. À bientôt.');
  assert.equal(stripLostItemsToken('Merci.\n\n{{lostItemsParagraph}}'), 'Merci.');
  assert.equal(stripLostItemsToken('Sans le jeton.'), null);
});

test('migration — rewrites body and bodyEn of every holder, then is a no-op', () => {
  const db = templatesDb();
  const insert = db.prepare('INSERT INTO email_templates (stableKey, body, bodyEn) VALUES (?, ?, ?)');
  insert.run('guest_thanks_j1', OLD_J1, 'Hello,\n\n{{lostItemsParagraph}}\n\nBye');
  insert.run('arrival_reminder_1d', 'Rien à voir.', null);
  assert.equal(runStripLostItemsTokenMigration(db), 2);
  const j1 = db.prepare("SELECT body, bodyEn FROM email_templates WHERE stableKey = 'guest_thanks_j1'").get();
  assert.ok(!j1.body.includes('lostItems'));
  assert.equal(j1.bodyEn, 'Hello,\n\nBye');
  assert.equal(db.prepare("SELECT body FROM email_templates WHERE stableKey = 'arrival_reminder_1d'").get().body, 'Rien à voir.');
  assert.equal(runStripLostItemsTokenMigration(db), 0, 'idempotent');
});

test('column drop — drops once, keeps the rows, then is a no-op', () => {
  const db = templatesDb();
  db.prepare("INSERT INTO reservations (notes) VALUES ('garder')").run();
  assert.equal(dropLostItemsColumn(db), true);
  const cols = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
  assert.deepEqual(cols, ['id', 'notes']);
  assert.equal(db.prepare('SELECT notes FROM reservations').get().notes, 'garder');
  assert.equal(dropLostItemsColumn(db), false, 'idempotent');
});
