// specs/gift-vouchers/gift-voucher-campaigns.md rules 37-38 — the core terms (CGV) are one document per activity: the migration keeps every row as
// `lodging`; each activity has its own draft and its own numbering; the public read takes `?activity=`; an acceptance names its subject
// (reservation, voucher order, outside booking) and channel, `reservationId` being optional; the refusal codes are unchanged; the seeded
// draft of a plugin's activity is written once and never published.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const registry = require('../plugins/sdk/registry');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const { createContext } = require('../plugins/sdk/createContext');
const termsModelModule = require('../models/termsModel');
const termsController = require('../controllers/termsController');
const termsActivities = require('../utils/termsActivities');
const { requireAccepted } = require('../utils/termsAcceptance');
const { migrateTermsPerActivity } = require('../utils/termsPerActivityMigration');
const publicTerms = optionalPlugin(() => require('../plugins/website-booking/controllers/publicTermsController'));
const termsSeed = optionalPlugin(() => require('../plugins/hourly-resources/termsSeed'));
// The plugins this suite reads are shipped in the repository; a tree without one skips what needs it.
const needsWebsite = { skip: skipWithout(['website-booking']) };
const needsHourly = { skip: skipWithout(['hourly-resources']) };

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

registry.reset();
registry.configure({ isActive: () => true, allows: () => true });
createContext('hourly-resources', {}).termsActivity({ key: 'resource', label: 'Bain nordique et activités', ...(termsSeed.fr ? { seed: termsSeed } : {}) });

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'La Granja')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'C', 'M')").run();
  db.prepare("INSERT INTO reservations (id, propertyId, clientId, startDate, endDate) VALUES (10, 1, 1, '2026-10-01', '2026-10-03'), (11, 1, 1, '2026-11-01', '2026-11-03')").run(); // date-literal-ok: the suite runs on its own clock, never the real today
  return db;
}

const version = (n, extra = {}) => ({
  markdownFr: `fr ${n}`, markdownEn: `en ${n}`, htmlFr: `<p>fr ${n}</p>`, htmlEn: `<p>en ${n}</p>`, variables: {}, contentHash: `h${n}`, publishedAt: '2026-11-01T10:00:00.000Z', ...extra, // date-literal-ok: the suite runs on its own clock, never the real today
});

test('migration: the single-document tables are rebuilt, every row kept as the lodging activity, ids and acceptances intact', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE reservations (id INTEGER PRIMARY KEY);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE terms_draft (id INTEGER PRIMARY KEY CHECK (id = 1), markdownFr TEXT NOT NULL DEFAULT '', markdownEn TEXT NOT NULL DEFAULT '', updatedAt TEXT);
    CREATE TABLE terms_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL UNIQUE, markdownFr TEXT NOT NULL, markdownEn TEXT NOT NULL,
      htmlFr TEXT NOT NULL, htmlEn TEXT NOT NULL, variablesJson TEXT NOT NULL, contentHash TEXT NOT NULL, publishedAt TEXT NOT NULL,
      publishedBy INTEGER REFERENCES users(id) ON DELETE SET NULL);
    CREATE TABLE terms_acceptances (id INTEGER PRIMARY KEY AUTOINCREMENT, reservationId INTEGER NOT NULL, termsVersionId INTEGER NOT NULL, acceptedAt TEXT NOT NULL,
      ip TEXT, userAgent TEXT, pluginVersion TEXT, FOREIGN KEY (reservationId) REFERENCES reservations(id) ON DELETE CASCADE,
      FOREIGN KEY (termsVersionId) REFERENCES terms_versions(id));
    CREATE INDEX idx_terms_acceptances_reservation ON terms_acceptances (reservationId);
    INSERT INTO reservations (id) VALUES (10), (11);
    INSERT INTO terms_draft (id, markdownFr, markdownEn, updatedAt) VALUES (1, 'brouillon', 'draft', '2026-10-01'); -- date-literal-ok: rows of an old database, never compared with today
    INSERT INTO terms_versions (id, version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt)
      VALUES (4, 1, 'a', 'a', '<p>a</p>', '<p>a</p>', '{}', 'h1', '2026-09-01'), (7, 2, 'b', 'b', '<p>b</p>', '<p>b</p>', '{}', 'h2', '2026-10-01'); -- date-literal-ok: rows of an old database, never compared with today
    INSERT INTO terms_acceptances (id, reservationId, termsVersionId, acceptedAt, ip, userAgent, pluginVersion) VALUES (3, 10, 4, '2026-09-02', '203.0.113.7', 'UA', '1.2.3'), (5, 11, 7, '2026-10-02', NULL, NULL, NULL); -- date-literal-ok: rows of an old database, never compared with today
  `);
  assert.equal(migrateTermsPerActivity(db), true);
  assert.deepEqual(db.prepare('SELECT id, activity, markdownFr, updatedAt FROM terms_draft').all(), [{ id: 1, activity: 'lodging', markdownFr: 'brouillon', updatedAt: '2026-10-01' }]); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.deepEqual(db.prepare('SELECT id, activity, version, contentHash FROM terms_versions ORDER BY id').all(), [
    { id: 4, activity: 'lodging', version: 1, contentHash: 'h1' }, { id: 7, activity: 'lodging', version: 2, contentHash: 'h2' },
  ]);
  assert.deepEqual(db.prepare('SELECT id, reservationId, termsVersionId, ip, pluginVersion, activity, subjectType, subjectRef, channel FROM terms_acceptances ORDER BY id').all(), [
    {
      id: 3, reservationId: 10, termsVersionId: 4, ip: '203.0.113.7', pluginVersion: '1.2.3', activity: 'lodging', subjectType: 'reservation', subjectRef: '10', channel: 'site',
    },
    {
      id: 5, reservationId: 11, termsVersionId: 7, ip: null, pluginVersion: null, activity: 'lodging', subjectType: 'reservation', subjectRef: '11', channel: 'site',
    },
  ]);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  // Version numbers are unique per activity now, and an acceptance may belong to no reservation.
  db.prepare("INSERT INTO terms_versions (activity, version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt) VALUES ('resource', 1, 'x', 'x', 'x', 'x', '{}', 'r1', '2026-11-01')").run(); // date-literal-ok: the suite runs on its own clock, never the real today
  assert.throws(() => db.prepare("INSERT INTO terms_versions (activity, version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt) VALUES ('lodging', 2, 'x', 'x', 'x', 'x', '{}', 'dup', '2026-11-01')").run(), /UNIQUE/); // date-literal-ok: the suite runs on its own clock, never the real today
  db.prepare("INSERT INTO terms_acceptances (reservationId, termsVersionId, acceptedAt, activity, subjectType, subjectRef, channel) VALUES (NULL, 8, '2026-11-02', 'resource', 'voucherOrder', '55', 'site')").run(); // date-literal-ok: the suite runs on its own clock, never the real today
  // The old model still reads what it used to: the draft keeps its id, and a re-run changes nothing.
  assert.equal(db.prepare('SELECT markdownFr FROM terms_draft WHERE id = 1').get().markdownFr, 'brouillon');
  assert.equal(migrateTermsPerActivity(db), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM terms_acceptances').get().n, 3);
});

test('a fresh database has the per-activity shape, and the boot database migrated to it', () => {
  const core = require('../database');
  for (const [table, column] of [['terms_draft', 'activity'], ['terms_versions', 'activity'], ['terms_acceptances', 'subjectType'], ['terms_acceptances', 'channel']]) {
    assert.ok(core.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column), `${table}.${column}`);
  }
  assert.equal(core.prepare('PRAGMA table_info(terms_acceptances)').all().find((c) => c.name === 'reservationId').notnull, 0);
});

test('drafts and version numbers are kept per activity', () => {
  const model = termsModelModule.create(freshDb());
  model.saveDraft({ fr: 'hébergement', en: 'lodging' });
  model.saveDraft({ fr: 'bain', en: 'bath', activity: 'resource' });
  assert.equal(model.getDraft().markdownFr, 'hébergement');
  assert.equal(model.getDraft('resource').markdownEn, 'bath');
  assert.equal(model.hasDraft('other'), false);
  assert.equal(model.publishVersion(version(1)).version, 1);
  assert.equal(model.publishVersion(version(1, { activity: 'resource' })).version, 1);
  assert.equal(model.publishVersion(version(2, { activity: 'resource' })).version, 2);
  assert.equal(model.publishVersion(version(2)).version, 2);
  assert.equal(model.getCurrent('resource').markdownFr, 'fr 2');
  assert.equal(model.getByVersion(1, 'resource').markdownFr, 'fr 1');
  assert.deepEqual(model.listVersionsWithCounts('resource').map((v) => v.version), [2, 1]);
});

test('the admin overview, save and publish take the activity; an unknown one is refused', () => {
  const overview = (activity) => { const res = fakeRes(); termsController.getOverview({ query: { activity } }, res); return res; };
  assert.equal(overview('resource').body.activity, 'resource');
  assert.equal(overview(undefined).body.activity, 'lodging');
  assert.equal(overview('nope').statusCode, 404);
  const save = fakeRes();
  termsController.saveDraft({ body: { activity: 'resource', fr: 'a', en: 'b' } }, save);
  assert.deepEqual([save.body.activity, save.body.draft.fr], ['resource', 'a']);
  const list = fakeRes();
  termsController.listActivities({}, list);
  assert.deepEqual(list.body.activities.map((a) => a.key), ['lodging', 'resource']);
  assert.equal(list.body.activities[1].label, 'Bain nordique et activités');
});

function fakeRes() {
  return {
    statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; },
  };
}

test('the public read takes ?activity=, the lodging by default', needsWebsite, () => {
  const model = require('../models/termsModel');
  model.publishVersion(version(1, { activity: 'lodging', htmlFr: '<p>location</p>' }));
  model.publishVersion(version(9, { activity: 'resource', htmlFr: '<p>bain</p>' }));
  const read = (query) => { const res = fakeRes(); publicTerms.getCurrent({ query, headers: {} }, res); return res; };
  assert.equal(read({}).body.data.html.fr, '<p>location</p>');
  assert.equal(read({ activity: 'resource' }).body.data.html.fr, '<p>bain</p>');
  assert.equal(read({ activity: 'ghost' }).statusCode, 404);
  const byVersion = (query) => { const res = fakeRes(); publicTerms.getVersion({ params: { version: '1' }, query, headers: {} }, res); return res; };
  assert.equal(byVersion({ activity: 'resource' }).body.data.html.fr, '<p>bain</p>');
  assert.equal(byVersion({}).body.data.html.fr, '<p>location</p>');
});

test('an acceptance names its subject and channel: a reservation writes its history, other subjects call onAccepted', () => {
  const db = freshDb();
  const model = termsModelModule.create(db);
  const v = model.publishVersion(version(1, { activity: 'resource' }));
  const base = { termsVersionId: v.id, version: 1, acceptedAt: '2026-11-18T09:00:00.000Z', activity: 'resource', ip: '203.0.113.9', userAgent: 'UA' }; // date-literal-ok: the suite runs on its own clock, never the real today

  model.insertAcceptance({
    ...base, reservationId: 10, subjectType: 'reservation', channel: 'guest-app', historyLabel: 'Conditions générales — Bain',
  });
  const history = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = 10 AND eventType = 'terms_accepted'").all();
  assert.equal(JSON.parse(history[0].changedFields)[0].to, 'Version 1 acceptée');
  assert.equal(JSON.parse(history[0].changedFields)[0].label, 'Conditions générales — Bain');

  const seen = [];
  model.insertAcceptance({
    ...base, subjectType: 'voucherOrder', subjectRef: 'order-7', channel: 'site', onAccepted: (row) => seen.push(row),
  });
  model.insertAcceptance({
    ...base, subjectType: 'outsideBooking', subjectRef: '31', channel: 'mon-bain', reservationId: null,
  });
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].subjectType, seen[0].subjectRef, seen[0].reservationId], ['voucherOrder', 'order-7', null]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM reservation_history WHERE eventType = 'terms_accepted'").get().n, 1, 'only a reservation has its history written by the core');
  const rows = db.prepare('SELECT subjectType, subjectRef, channel, reservationId FROM terms_acceptances ORDER BY id').all();
  assert.deepEqual(rows.map((r) => [r.subjectType, r.subjectRef, r.channel, r.reservationId]), [
    ['reservation', '10', 'guest-app', 10], ['voucherOrder', 'order-7', 'site', null], ['outsideBooking', '31', 'mon-bain', null],
  ]);
  assert.equal(model.findAcceptanceBySubject({ activity: 'resource', subjectType: 'voucherOrder', subjectRef: 'order-7' }).termsVersionId, v.id);
  assert.equal(model.findAcceptanceByReservation(10, 'resource').channel, 'guest-app');
  assert.equal(model.findAcceptanceByReservation(10), null, 'the lodging terms are another activity');
  assert.equal(model.listOtherAcceptancesByReservation(10).length, 1);
  assert.throws(() => model.insertAcceptance({ ...base, subjectType: 'reservation' }), /TERMS_ACCEPTANCE_NEEDS_RESERVATION/);
});

test('the existing lodging writer is unchanged: reservation, site, history', () => {
  const db = freshDb();
  const model = termsModelModule.create(db);
  const v = model.publishVersion(version(1));
  model.insertAcceptance({ reservationId: 11, termsVersionId: v.id, version: 1, acceptedAt: '2026-11-18T09:00:00.000Z' }); // date-literal-ok: the suite runs on its own clock, never the real today
  const a = model.findAcceptanceByReservation(11);
  assert.deepEqual([a.activity, a.subjectType, a.subjectRef, a.channel], ['lodging', 'reservation', '11', 'site']);
});

test('refusals keep their codes: nothing published asks nothing, none sent is NOT_ACCEPTED, another version is OUTDATED, an accepted one passes', () => {
  const model = termsModelModule.create(freshDb());
  const deps = { termsModel: model };
  const owed = (versionId) => requireAccepted({ activity: 'resource', versionId, subjectType: 'voucherOrder', subjectRef: 'o1' }, deps);
  assert.equal(owed(undefined), null);
  const v1 = model.publishVersion(version(1, { activity: 'resource' }));
  assert.equal(owed(undefined), 'TERMS_NOT_ACCEPTED');
  assert.equal(owed(v1.id + 100), 'TERMS_OUTDATED');
  assert.equal(owed(v1.id), null);
  model.insertAcceptance({
    activity: 'resource', subjectType: 'voucherOrder', subjectRef: 'o1', termsVersionId: v1.id, version: 1, acceptedAt: '2026-11-18T09:00:00.000Z', channel: 'site', // date-literal-ok: the suite runs on its own clock, never the real today
  });
  assert.equal(owed(undefined), null, 'already accepted for the current version');
  const v2 = model.publishVersion(version(2, { activity: 'resource' }));
  assert.equal(owed(undefined), 'TERMS_NOT_ACCEPTED', 'a new version is asked again');
  assert.equal(owed(v2.id), null);
});

test('ctx.terms: current, requireAccepted and accept, over the core model', () => {
  const ctx = createContext('probe-terms', {});
  const model = require('../models/termsModel');
  const ctxSdk = ctx.terms;
  assert.equal(ctxSdk.current('probe'), null);
  const v = model.publishVersion(version(1, { activity: 'probe' }));
  assert.deepEqual(ctxSdk.current('probe'), { id: v.id, version: 1, publishedAt: '2026-11-01T10:00:00.000Z' }); // date-literal-ok: the suite runs on its own clock, never the real today
  const subject = { activity: 'probe', subjectType: 'voucherOrder', subjectRef: 'z9' };
  assert.equal(ctxSdk.requireAccepted(subject), 'TERMS_NOT_ACCEPTED');
  assert.throws(() => ctxSdk.accept({ ...subject, versionId: v.id + 1, channel: 'site' }), (e) => e.code === 'TERMS_OUTDATED');
  assert.throws(() => ctxSdk.accept({ ...subject, versionId: v.id, channel: 'telepathy' }), /unknown channel/);
  assert.throws(() => ctxSdk.accept({ ...subject, subjectType: 'dream', versionId: v.id, channel: 'site' }), /unknown subjectType/);
  const done = [];
  ctxSdk.accept({
    ...subject, versionId: v.id, channel: 'payment-link', ip: '203.0.113.1', userAgent: 'UA', onAccepted: (row) => done.push(row),
  });
  assert.equal(done[0].channel, 'payment-link');
  assert.equal(ctxSdk.requireAccepted(subject), null);
});

test('ctx.termsActivity validates what a plugin declares', () => {
  const ctx = createContext('probe-declare', {});
  assert.throws(() => ctx.termsActivity({ key: 'lodging', label: 'x' }), /core's/);
  assert.throws(() => ctx.termsActivity({ key: 'Bad Key', label: 'x' }), /needs a key/);
  assert.throws(() => ctx.termsActivity({ key: 'ok-key', label: ' ' }), /needs a label/);
  assert.throws(() => ctx.termsActivity({ key: 'ok-key', label: 'x', seed: { fr: 'a' } }), /seed needs fr and en/);
  assert.throws(() => ctx.termsActivity({ key: 'resource', label: 'dup' }), /already declared by hourly-resources/);
});

test('the seeded draft of a plugin activity is written once, from both languages, and never published', needsHourly, () => {
  const model = termsModelModule.create(freshDb());
  assert.equal(model.hasDraft('resource'), false);
  termsActivities.seedDrafts(model);
  const draft = model.getDraft('resource');
  assert.match(draft.markdownFr, /^### 1\. Objet/);
  assert.match(draft.markdownFr, /### 12\. Réclamations et droit applicable/);
  assert.match(draft.markdownEn, /^### 1\. Purpose/);
  assert.match(draft.markdownEn, /### 12\. Complaints and applicable law/);
  assert.equal((draft.markdownFr.match(/^### /gm) || []).length, 12);
  assert.equal((draft.markdownEn.match(/^### /gm) || []).length, 12);
  assert.equal(model.getCurrent('resource'), null, 'a draft only');
  assert.equal(model.hasDraft('lodging'), false, 'the core activity is never seeded');
  // The operator empties it: it stays as he left it.
  model.saveDraft({ fr: '', en: '', activity: 'resource' });
  termsActivities.seedDrafts(model);
  assert.equal(model.getDraft('resource').markdownFr, '');
});

test('an activity of a plugin that is off is not listed nor resolved', () => {
  registry.configure({ isActive: (id) => id !== 'hourly-resources', allows: () => true });
  try {
    assert.deepEqual(termsActivities.list().map((a) => a.key), ['lodging']);
    assert.equal(termsActivities.resolve('resource'), null);
    assert.equal(termsActivities.resolve(undefined), 'lodging');
  } finally {
    registry.configure({ isActive: () => true, allows: () => true });
  }
});

test('the fiche block lists the other activities\' acceptances of the reservation', () => {
  const db = freshDb();
  const model = termsModelModule.create(db);
  const v = model.publishVersion(version(1, { activity: 'resource' }));
  model.insertAcceptance({
    reservationId: 10, activity: 'resource', termsVersionId: v.id, version: 1, acceptedAt: '2026-11-18T09:00:00.000Z', channel: 'guest-app', // date-literal-ok: the suite runs on its own clock, never the real today
  });
  const block = termsController.buildFicheBlock({ id: 10, requestOrigin: 'back-office' }, { termsModel: model });
  assert.equal(block.termsAcceptanceState, 'not_applicable');
  assert.deepEqual(block.activityAcceptances.map((a) => [a.activity, a.label, a.channelLabel, a.version]), [['resource', 'Bain nordique et activités', 'appli séjour', 1]]);
  assert.equal(termsController.buildFicheBlock({ id: 11, requestOrigin: 'back-office' }, { termsModel: model }).activityAcceptances.length, 0);
});
