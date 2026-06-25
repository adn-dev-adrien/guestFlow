// emailLogModel CRUD + pending join + history pagination. See specs/email-automation.md §4.1.

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { buildModel } = require('../models/emailLogModel');

const DDL = `
  CREATE TABLE email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, stableKey TEXT UNIQUE, name TEXT NOT NULL,
    subject TEXT NOT NULL, body TEXT NOT NULL, dayOffset INTEGER NOT NULL,
    sendMode TEXT NOT NULL DEFAULT 'manual', enabled INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    templateId INTEGER, reservationId INTEGER NOT NULL,
    sentAt TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'smtp', errorMessage TEXT DEFAULT '',
    renderedSubject TEXT NOT NULL, renderedBody TEXT NOT NULL, recipientEmail TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'reservation',
    clientId INTEGER, propertyId INTEGER, startDate TEXT, endDate TEXT
  );
  CREATE TABLE clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firstName TEXT, lastName TEXT, email TEXT);
  CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
`;

function fresh() {
  const db = new Database(':memory:');
  db.exec(DDL);
  return { db, model: buildModel(db) };
}

function seedFixture(db) {
  // 2 templates (1 manual, 1 auto), 3 reservations matching a J-7 today=2026-06-10.
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Jane', 'Smith', 'jane@s.com'), (2, 'Marc', 'Petit', 'marc@p.fr'), (3, 'No', 'Email', '')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A'), (2, 'Le Gîte')").run();
  db.prepare("INSERT INTO email_templates (id, stableKey, name, subject, body, dayOffset, sendMode, enabled) VALUES (10, 'arrival_reminder_7d', 'J-7', 'S', 'B', -7, 'manual', 1)").run();
  db.prepare("INSERT INTO email_templates (id, stableKey, name, subject, body, dayOffset, sendMode, enabled) VALUES (11, NULL, 'Auto J',  'S', 'B', -7, 'auto', 1)").run();
  // startDate = today + 7 → matches J-7 today=2026-06-10
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (100, 'reservation', 1, 1, '2026-06-17', '2026-06-20')").run();
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (101, 'reservation', 2, 2, '2026-06-17', '2026-06-20')").run();
  // No-email client — still surfaces in pending; UI flags the absence.
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (102, 'reservation', 3, 1, '2026-06-17', '2026-06-20')").run();
  // Devis — must be excluded by the pending query.
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (200, 'devis',       1, 1, '2026-06-17', '2026-06-20')").run();
}

// ---- insert ----

test('insert: persists status + rendered subject/body + recipient', () => {
  const { db, model } = fresh();
  const row = model.insert({
    templateId: 1, reservationId: 100, status: 'sent',
    renderedSubject: 'X', renderedBody: 'Y', recipientEmail: 'a@b.fr',
  });
  assert.equal(row.status, 'sent');
  assert.equal(row.recipientEmail, 'a@b.fr');
  assert.equal(row.renderedSubject, 'X');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_log').get().n, 1);
});

test('insert: errorMessage defaults to empty string', () => {
  const { model } = fresh();
  const row = model.insert({
    templateId: null, reservationId: 1, status: 'failed',
    renderedSubject: 'X', renderedBody: 'Y',
  });
  assert.equal(row.errorMessage, '');
});

// ---- existsFor ----

test('existsFor: matches by status set', () => {
  const { model } = fresh();
  model.insert({ templateId: 1, reservationId: 100, status: 'sent', renderedSubject: 'S', renderedBody: 'B' });
  assert.equal(model.existsFor(1, 100, ['sent']),                          true);
  assert.equal(model.existsFor(1, 100, ['acknowledged-skip']),             false);
  assert.equal(model.existsFor(1, 100, ['sent', 'acknowledged-skip']),     true);
  assert.equal(model.existsFor(1, 101, ['sent']),                          false);
});

test('existsFor: empty status list returns false (defensive)', () => {
  const { model } = fresh();
  model.insert({ templateId: 1, reservationId: 100, status: 'sent', renderedSubject: 'S', renderedBody: 'B' });
  assert.equal(model.existsFor(1, 100, []), false);
});

// ---- listPending ----

test('listPending: lists manual templates × matching reservations, excludes devis + already-sent', () => {
  const { db, model } = fresh();
  seedFixture(db);

  const today = '2026-06-10';
  const rows = model.listPending({ today });
  // J-7 manual template = id=10; matches reservations 100, 101, 102 (devis 200 excluded).
  const pairs = rows.map((r) => `${r.templateId}/${r.reservationId}`).sort();
  assert.deepEqual(pairs, ['10/100', '10/101', '10/102']);
  // Auto template 11 is NOT in pending (cron handles it).
  assert.ok(!rows.some((r) => r.templateId === 11));
  // clientId is surfaced so the UI can open the client fiche to fix a missing email.
  const row100 = rows.find((r) => r.reservationId === 100);
  assert.equal(row100.clientId, 1);
});

test('listPending: drops pairs already in sent/acknowledged-skip', () => {
  const { db, model } = fresh();
  seedFixture(db);
  model.insert({ templateId: 10, reservationId: 100, status: 'sent',                 renderedSubject: 'S', renderedBody: 'B' });
  model.insert({ templateId: 10, reservationId: 101, status: 'acknowledged-skip',    renderedSubject: 'S', renderedBody: 'B' });

  const rows = model.listPending({ today: '2026-06-10' });
  const pairs = rows.map((r) => `${r.templateId}/${r.reservationId}`);
  assert.deepEqual(pairs, ['10/102']);
});

test('listPending: includes past 7 days so a forgotten send still surfaces', () => {
  const { db, model } = fresh();
  seedFixture(db);
  // Today is 5 days after the original send date — pending must STILL list it.
  const rows = model.listPending({ today: '2026-06-15', lookbackDays: 7 });
  assert.equal(rows.length, 3);
});

test('listPending: a sendDate 8 days in the past with lookbackDays=7 is excluded', () => {
  const { db, model } = fresh();
  seedFixture(db);
  const rows = model.listPending({ today: '2026-06-18', lookbackDays: 7 });
  assert.equal(rows.length, 0);
});

test('listPending: a before-arrival reminder is NOT re-proposed once the guest has arrived (startDate in the past)', () => {
  // Regression (specs/email-automation.md §3 rule 8): the 7-day lookback used to keep re-proposing a
  // J-2 reminder for up to 5 days AFTER arrival (its sendDate stays in the window). Once startDate is
  // past, a before-or-on-arrival reminder must drop out.
  const { db, model } = fresh();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Nicolas', 'Vigier', 'nico@v.fr')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A')").run();
  db.prepare("INSERT INTO email_templates (id, stableKey, name, subject, body, dayOffset, sendMode, enabled) VALUES (20, 'arrival_reminder_1d', 'J-2', 'S', 'B', -2, 'manual', 1)").run();

  const today = '2026-06-15';
  // Arrived 3 days ago → J-2 sendDate = 2026-06-10, still inside the [2026-06-08, 2026-06-15] lookback.
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (110, 'reservation', 1, 1, '2026-06-12', '2026-06-14')").run();
  // Control: arrives tomorrow → J-2 sendDate = 2026-06-14, in window, startDate still future → kept.
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (111, 'reservation', 1, 1, '2026-06-16', '2026-06-18')").run();

  const rows = model.listPending({ today, lookbackDays: 7 });
  const reservationIds = rows.map((r) => r.reservationId);
  assert.ok(!reservationIds.includes(110), 'the past-arrival J-2 reminder is dropped');
  assert.ok(reservationIds.includes(111), 'the upcoming-arrival J-2 reminder is still listed');
});

test('listPending: a post-stay email (positive dayOffset) is kept even after arrival', () => {
  // Future-proofing rule 8: emails meant to fire AFTER arrival (e.g. a J+1 review request) must keep
  // surfacing for a past-startDate stay — the past-arrival guard only drops before/on-arrival reminders.
  const { db, model } = fresh();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Nicolas', 'Vigier', 'nico@v.fr')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A')").run();
  db.prepare("INSERT INTO email_templates (id, stableKey, name, subject, body, dayOffset, sendMode, enabled) VALUES (21, NULL, 'J+1', 'S', 'B', 1, 'manual', 1)").run();

  const today = '2026-06-15';
  // Arrived 3 days ago → J+1 sendDate = 2026-06-13, inside the [2026-06-08, 2026-06-15] lookback.
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (120, 'reservation', 1, 1, '2026-06-12', '2026-06-14')").run();

  const rows = model.listPending({ today, lookbackDays: 7 });
  assert.ok(rows.some((r) => r.reservationId === 120), 'the post-stay email survives a past startDate');
});

// ---- history ----

test('history: paginated, joined with template + client + property + reservation dates', () => {
  const { db, model } = fresh();
  seedFixture(db);
  model.insert({ templateId: 10, reservationId: 100, status: 'sent',   renderedSubject: 'S1', renderedBody: 'B1', recipientEmail: 'jane@s.com' });
  model.insert({ templateId: 11, reservationId: 101, status: 'failed', errorMessage: 'EMAIL_NOT_CONFIGURED', renderedSubject: 'S2', renderedBody: 'B2', recipientEmail: 'marc@p.fr' });

  // `today` pinned inside the rolling window (startDate 2026-06-17 → kept until 2026-06-20).
  const all = model.history({ limit: 50, today: '2026-06-18' });
  assert.equal(all.total, 2);
  assert.equal(all.rows.length, 2);
  const r1 = all.rows.find((r) => r.reservationId === 100);
  assert.equal(r1.templateName, 'J-7');
  assert.equal(r1.clientFullName, 'Jane Smith');
  assert.equal(r1.propertyName, 'Villa A');
  assert.equal(r1.reservationStartDate, '2026-06-17');

  const filteredByStatus = model.history({ status: 'failed', today: '2026-06-18' });
  assert.equal(filteredByStatus.total, 1);
  assert.equal(filteredByStatus.rows[0].errorMessage, 'EMAIL_NOT_CONFIGURED');

  const filteredByReservation = model.history({ reservationId: 100, today: '2026-06-18' });
  assert.equal(filteredByReservation.total, 1);
});

test('history: limit + offset pagination', () => {
  const { db, model } = fresh();
  seedFixture(db);
  for (let i = 0; i < 5; i += 1) {
    model.insert({ templateId: 10, reservationId: 100 + (i % 3), status: 'sent', renderedSubject: `S${i}`, renderedBody: 'B' });
  }
  const page1 = model.history({ limit: 2, offset: 0, today: '2026-06-18' });
  const page2 = model.history({ limit: 2, offset: 2, today: '2026-06-18' });
  const page3 = model.history({ limit: 2, offset: 4, today: '2026-06-18' });
  assert.equal(page1.rows.length, 2);
  assert.equal(page2.rows.length, 2);
  assert.equal(page3.rows.length, 1);
  assert.equal(page1.total, 5);
});

// ---- history: rolling window (specs/email-history-rolling-window.md §3 rule 2) ----

test('history: keeps in-window stays (incl. exactly arrival+3), drops past-window + orphans', () => {
  const { db, model } = fresh();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jane', 'Smith')").run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Villa A')").run();
  // r300 arrival in the future, r301 arrives exactly today-3 (boundary kept), r302 arrives today-4 (out),
  // r999 referenced by a log but never inserted (orphan).
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (300, 'reservation', 1, 1, '2026-06-25', '2026-06-28')").run();
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (301, 'reservation', 1, 1, '2026-06-15', '2026-06-16')").run();
  db.prepare("INSERT INTO reservations (id, kind, clientId, propertyId, startDate, endDate) VALUES (302, 'reservation', 1, 1, '2026-06-14', '2026-06-15')").run();
  for (const rid of [300, 301, 302, 999]) {
    model.insert({ templateId: null, reservationId: rid, status: 'sent', renderedSubject: 'S', renderedBody: 'B' });
  }
  const today = '2026-06-18';
  const res = model.history({ limit: 50, today });
  const ids = res.rows.map((r) => r.reservationId).sort();
  // 300 (future) + 301 (arrival+3 == today, boundary inclusive) kept; 302 (arrival+4 < today) + 999 (orphan) dropped.
  assert.deepEqual(ids, [300, 301]);
  assert.equal(res.total, 2);
});
