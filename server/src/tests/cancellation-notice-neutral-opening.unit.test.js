// specs/payment-schedule-and-cancellation.md rule 63 (audit R45-DB-L2) — the seeded cancellation notice opened with
// « Faute de règlement du solde, … » (« As the balance was not paid, … ») for every cancellation: a guest who paid in
// full and phoned to cancel was told in writing the stay was cancelled for non-payment. The seed opens neutral, and the
// one-shot `cancellation_notice_neutral_opening_v1` rewrites that exact seeded sentence in a stored body, never a body
// the operator reworded, never the send mode or the enabled flag.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../database');
const { DEFAULT_TEMPLATES } = require('../utils/defaultEmailTemplatesRegistry');
const { runCancellationNoticeNeutralOpeningMigration } = require('../utils/migrateCancellationNoticeNeutralOpening');

const OLD_FR = 'Faute de règlement du solde, nous avons le regret de vous informer que votre séjour {{propertyWithArticle}} est annulé.';
const OLD_EN = 'As the balance was not paid, we are sorry to inform you that your stay at {{propertyWithArticle}} has been cancelled.';
const NEW_FR = 'Nous avons le regret de vous informer que votre séjour {{propertyWithArticle}} est annulé.';
const NEW_EN = 'We are sorry to inform you that your stay at {{propertyWithArticle}} has been cancelled.';

const seeded = DEFAULT_TEMPLATES.find((t) => t.stableKey === 'cancellation_notice');
const stored = () => db.prepare("SELECT id, body, bodyEn, sendMode, enabled FROM email_templates WHERE stableKey = 'cancellation_notice'").get();

test('rule 63 — the seeded notice gives no reason for the cancellation, in French and in English', () => {
  assert.ok(seeded.body.includes(NEW_FR));
  assert.ok(seeded.bodyEn.includes(NEW_EN));
  assert.doesNotMatch(seeded.body, /règlement|impayé/i);
  assert.doesNotMatch(seeded.bodyEn, /not paid|unpaid/i);
});

test('rule 63 — a fresh install stores the neutral opening and records the one-shot', () => {
  const row = stored();
  assert.ok(row.body.includes(NEW_FR));
  assert.ok(row.bodyEn.includes(NEW_EN));
  assert.ok(db.prepare("SELECT 1 FROM migrations WHERE name = 'cancellation_notice_neutral_opening_v1'").get());
});

test('rule 63 — the one-shot rewrites the exact seeded sentence only, never the send mode', () => {
  const row = stored();
  db.prepare("UPDATE email_templates SET body = ?, bodyEn = ?, sendMode = 'auto', enabled = 0 WHERE id = ?")
    .run(`Bonjour,\n\n${OLD_FR}\n\nFin.`, `Hello,\n\n${OLD_EN}\n\nEnd.`, row.id);
  assert.equal(runCancellationNoticeNeutralOpeningMigration(db), 2);
  const after = stored();
  assert.equal(after.body, `Bonjour,\n\n${NEW_FR}\n\nFin.`);
  assert.equal(after.bodyEn, `Hello,\n\n${NEW_EN}\n\nEnd.`);
  assert.equal(after.sendMode, 'auto', 'the send mode is the operator\'s');
  assert.equal(after.enabled, 0);
  assert.equal(runCancellationNoticeNeutralOpeningMigration(db), 0, 'a second run changes nothing');

  const reworded = 'Faute de règlement du solde à la date convenue, votre séjour est annulé.';
  db.prepare('UPDATE email_templates SET body = ?, bodyEn = NULL WHERE id = ?').run(reworded, row.id);
  assert.equal(runCancellationNoticeNeutralOpeningMigration(db), 0);
  assert.equal(stored().body, reworded, 'a body the operator reworded is left as it is');
  db.prepare('UPDATE email_templates SET body = ?, bodyEn = ?, sendMode = ?, enabled = ? WHERE id = ?')
    .run(row.body, row.bodyEn, row.sendMode, row.enabled, row.id);
});
