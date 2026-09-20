// specs/guest-email-sequence.md §3.3-§3.6 — the daily pass, the payment confirmation and the
// simulation, end to end on a real schema: one send per key whatever the path, nothing before the
// start date, nothing written by a simulation.

const test = require('node:test');
const assert = require('node:assert/strict');

const guestEmailSendsModel = require('../models/guestEmailSendsModel');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const emailPreferencesModel = require('../models/emailPreferencesModel');
const { runSequencePass, sendSequenceMail, planWindow, simulate } = require('../utils/guestEmailSequenceRunner');
const { buildConfirmationSender } = require('../utils/reservationEmailSender');
const { stayDedupKey, MAIL } = require('../utils/guestEmailSequence');
const { freshDb, seedProperty, seedClient, seedReservation, settingsStub, mailer } = require('./guestEmailSequenceFixtures');

function setup({ settings = settingsStub(), mail = mailer() } = {}) {
  const db = freshDb();
  seedProperty(db);
  seedClient(db);
  const deps = {
    database: db,
    ledger: guestEmailSendsModel.buildModel(db),
    templatesModel: emailTemplatesModel.buildModel(db),
    logModel: emailLogModel.buildModel(db),
    settingsModel: settings,
    emailServiceFactory: mail.factory,
    preferences: emailPreferencesModel.buildModel(db),
  };
  return { db, deps, mail };
}

// Arrival on 10 July 2027: J-7 due on 3 July.
const J7_DUE = '2027-07-03';

// rules 15 + 18 — the sequence sends only once the operator turns automatic sending ON.
test('switch OFF: the pass sends nothing at all', async () => {
  const { db, deps, mail } = setup({ settings: settingsStub({ autoSend: false }) });
  seedReservation(db);
  const result = await runSequencePass(deps, { today: J7_DUE });
  assert.equal(result.blocked, true);
  assert.equal(mail.sent.length, 0);
});

test('never activated (no start date): the pass sends nothing', async () => {
  const { db, deps, mail } = setup({ settings: settingsStub({ startDate: null }) });
  seedReservation(db);
  assert.equal((await runSequencePass(deps, { today: J7_DUE })).blocked, true);
  assert.equal(mail.sent.length, 0);
});

// rule 19 — one scheduler per sequence mail: the legacy pass and the queue stand aside.
test('the J-7 leaves on its day, once: a second pass the same day sends nothing', async () => {
  const { db, deps, mail } = setup();
  const rid = seedReservation(db);
  const first = await runSequencePass(deps, { today: J7_DUE });
  assert.equal(first.sent, 1);
  assert.equal(mail.sent.length, 1);
  assert.match(mail.sent[0].subject, /Plus qu'une semaine avant La Granja/);
  assert.equal(deps.ledger.findByKey(stayDedupKey(MAIL.J7, rid)).status, 'sent');

  const second = await runSequencePass(deps, { today: J7_DUE });
  assert.equal(second.sent, 0);
  assert.equal(mail.sent.length, 1, 'never twice');
});

// rule 17 — today's mails, plus those due in the last 2 days and still unclaimed.
test('catch-up: a mail missed yesterday leaves today; one missed 3 days ago does not', async () => {
  const { db, deps, mail } = setup();
  seedReservation(db);
  await runSequencePass(deps, { today: '2027-07-04' });
  assert.equal(mail.sent.length, 1, 'J-7 of the 3rd caught up on the 4th');

  const late = setup();
  seedReservation(late.db);
  await runSequencePass(late.deps, { today: '2027-07-06' });
  assert.equal(late.mail.sent.length, 0, 'J-7 of the 3rd is 3 days old on the 6th');
});

test('no retroactive mail: a J-7 due the day before activation never leaves', async () => {
  const { db, deps, mail } = setup({ settings: settingsStub({ startDate: '2027-07-04' }) });
  seedReservation(db);
  await runSequencePass(deps, { today: '2027-07-04' });
  assert.equal(mail.sent.length, 0);
});

test('an SMTP failure is recorded, then retried by the next pass inside the catch-up window', async () => {
  const failing = setup({ mail: mailer({ failWith: 'SMTP down' }) });
  const rid = seedReservation(failing.db);
  const result = await runSequencePass(failing.deps, { today: J7_DUE });
  assert.equal(result.failed, 1);
  assert.equal(failing.deps.ledger.findByKey(stayDedupKey(MAIL.J7, rid)).status, 'failed');

  const working = mailer();
  await runSequencePass({ ...failing.deps, emailServiceFactory: working.factory }, { today: '2027-07-04' });
  assert.equal(working.sent.length, 1);
  assert.equal(failing.deps.ledger.findByKey(stayDedupKey(MAIL.J7, rid)).status, 'sent');
});

test('two paths racing on the same key: exactly one email leaves', async () => {
  const { db, deps } = setup({ mail: mailer({ delayMs: 20 }) });
  const rid = seedReservation(db);
  const slow = mailer({ delayMs: 20 });
  const plan = { stableKey: MAIL.J7, dedupKey: stayDedupKey(MAIL.J7, rid), reservationId: rid, clientId: 1 };
  const outcomes = await Promise.all([
    sendSequenceMail({ ...deps, emailServiceFactory: slow.factory }, plan),
    sendSequenceMail({ ...deps, emailServiceFactory: slow.factory }, plan),
  ]);
  assert.equal(slow.sent.length, 1);
  assert.deepEqual(outcomes.map((o) => o.sent).sort(), [false, true]);
  assert.equal(outcomes.find((o) => !o.sent).reason, 'already-sent');
});

test('payment webhook, payment poll and the 08:00 pass on the same booking: one confirmation', async () => {
  const { db, deps, mail } = setup();
  const rid = seedReservation(db, { createdAt: '2027-03-02 10:00:00' });
  const confirm = buildConfirmationSender(deps);
  await Promise.all([confirm(rid), confirm(rid)]);
  await runSequencePass(deps, { today: '2027-03-02' });
  const confirmations = mail.sent.filter((m) => /est confirmé/.test(m.subject));
  assert.equal(confirmations.length, 1);
});

test('the confirmation is never mailed for a platform booking', async () => {
  const { db, deps, mail } = setup();
  const rid = seedReservation(db, { platform: 'Airbnb' });
  const outcome = await buildConfirmationSender(deps)(rid);
  assert.equal(outcome.sent, false);
  assert.equal(outcome.reason, 'notDirect');
  assert.equal(mail.sent.length, 0);
});

test('yearly cap: with 3 post-stay contacts already sent this year, the next J+1 is held back', () => {
  const { db, deps } = setup();
  const rid = seedReservation(db, { startDate: '2027-09-10', endDate: '2027-09-12' });
  for (const [dedupKey, stableKey, sentAt] of [
    ['guest_thanks_j1:r900', 'guest_thanks_j1', '2027-02-01 08:00:00'],
    ['season_gift_vouchers:c1:2026-11', 'season_gift_vouchers', '2026-11-15 08:00:00'],
    ['season_new_year:c1:2027-01', 'season_new_year', '2027-01-06 08:00:00'],
  ]) {
    deps.ledger.claim({ dedupKey, stableKey, clientId: 1 });
    db.prepare("UPDATE guest_email_sends SET status = 'sent', sentAt = ? WHERE dedupKey = ?").run(sentAt, dedupKey);
  }
  const entry = planWindow({ database: db, ledger: deps.ledger, from: '2027-09-13', to: '2027-09-13', startDate: '2026-01-01' })
    .find((e) => e.dedupKey === stayDedupKey(MAIL.J1, rid));
  assert.equal(entry.status, 'blocked');
  assert.equal(entry.blocked, 'capReached');
});

test('simulation: lists what would leave and why not, writes nothing, assumes today before activation', () => {
  const { db, deps } = setup({ settings: settingsStub({ startDate: null, autoSend: false }) });
  seedReservation(db, { createdAt: '2026-09-01 10:00:00', startDate: '2026-10-02', endDate: '2026-10-03' });
  seedReservation(db, { kind: 'cancelled', startDate: '2026-10-20', endDate: '2026-10-22' });
  const before = { ledger: db.prepare('SELECT COUNT(*) AS n FROM guest_email_sends').get().n, log: db.prepare('SELECT COUNT(*) AS n FROM email_log').get().n };

  const result = simulate(deps, { from: '2026-09-18', to: '2027-01-31', today: '2026-09-18' });

  assert.equal(result.startDate, null);
  assert.equal(result.assumedStartDate, '2026-09-18');
  assert.equal(result.autoSendEnabled, false);
  const j7 = result.rows.find((r) => r.mailKey === MAIL.J7 && r.date === '2026-09-25');
  assert.equal(j7.status, 'send');
  assert.equal(j7.mailLabel, 'J-7 · préparation');
  assert.equal(j7.clientName, 'Camille Martin');
  assert.ok(result.rows.some((r) => r.status === 'blocked' && r.reason === 'Séjour annulé'));
  assert.ok(result.rows.some((r) => r.mailKey === MAIL.NOVEMBER && r.status === 'send'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_email_sends').get().n, before.ledger);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_log').get().n, before.log);
});
