// specs/terms-acceptance-record.md §3.1 — the CGV draft, its publication and what the page shows:
// numbering, immutability of published versions, publication blocked by unknown variables / empty text
// / nothing new, the stale-facts warning, and the fiche block (rules 21-22).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const termsModelModule = require('../models/termsModel');
const settingsModelModule = require('../models/settingsModel');
const termsController = require('../controllers/termsController');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function freshDeps() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.exec('ALTER TABLE app_settings ADD COLUMN requireTermsAcceptance INTEGER NOT NULL DEFAULT 1');
  db.exec("ALTER TABLE app_settings ADD COLUMN lastSeenPluginVersion TEXT DEFAULT ''");
  db.prepare("INSERT INTO app_settings (id, companyName, companySiret) VALUES (1, 'SAS Solio', '912')").run();
  db.prepare("INSERT INTO properties (id, name, defaultCautionAmount) VALUES (1, 'La Granja', 500)").run();
  return { db, termsModel: termsModelModule.create(db), settingsModel: settingsModelModule.create(db) };
}

const FR = '## Conditions\n\nExploité par {{raisonSociale}} ({{siret}}).\n\n{{cautions}}';
const EN = '## Terms\n\nRun by {{raisonSociale}}.';

test('an empty draft cannot be published — both languages are required', () => {
  const deps = freshDeps();
  deps.termsModel.saveDraft({ fr: FR, en: '' });
  const o = termsController.buildOverview(deps);
  assert.equal(o.canPublish, false);
  assert.match(o.publishBlockedReason, /obligatoires/);
  assert.equal(termsController.publishDraft(deps).status, 422);
});

test('an unknown variable blocks publication and is named', () => {
  const deps = freshDeps();
  deps.termsModel.saveDraft({ fr: `${FR}\n{{penalite}}`, en: EN });
  const r = termsController.publishDraft(deps);
  assert.equal(r.status, 422);
  assert.match(r.error, /\{\{penalite\}\}/);
  assert.equal(deps.termsModel.getCurrent(), null);
});

test('publishing freezes version 1 with resolved variables, sanitised HTML and its hash', () => {
  const deps = freshDeps();
  deps.termsModel.saveDraft({ fr: FR, en: EN });
  const { version } = termsController.publishDraft(deps, { now: new Date('2026-09-22T08:00:00Z'), userId: null });
  assert.equal(version.version, 1);
  assert.match(version.htmlFr, /SAS Solio \(912\)/);
  assert.match(version.htmlFr, /<li>La Granja : 500 €<\/li>/);
  assert.match(version.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(version.publishedAt, '2026-09-22T08:00:00.000Z');
  assert.equal(JSON.parse(version.variablesJson).raisonSociale, 'SAS Solio');
});

test('publishing the same text twice is refused — nothing new since version N', () => {
  const deps = freshDeps();
  deps.termsModel.saveDraft({ fr: FR, en: EN });
  termsController.publishDraft(deps);
  const again = termsController.publishDraft(deps);
  assert.equal(again.status, 422);
  assert.match(again.error, /version 1/);
});

test('a new text gets the next number; the previous version is untouched', () => {
  const deps = freshDeps();
  deps.termsModel.saveDraft({ fr: FR, en: EN });
  const v1 = termsController.publishDraft(deps).version;
  deps.termsModel.saveDraft({ fr: `${FR}\n\nArticle 7.`, en: EN });
  const v2 = termsController.publishDraft(deps).version;
  assert.equal(v2.version, 2);
  assert.deepEqual(deps.termsModel.getByVersion(1), v1);
  assert.equal(deps.termsModel.getCurrent().version, 2);
});

test('a fact changed after publication → stale warning, published HTML unchanged, republish allowed', () => {
  const deps = freshDeps();
  deps.termsModel.saveDraft({ fr: FR, en: EN });
  const v1 = termsController.publishDraft(deps).version;
  deps.db.prepare('UPDATE properties SET defaultCautionAmount = 600 WHERE id = 1').run();
  const o = termsController.buildOverview(deps);
  assert.deepEqual(o.staleVariables, ['cautions']);
  assert.equal(o.canPublish, true, 'same Markdown, different rendering → a new version is allowed');
  assert.equal(deps.termsModel.getByVersion(1).htmlFr, v1.htmlFr);
});

test('a fact the text does not quote never raises the stale warning', () => {
  const deps = freshDeps();
  deps.termsModel.saveDraft({ fr: 'Texte sans variable.', en: 'No variable.' });
  termsController.publishDraft(deps);
  deps.db.prepare("UPDATE app_settings SET companyName = 'Autre' WHERE id = 1").run();
  assert.deepEqual(termsController.buildOverview(deps).staleVariables, []);
});

test('the overview lists versions newest first with their acceptance count', () => {
  const deps = freshDeps();
  deps.termsModel.saveDraft({ fr: FR, en: EN });
  const v1 = termsController.publishDraft(deps).version;
  deps.db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'C', 'M')").run();
  deps.db.prepare("INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, requestOrigin) VALUES (5, 1, 1, '2026-10-12', '2026-10-15', 'public')").run();
  deps.termsModel.insertAcceptance({ reservationId: 5, termsVersionId: v1.id, version: 1, acceptedAt: '2026-09-22T12:32:07.120Z', ip: '86.1.2.3' });
  deps.termsModel.saveDraft({ fr: `${FR}\nX`, en: EN });
  termsController.publishDraft(deps);
  const o = termsController.buildOverview(deps);
  assert.deepEqual(o.versions.map((v) => [v.version, v.acceptanceCount]), [[2, 0], [1, 1]]);
  assert.equal(o.nextVersion, 3);
  assert.equal(o.requireTermsAcceptance, true);
});

test('fiche block — recorded (Paris time), missing, not applicable; history entry written', () => {
  const deps = freshDeps();
  deps.termsModel.saveDraft({ fr: FR, en: EN });
  const v1 = termsController.publishDraft(deps, { now: new Date('2026-09-01T10:00:00Z') }).version;
  deps.db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'C', 'M')").run();
  deps.db.prepare("INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, requestOrigin) VALUES (5, 1, 1, '2026-10-12', '2026-10-15', 'public')").run();
  deps.termsModel.insertAcceptance({
    reservationId: 5, termsVersionId: v1.id, version: 1, acceptedAt: '2026-09-21T12:32:07.120Z',
    ip: '86.242.17.203', userAgent: 'Mozilla/5.0', pluginVersion: '1.8.0',
  });
  const recorded = termsController.buildFicheBlock({ id: 5, requestOrigin: 'public' }, deps);
  assert.equal(recorded.termsAcceptanceState, 'recorded');
  assert.equal(recorded.termsAcceptance.acceptedAtLabel, '21/09/2026 à 14:32:07');
  assert.equal(recorded.termsAcceptance.version, 1);
  assert.equal(recorded.termsAcceptance.versionPublishedAtLabel, '01/09/2026');
  assert.equal(recorded.termsAcceptance.ip, '86.242.17.203');

  assert.equal(termsController.buildFicheBlock({ id: 6, requestOrigin: 'public' }, deps).termsAcceptanceState, 'missing');
  assert.equal(termsController.buildFicheBlock({ id: 7, requestOrigin: null }, deps).termsAcceptanceState, 'not_applicable');

  const history = deps.db.prepare('SELECT eventType, changedFields FROM reservation_history WHERE reservationId = 5').all();
  assert.equal(history.length, 1);
  assert.equal(history[0].eventType, 'terms_accepted');
  assert.match(history[0].changedFields, /Version 1 acceptée/);
});

test('deleting the reservation deletes its acceptance, never the version', () => {
  const deps = freshDeps();
  deps.db.pragma('foreign_keys = ON');
  deps.termsModel.saveDraft({ fr: FR, en: EN });
  const v1 = termsController.publishDraft(deps).version;
  deps.db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'C', 'M')").run();
  deps.db.prepare("INSERT INTO reservations (id, propertyId, clientId, startDate, endDate, requestOrigin) VALUES (5, 1, 1, '2026-10-12', '2026-10-15', 'public')").run();
  deps.termsModel.insertAcceptance({ reservationId: 5, termsVersionId: v1.id, version: 1, acceptedAt: '2026-09-21T12:32:07.120Z' });
  deps.db.prepare('DELETE FROM reservations WHERE id = 5').run();
  assert.equal(deps.db.prepare('SELECT COUNT(*) AS n FROM terms_acceptances').get().n, 0);
  assert.ok(deps.termsModel.getByVersion(1));
});

test('rule 18 — plugin version comparison drives the outdated-plugin warning', () => {
  assert.equal(termsController.isVersionBelow('1.7.0', '1.8.0'), true);
  assert.equal(termsController.isVersionBelow('1.8.0', '1.8.0'), false);
  assert.equal(termsController.isVersionBelow('1.10.0', '1.8.0'), false);
  assert.equal(termsController.isVersionBelow('0.9.9', '1.8.0'), true);
  const deps = freshDeps();
  assert.equal(termsController.buildOverview(deps).pluginOutdated, false, 'never seen → no warning');
  deps.settingsModel.upsert({ lastSeenPluginVersion: '1.7.0' });
  assert.equal(termsController.buildOverview(deps).pluginOutdated, true);
});
