const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  runGateParagraphMigration, BLOCK_FR, BLOCK_EN, __test,
} = require('../utils/gateParagraphMigration');
const { withGateParagraph } = __test;
const { renderTemplate } = require('../utils/emailTemplateRenderer');

// specs/guest-gate-access.md §3.6 rule 23. On an instance that has been running for months, the
// templates carry the operator's own wording in the database — the default registry only shapes a
// fresh install. This migration is the difference between a feature that ships and one that ships
// invisible, so its placement rule is pinned here rather than trusted.

const OPERATOR_BODY = [
  'Bonjour {{clientFirstName}},',
  '',
  'Votre séjour approche. Voici les informations utiles.',
  '',
  '{{#if hasOptions}}- Options : {{optionsList}}',
  '{{/if}}',
  'Nous restons à votre disposition, au {{companyPhone}}.',
  '',
  'À très bientôt,',
  '{{senderName}}',
].join('\n');

// --- the placement rule ---

test('the block lands at the blank line before the sign-off, above « À très bientôt »', () => {
  const out = withGateParagraph(OPERATOR_BODY, BLOCK_FR).split('\n');
  const gate = out.findIndex((line) => line.includes('hasGateAccess'));
  const salutation = out.findIndex((line) => line.includes('À très bientôt'));
  const signature = out.findIndex((line) => line.includes('{{senderName}}'));

  assert.ok(gate > 0);
  assert.ok(gate < salutation, 'the paragraph reads before the closing salutation');
  assert.ok(salutation < signature, 'and the sign-off is left in one piece');
  assert.equal(out[gate - 1], '', 'a blank line above it, so it does not run on from the sentence before');
  assert.equal(out[salutation - 1], '{{/if}}', 'and the block closes right before the salutation');
});

test('not one existing character is rewritten', () => {
  const out = withGateParagraph(OPERATOR_BODY, BLOCK_FR);
  for (const line of OPERATOR_BODY.split('\n')) {
    if (line === '') continue;
    assert.ok(out.includes(line), `« ${line} » must survive verbatim`);
  }
});

test('a body that already mentions the access is left completely alone', () => {
  const already = `${OPERATOR_BODY}\n{{#if hasGateAccess}}déjà là{{/if}}`;
  assert.equal(withGateParagraph(already, BLOCK_FR), null);
  // Which is what makes a second run a no-op.
});

test('an empty or missing body is not ours to fill', () => {
  assert.equal(withGateParagraph('', BLOCK_FR), null);
  assert.equal(withGateParagraph('   \n  ', BLOCK_FR), null);
  assert.equal(withGateParagraph(null, BLOCK_FR), null);
  assert.equal(withGateParagraph(undefined, BLOCK_EN), null);
});

test('no sign-off token: it appends rather than guessing', () => {
  const body = 'Bonjour,\n\nÀ demain.';
  const out = withGateParagraph(body, BLOCK_FR);
  assert.ok(out.startsWith(body), 'the original is untouched at the front');
  assert.match(out, /hasGateAccess/);
});

test('a sign-off with no blank line above it: the block goes straight above the signature', () => {
  const body = 'Bonjour,\nÀ demain.\n{{senderName}}';
  const out = withGateParagraph(body, BLOCK_FR).split('\n');
  const gate = out.findIndex((line) => line.includes('hasGateAccess'));
  const signature = out.findIndex((line) => line.includes('{{senderName}}'));
  assert.ok(gate < signature);
  assert.ok(out.includes('À demain.'));
});

test('the inserted block is a closed conditional — it renders, and it disappears', () => {
  const out = withGateParagraph(OPERATOR_BODY, BLOCK_FR);
  const context = {
    vars: {
      clientFirstName: 'Camille', companyPhone: '06.15.73.93.37', senderName: 'Domaine Solio',
      optionsList: '', gateAccessCode: '4K7M-9QT2',
      gateAccessUrl: 'https://guest.domainesolio.com/?c=4K7M9QT2',
      gateAccessBaseUrl: 'https://guest.domainesolio.com',
    },
    flags: { hasOptions: false, hasGateAccess: true },
  };

  const withAccess = renderTemplate({ subject: 's', body: out }, context).body;
  assert.match(withAccess, /guest\.domainesolio\.com\/\?c=4K7M9QT2/);
  assert.match(withAccess, /À très bientôt/, 'the sign-off still renders');
  assert.doesNotMatch(withAccess, /\{\{/);

  const without = renderTemplate({ subject: 's', body: out }, {
    vars: { ...context.vars, gateAccessUrl: '', gateAccessCode: '' },
    flags: { hasOptions: false, hasGateAccess: false },
  }).body;
  assert.doesNotMatch(without, /portail/i, 'no orphan paragraph for a stay without an access');
  assert.match(without, /À très bientôt/);
  assert.doesNotMatch(without, /\{\{/);
});

// --- the migration itself ---

function dbWithTemplates(rows) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT, subject TEXT, body TEXT,
    subjectEn TEXT, bodyEn TEXT
  )`);
  const insert = db.prepare('INSERT INTO email_templates (stableKey, body, bodyEn) VALUES (?, ?, ?)');
  for (const row of rows) insert.run(row.stableKey, row.body, row.bodyEn);
  return db;
}

test('it touches the two arrival reminders, in both languages, and nothing else', () => {
  const db = dbWithTemplates([
    { stableKey: 'arrival_reminder_7d', body: OPERATOR_BODY, bodyEn: OPERATOR_BODY },
    { stableKey: 'arrival_reminder_1d', body: OPERATOR_BODY, bodyEn: OPERATOR_BODY },
    { stableKey: 'deposit_request', body: OPERATOR_BODY, bodyEn: OPERATOR_BODY },
    { stableKey: 'cancellation_notice', body: OPERATOR_BODY, bodyEn: null },
  ]);

  const touched = runGateParagraphMigration(db);
  assert.equal(touched.length, 2);
  assert.deepEqual(touched.map((t) => t.stableKey).sort(), ['arrival_reminder_1d', 'arrival_reminder_7d']);

  const rows = db.prepare('SELECT stableKey, body, bodyEn FROM email_templates').all();
  for (const row of rows) {
    const shouldHave = row.stableKey.startsWith('arrival_reminder');
    assert.equal(row.body.includes('hasGateAccess'), shouldHave, `body of ${row.stableKey}`);
    if (row.bodyEn) {
      assert.equal(row.bodyEn.includes('hasGateAccess'), shouldHave, `bodyEn of ${row.stableKey}`);
    }
  }
  assert.match(rows.find((r) => r.stableKey === 'arrival_reminder_7d').bodyEn, /Opening the gate/);
});

test('running it twice changes nothing the second time', () => {
  const db = dbWithTemplates([{ stableKey: 'arrival_reminder_7d', body: OPERATOR_BODY, bodyEn: OPERATOR_BODY }]);
  runGateParagraphMigration(db);
  const after = db.prepare('SELECT body, bodyEn FROM email_templates').get();

  const second = runGateParagraphMigration(db);
  assert.deepEqual(second, []);
  assert.deepEqual(db.prepare('SELECT body, bodyEn FROM email_templates').get(), after);
});

test('a template with no English side keeps its null instead of gaining an English paragraph', () => {
  const db = dbWithTemplates([{ stableKey: 'arrival_reminder_1d', body: OPERATOR_BODY, bodyEn: null }]);
  const touched = runGateParagraphMigration(db);

  assert.equal(touched.length, 1);
  assert.equal(touched[0].en, false);
  const row = db.prepare('SELECT body, bodyEn FROM email_templates').get();
  assert.match(row.body, /hasGateAccess/);
  assert.equal(row.bodyEn, null);
});

test('an instance with no arrival templates at all is not an error', () => {
  const db = dbWithTemplates([{ stableKey: 'deposit_request', body: OPERATOR_BODY, bodyEn: null }]);
  assert.deepEqual(runGateParagraphMigration(db), []);
});
