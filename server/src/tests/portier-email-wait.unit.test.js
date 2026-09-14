// specs/gate-access-portier.md §3.2 — the J-7 email waits for Portier and retries (decision 2026-09-14).
//
// Everything real except Portier, SMTP, the push service and the clock: the auto pass, the emails
// controller, the log model on an in-memory database, and the retry module. Portier is a fake client
// that can be switched off and on; time and timers are moved by hand.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { performAutoEmailPass } = require('../utils/emailAutoSendRunner');
const { buildController } = require('../controllers/emailsController');
const emailLogModel = require('../models/emailLogModel');
const { createEmailRetry, nextAttemptAt, WAITING_MESSAGE } = require('../utils/portierEmailRetry');
const { gateAccessForEmail } = require('../utils/portierInvitation');
const { sinceText } = require('../utils/portierAccessView');
const { runEmailLogPortierMigration } = require('../utils/emailLogPortierMigration');
const { PortierUnavailableError } = require('../utils/portierClient');
const { ARRIVAL_REMINDER_7D_BODY } = require('../utils/defaultEmailTemplatesRegistry');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const T0 = Date.parse('2026-09-14T06:00:00.000Z'); // 08:00 in Paris
const MIN = 60e3;

function seed() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  for (const column of ['reservationNumber TEXT', 'emailLanguage TEXT']) db.exec(`ALTER TABLE reservations ADD COLUMN ${column}`);
  db.exec('ALTER TABLE clients ADD COLUMN emailLanguage TEXT');
  db.transaction(() => runEmailLogPortierMigration(db))();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Camille', 'Roux', 'camille@example.com')").run();
  db.prepare(`INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, checkInTime, checkOutTime, adults, platform, finalPrice, totalPrice, reservationNumber)
              VALUES (10, 'reservation', 1, 1, '2026-09-21', '2026-09-28', '16:00', '10:00', 2, 'direct', 600, 600, '202609042')`).run();
  const template = db.prepare(`INSERT INTO email_templates (stableKey, name, subject, body, dayOffset, sendMode, enabled)
                               VALUES (?, ?, ?, ?, -7, 'auto', 1)`);
  const j7 = Number(template.run('arrival_reminder_7d', 'Rappel J-7', 'Votre séjour approche', ARRIVAL_REMINDER_7D_BODY).lastInsertRowid);
  const plain = Number(template.run('welcome_note', 'Mot de bienvenue', 'Bienvenue', 'Bonjour {{clientFirstName}}, à bientôt.').lastInsertRowid);
  return { db, j7, plain };
}

function world() {
  const { db, j7, plain } = seed();
  const clock = { at: T0 };
  const timers = [];
  const sent = [];
  const pushes = [];
  const portier = {
    configured: true,
    up: false,
    answer: { status: 200, data: { url: 'https://guest.domainesolio.com/#i=4K7M9QT2', code: '4K7M-9QT2', state: 'before', window: { from: '2026-09-21T14:00:00.000Z', until: '2026-09-28T09:00:00.000Z' } } },
    isConfigured() { return this.configured; },
    async call() {
      if (!this.up) throw new PortierUnavailableError('unreachable', 'ECONNREFUSED');
      return this.answer;
    },
  };
  const templatesModel = {
    listEnabled: () => db.prepare('SELECT * FROM email_templates WHERE enabled = 1 ORDER BY id').all(),
    findById: (id) => db.prepare('SELECT * FROM email_templates WHERE id = ?').get(Number(id)),
    findByStableKey: (key) => db.prepare('SELECT * FROM email_templates WHERE stableKey = ?').get(key),
  };
  const settingsModel = {
    read: () => ({ companyPhone: '06.15.73.93.37' }),
    emailAutoSendEnabled: () => true,
    smtpConfigured: () => true,
    decryptedSmtpSettings: () => ({}),
  };
  const logModel = emailLogModel.buildModel(db);
  const emailServiceFactory = () => ({ send: async (message) => { sent.push(message); } });
  const resolveGateAccess = (args) => gateAccessForEmail({ ...args, client: portier });

  let controller = null;
  const retry = createEmailRetry({
    logModel,
    compose: (row) => controller.composeForSend(row.reservationId, row.templateId),
    deliver: async ({ to, subject, body }) => { sent.push({ to, subject, text: body }); },
    notifyAdmins: async (payload) => { pushes.push(payload); },
    formatClock: (iso) => sinceText(iso, clock.at),
    now: () => clock.at,
    setTimer: (fn, delay) => {
      const t = { delay, due: clock.at + delay, done: false };
      t.fn = () => { t.done = true; return fn(); };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => { if (t) t.done = true; },
    logger: { error() {} },
  });
  controller = buildController({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory, resolveGateAccess, emailRetry: retry });

  const live = () => timers.filter((t) => !t.done);
  return {
    db, j7, plain, clock, sent, pushes, portier, logModel, controller, retry, live,
    pass: () => performAutoEmailPass({ database: db, templatesModel, logModel, settingsModel, emailServiceFactory, today: '2026-09-14', resolveGateAccess, emailRetry: retry }),
    row: (templateId) => db.prepare('SELECT * FROM email_log WHERE templateId = ? ORDER BY id DESC').get(templateId),
    // Moves the clock to the one armed timer and fires it — exactly what the event loop would do.
    async fire() {
      const [timer] = live();
      assert.ok(timer, 'a timer is armed');
      clock.at = timer.due;
      await timer.fn();
    },
  };
}

const at = (ms) => new Date(T0 + ms).toISOString();

test('the retry calendar: 1, 2, 5 and 15 minutes, then every 15 minutes', () => {
  const attempts = [];
  let now = T0;
  for (let i = 0; i < 7; i += 1) {
    now = nextAttemptAt(T0, now);
    attempts.push((now - T0) / MIN);
  }
  assert.deepEqual(attempts, [1, 3, 8, 23, 38, 53, 68]);
  assert.equal((nextAttemptAt(T0, T0 + 30 * MIN) - T0) / MIN, 38, 'a late wake-up takes the next slot, it does not stack');
});

test('Portier down at 08:00: the J-7 is not sent and waits; the email without the gate paragraph leaves', async () => {
  const w = world();
  const summary = await w.pass();

  assert.equal(summary.waitingCount, 1);
  assert.deepEqual(w.sent.map((m) => m.subject), ['Bienvenue'], 'only the email that does not need Portier');
  const waiting = w.row(w.j7);
  assert.deepEqual(
    [waiting.status, waiting.waitingSince, waiting.nextAttemptAt, waiting.renderedBody],
    ['waiting_portier', at(0), at(MIN), ''],
  );
  assert.equal(w.live().length, 1);
  assert.equal(w.live()[0].delay, MIN);

  await w.pass();
  assert.equal(w.db.prepare('SELECT COUNT(*) AS n FROM email_log WHERE templateId = ?').get(w.j7).n, 1, 'the next pass does not queue it twice');
});

test('it is retried on the back-off, notifies the admins once after an hour, and leaves once Portier answers', async () => {
  const w = world();
  await w.pass();

  const schedule = [];
  for (let i = 0; i < 5; i += 1) {
    await w.fire();
    schedule.push(w.row(w.j7).nextAttemptAt);
  }
  assert.deepEqual(schedule, [at(3 * MIN), at(8 * MIN), at(23 * MIN), at(38 * MIN), at(53 * MIN)]);
  assert.equal(w.pushes.length, 0, 'not before an hour');

  await w.fire(); // 08:53 — still down
  assert.equal(w.row(w.j7).nextAttemptAt, at(68 * MIN));
  await w.fire(); // 09:00 — the hour: the notification, without an attempt
  assert.equal(w.clock.at, T0 + 60 * MIN);
  assert.deepEqual(w.pushes.map((p) => p.body), ['Email J-7 de Camille en attente : Portier ne répond pas depuis 08:00']);

  await w.fire(); // 09:08 — still down
  assert.equal(w.pushes.length, 1, 'once');

  w.portier.up = true;
  await w.fire(); // 09:23 — Portier answers
  const done = w.row(w.j7);
  assert.equal(done.status, 'sent');
  assert.match(done.renderedBody, /https:\/\/guest\.domainesolio\.com\/#i=4K7M9QT2/);
  assert.match(done.renderedBody, /4K7M-9QT2/);
  assert.equal(w.sent.at(-1).to, 'camille@example.com');
  assert.equal(w.live().length, 0, 'nothing waits, nothing is armed');
});

test('nothing waits → no timer; Portier not configured → the J-7 leaves without its paragraph', async () => {
  const w = world();
  w.portier.configured = false;
  await w.pass();
  assert.equal(w.live().length, 0);
  assert.equal(w.retry.hasTimer(), false);
  assert.equal(w.row(w.j7).status, 'sent');
  assert.doesNotMatch(w.row(w.j7).renderedBody, /portail depuis votre téléphone/);
});

test('a stay Portier does not know yet (404) waits like an outage', async () => {
  const w = world();
  w.portier.up = true;
  w.portier.answer = { status: 404, data: { error: 'not_found' } };
  await w.pass();
  assert.equal(w.row(w.j7).status, 'waiting_portier');
});

test('a waiting email whose reservation is cancelled is dropped as skipped, and never sent', async () => {
  const w = world();
  await w.pass();
  w.db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = 10").run();
  w.portier.up = true;
  await w.fire();
  assert.deepEqual([w.row(w.j7).status, w.row(w.j7).errorMessage], ['skipped', 'RESERVATION_CANCELLED']);
  assert.equal(w.sent.filter((m) => m.subject === 'Votre séjour approche').length, 0);
  assert.equal(w.live().length, 0);
});

test('…and so is one whose template was disabled meanwhile', async () => {
  const w = world();
  await w.pass();
  w.db.prepare('UPDATE email_templates SET enabled = 0 WHERE id = ?').run(w.j7);
  await w.fire();
  assert.deepEqual([w.row(w.j7).status, w.row(w.j7).errorMessage], ['skipped', 'TEMPLATE_DISABLED']);
});

test('a manual « Envoyer » while Portier is down is queued the same way, and says so', async () => {
  const w = world();
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await w.controller.send({ body: { reservationId: 10, templateId: w.j7, overrides: {} } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.waitingPortier, true);
  assert.equal(res.body.message, "Portier ne répond pas : l'email partira dès qu'il répond.");
  assert.equal(res.body.message, WAITING_MESSAGE);
  assert.equal(w.row(w.j7).status, 'waiting_portier');
  assert.equal(w.sent.length, 0);

  const history = { json(b) { this.body = b; return this; } };
  w.controller.history({ query: {} }, history);
  assert.deepEqual(history.body.rows.map((r) => [r.status, r.statusDetail]), [['waiting_portier', 'prochain essai à 08:01']]);

  w.portier.up = true;
  await w.fire();
  assert.equal(w.row(w.j7).status, 'sent');
});
