// specs/payment-link-lifecycle.md rule 59 (audit R9 database N1) — the sentence stating the link's end lives in a
// block of its own, `{{#if hasPaymentLinkValidUntil}}…{{/if}}`, set by the sender with the date. A rolled-back
// release knows neither the token nor the flag: it drops the line whole instead of mailing « Ce lien est valable
// jusqu'au . ». The content migration v2 moves the sentence of untouched templates (as v1 left them) into that
// block, never an operator-edited side, once, whatever v1 did before (specs/self-update-and-releases.md rule 53).

process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const { renderTemplate } = require('../utils/emailTemplateRenderer');
const { DEFAULT_TEMPLATES, VALID_UNTIL_SENTENCE } = require('../utils/defaultEmailTemplatesRegistry');
const {
  runValidUntilSentenceMigration, runValidUntilBlockMigration, withoutValidUntilSentence, withValidUntilSentence,
  rollbackSafeValidUntil, MIGRATION_NAME_V2, MIGRATED_V1,
} = require('../utils/migrateValidUntilSentence');
const { draftTemplateFor } = require('../utils/paymentRequestDraft');

const LINK_KEYS = ['deposit_request', 'balance_request', 'full_request', 'installment_request', 'deposit_reminder'];
const SIDES = [['body', 'fr'], ['bodyEn', 'en']];
const quiet = { log: () => {} };
const hash = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const template = (key) => DEFAULT_TEMPLATES.find((row) => row.stableKey === key);
// The v1 form of a default: the sentence on the line right after the link, as rule 36 first shipped it.
const v1Form = (body, lang) => withValidUntilSentence(withoutValidUntilSentence(body), lang);
const render = (body, vars, flags) => renderTemplate({ subject: '', body }, { vars, flags }).body;

// What a rolled-back release hands the renderer: a link, and neither the token nor its flag.
const ROLLBACK = [{ paymentLink: 'https://pay.example.test/l' }, { hasPaymentLink: true }];
const CURRENT = [{ paymentLink: 'https://pay.example.test/l', paymentLinkValidUntil: 'lundi 2 novembre à 18 h 00' }, { hasPaymentLink: true, hasPaymentLinkValidUntil: true }];

function templatesDb(rows) {
  const memory = new Database(':memory:');
  memory.exec(`CREATE TABLE email_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT, subject TEXT, body TEXT, subjectEn TEXT, bodyEn TEXT, updatedAt TEXT);
               CREATE TABLE migrations (name TEXT PRIMARY KEY, ranAt TEXT DEFAULT (datetime('now')));`);
  for (const [key, body, bodyEn] of rows) {
    memory.prepare('INSERT INTO email_templates (stableKey, name, subject, body, bodyEn) VALUES (?, ?, ?, ?, ?)').run(key, key, 's', body, bodyEn);
  }
  return memory;
}
const stored = (memory, key) => memory.prepare('SELECT body, bodyEn FROM email_templates WHERE stableKey = ?').get(key);

test('rule 59: under a rollback the default templates drop the sentence whole — no « valable jusqu’au . »', () => {
  for (const key of LINK_KEYS) {
    for (const [column, lang] of SIDES) {
      const body = template(key)[column];
      const out = render(body, ...ROLLBACK);
      assert.doesNotMatch(out, /valable jusqu|valid until/, `${key} ${lang}`);
      assert.equal(out, render(withoutValidUntilSentence(body), ...ROLLBACK), `${key} ${lang}: the text as before rule 36, line for line`);
    }
  }
});

test('rule 59: with its date, the guest reads exactly what rule 36 wrote; without a link, the no-link branch alone', () => {
  for (const key of LINK_KEYS) {
    for (const [column, lang] of SIDES) {
      const body = template(key)[column];
      assert.equal(render(body, ...CURRENT), render(v1Form(body, lang), ...CURRENT), `${key} ${lang}`);
      const none = [{ paymentLink: '', paymentLinkValidUntil: '' }, { hasPaymentLink: false, hasPaymentLinkValidUntil: false }];
      assert.equal(render(body, ...none), render(withoutValidUntilSentence(body), ...none), `${key} ${lang}`);
    }
  }
});

test('rule 59: v2 moves the sentence of every v1-migrated default into its block, the text a new install gets', () => {
  const memory = templatesDb(LINK_KEYS.map((key) => [key, v1Form(template(key).body, 'fr'), v1Form(template(key).bodyEn, 'en')]));
  const logs = [];
  const result = runValidUntilBlockMigration(memory, { logger: { log: (line) => logs.push(line) } });
  assert.equal(result.updated, 10);
  assert.deepEqual(result.kept, []);
  for (const key of LINK_KEYS) {
    assert.deepEqual(stored(memory, key), { body: template(key).body, bodyEn: template(key).bodyEn }, key);
  }
  assert.ok(memory.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION_NAME_V2));
  assert.match(logs[0], /\[migration:link-valid-until-v2\] 10 template field\(s\)/);
});

test('rule 59: an older default v1 migrated is recognised too, and only the sentence moves', () => {
  for (const key of LINK_KEYS) {
    for (const [column, lang] of SIDES) assert.ok(MIGRATED_V1[key][lang].includes(hash(v1Form(template(key)[column], lang))), `${key} ${lang}`);
  }
  const older = v1Form(template('deposit_reminder').body, 'fr').replace('Contactez-nous pour le règlement.', 'Contactez-nous pour recevoir votre lien de paiement.');
  const moved = rollbackSafeValidUntil(older, 'fr');
  assert.ok(moved.includes(`{{paymentLink}}{{else}}Contactez-nous pour recevoir votre lien de paiement.{{/if}}{{#if hasPaymentLinkValidUntil}}\n${VALID_UNTIL_SENTENCE.fr}{{/if}}`));
  assert.equal(withoutValidUntilSentence(moved), withoutValidUntilSentence(older), 'nothing else rewritten');
});

test('rule 59: an operator-edited side keeps its text and is named in the log, per side', () => {
  const t = template('deposit_request');
  const edited = `${v1Form(t.body, 'fr')}\nMerci !`;
  const memory = templatesDb([['deposit_request', edited, v1Form(t.bodyEn, 'en')]]);
  const logs = [];
  const result = runValidUntilBlockMigration(memory, { logger: { log: (line) => logs.push(line) } });
  assert.deepEqual(stored(memory, 'deposit_request'), { body: edited, bodyEn: t.bodyEn });
  assert.equal(result.updated, 1);
  assert.deepEqual(result.kept, ['deposit_request (fr)']);
  assert.match(logs[0], /edited, left as they are: deposit_request \(fr\)/);
});

test('rule 59: a side without the sentence, or already in the block form, is left alone and not reported', () => {
  const t = template('full_request');
  const memory = templatesDb([['full_request', withoutValidUntilSentence(t.body), t.bodyEn]]);
  const result = runValidUntilBlockMigration(memory, { logger: quiet });
  assert.deepEqual(result, { ran: true, updated: 0, kept: [] });
  assert.deepEqual(stored(memory, 'full_request'), { body: withoutValidUntilSentence(t.body), bodyEn: t.bodyEn });
});

test('rule 59: v2 runs once, and is idempotent on its own output', () => {
  const t = template('balance_request');
  const memory = templatesDb([['balance_request', v1Form(t.body, 'fr'), v1Form(t.bodyEn, 'en')]]);
  assert.equal(runValidUntilBlockMigration(memory, { logger: quiet }).updated, 2);
  assert.equal(runValidUntilBlockMigration(memory, { logger: quiet }).ran, false);
  memory.prepare('DELETE FROM migrations WHERE name = ?').run(MIGRATION_NAME_V2);
  assert.equal(runValidUntilBlockMigration(memory, { logger: quiet }).updated, 0, 'the block form is never rewritten');
  assert.deepEqual(stored(memory, 'balance_request'), { body: t.body, bodyEn: t.bodyEn });
});

test('rule 59: an install that never ran v1 gets both at one boot; a fresh install has nothing to move', () => {
  const pre = templatesDb(LINK_KEYS.map((key) => [key, withoutValidUntilSentence(template(key).body), withoutValidUntilSentence(template(key).bodyEn)]));
  runValidUntilSentenceMigration(pre, { logger: quiet });
  runValidUntilBlockMigration(pre, { logger: quiet });
  for (const key of LINK_KEYS) assert.deepEqual(stored(pre, key), { body: template(key).body, bodyEn: template(key).bodyEn }, key);
  const fresh = templatesDb(LINK_KEYS.map((key) => [key, template(key).body, template(key).bodyEn]));
  assert.equal(runValidUntilSentenceMigration(fresh, { logger: quiet }).updated, 0);
  assert.deepEqual(runValidUntilBlockMigration(fresh, { logger: quiet }), { ran: true, updated: 0, kept: [] });
});

test('rule 59: the boot runs v2 after v1', () => {
  const db = require('../database');
  const names = db.prepare("SELECT name FROM migrations WHERE name LIKE 'payment_link_valid_until_sentence_%' ORDER BY rowid").all().map((r) => r.name);
  assert.deepEqual(names, ['payment_link_valid_until_sentence_v1', MIGRATION_NAME_V2]);
});

test('rule 59: the acompte reminder still reads well without a link, so it stays the no-provider draft', () => {
  const t = template('deposit_reminder');
  assert.equal(draftTemplateFor([{ ...t, id: 7, enabled: 1 }], 'deposit', true), 7);
  const outside = { ...t, id: 8, enabled: 1, body: `${t.body}\nValable jusqu’au {{paymentLinkValidUntil}}.` };
  assert.equal(draftTemplateFor([outside], 'deposit', true), null);
});
