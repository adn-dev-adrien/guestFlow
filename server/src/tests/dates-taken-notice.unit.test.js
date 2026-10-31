// specs/payment-link-lifecycle.md rules 43, 44, 47 and 64 — a stay whose link was withdrawn because another
// stay took its nights tells its guest at once, once, without validation: only after the provider read the link
// unpaid, never for a lapse, a started stay or « Retirer le lien », never for the stays withdrawn at the upgrade
// (rule 61), and never when it cannot leave (template off, no address, no English, no SMTP), in which case the
// push and the card say « client non prévenu » with the reason. Made-up stays; nothing leaves the process.

const test = require('node:test');
const assert = require('node:assert/strict');

const { db, inDays, freshProperty, addStay, addLink, linkOf, bookingFeed, providerReads: readsWith } = require('./datesTakenFixture');
const paymentLinksModel = require('../models/paymentLinksModel');
const templatesModel = require('../models/emailTemplatesModel');
const { buildDatesTakenNotice } = require('../utils/datesTakenNotice');
const { runDatesTakenUpgradeMigration } = require('../utils/datesTakenUpgradeMigration');
const { fakeProvider } = require('./paymentLinkLifecycleFixture');

const settingsModel = { read: () => ({ companyName: 'Demo' }), decryptedSmtpSettings: () => ({}) };

function harness({ smtp = true, failSend = null } = {}) {
  const mails = [];
  const pushes = [];
  const emailServiceFactory = () => {
    if (!smtp) throw Object.assign(new Error('SMTP non configuré'), { code: 'EMAIL_NOT_CONFIGURED' });
    return { isConfigured: true, send: async (m) => { if (failSend) throw failSend; mails.push(m); } };
  };
  const notice = buildDatesTakenNotice({
    database: db, settingsModel, emailServiceFactory, push: async (payload) => { pushes.push(payload); },
    logger: { log: () => {}, warn: () => {} },
  });
  return { notice, mails, pushes };
}

const noticeRow = (stayId) => db.prepare('SELECT * FROM dates_taken_notices WHERE reservationId = ?').get(stayId);
const logRows = (stayId) => db.prepare("SELECT * FROM email_log WHERE reservationId = ? AND occurrenceKey = ? ORDER BY id").all(stayId, `dates-taken:${stayId}`);

// The provider deactivates the withdrawn link, then reads it once more an hour later (rules 18, 19, 64).
const providerReads = (linkId, { paid = false, lastLook = true } = {}) => readsWith(linkId, fakeProvider({ paid }), { lastLook });

// A direct devis with a link, then a Booking stay on its nights: the link is withdrawn, `dates-taken`.
async function devisTakenByBooking({ start = 40, email = 'lina@example.test', lang = 'fr' } = {}) {
  const propertyId = freshProperty();
  const clientId = Number(db.prepare('INSERT INTO clients (firstName, lastName, email, emailLanguage) VALUES (?, ?, ?, ?)').run('Lina', 'Exemple', email, lang).lastInsertRowid);
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(start), end: inDays(start + 4) });
  db.prepare('UPDATE reservations SET clientId = ? WHERE id = ?').run(clientId, devisId);
  const linkId = addLink(devisId);
  await bookingFeed(propertyId).sync([{ uid: `n${devisId}@booking`, start: inDays(start + 1), end: inDays(start + 3) }]);
  const takenBy = db.prepare("SELECT id FROM reservations WHERE propertyId = ? AND kind = 'reservation' AND platform != 'direct'").get(propertyId);
  return { propertyId, devisId, linkId, takenById: takenBy && takenBy.id };
}

test('rule 43 — withdrawn for dates taken and read unpaid: the guest is mailed once, the operators pushed, the card fed', async () => {
  const h = harness();
  const { devisId, linkId, takenById } = await devisTakenByBooking();
  assert.equal(linkOf(linkId).cancelReason, 'dates-taken');
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0, 'nothing while the provider has not read the link (rule 33 may still book it)');
  await providerReads(linkId, { lastLook: false });
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0, 'rule 64 — deactivated, but not read after the deactivation yet');
  await providerReads(linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 1);
  assert.equal(h.mails[0].to, 'lina@example.test');
  assert.match(h.mails[0].subject, /ne sont plus disponibles/);
  assert.match(h.mails[0].text, /Le lien de paiement\s+que vous avez reçu ne fonctionne plus, et rien ne vous a été prélevé\./);
  assert.doesNotMatch(h.mails[0].text, /https?:\/\//, 'rule 44 — no link, no amount request');
  const [logged] = logRows(devisId);
  assert.equal(logged.status, 'sent');
  assert.equal(logged.recipientEmail, 'lina@example.test');
  const row = noticeRow(devisId);
  assert.equal(row.noticeStatus, 'sent');
  assert.equal(row.emailLogId, logged.id);
  assert.equal(row.takenByReservationId, takenById);
  assert.equal(h.pushes.length, 1);
  assert.equal(h.pushes[0].title, 'Dates prises — Lina Exemple');
  assert.match(h.pushes[0].body, /: dates prises par la réservation \S+, client prévenu\.$/);
  assert.equal(h.pushes[0].url, `/reservations/${devisId}`);

  await h.notice.runDueNotices();
  assert.equal((await h.notice.notifyDatesTaken(devisId)).status, 'not-due', 'rule 64 — the withdrawal was judged once');
  assert.equal(h.mails.length, 1, 'once per stay');
  assert.equal(h.pushes.length, 1);
});

test('rule 43 — two links withdrawn on one stay: one notice, sent once both were read', async () => {
  const h = harness();
  const propertyId = freshProperty();
  const stay = addStay({ propertyId, start: inDays(60), end: inDays(63) });
  const deposit = addLink(stay, { type: 'deposit' });
  const full = addLink(stay, { type: 'full' });
  await bookingFeed(propertyId).sync([{ uid: `two${stay}@booking`, start: inDays(61), end: inDays(62) }]);
  await providerReads(deposit);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0, 'a withdrawn link still unread may yet be paid');
  await providerReads(full);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 1);
});

test('rule 33 — a withdrawn link found paid books the money and sends no notice', async () => {
  const h = harness();
  const { devisId, linkId } = await devisTakenByBooking({ start: 70 });
  paymentLinksModel.markRetiredLinkPaid(linkId, { providerPaymentId: 'pay_t', paidAt: new Date().toISOString(), reason: 'dates-taken' });
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.equal(noticeRow(devisId), undefined);
});

test('rule 43 — a payment read on the cancelled row (paidAt kept) is not « read unpaid »', async () => {
  const h = harness();
  const { devisId, linkId } = await devisTakenByBooking({ start: 72 });
  paymentLinksModel.clearRemoteCancelPending(linkId, { providerPaymentId: 'pay_x', paidAt: new Date().toISOString() });
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.equal(noticeRow(devisId), undefined);
});

test('rule 43 — never for a lapse, a started stay or « Retirer le lien »', async () => {
  const h = harness();
  const propertyId = freshProperty();
  for (const reason of ['validity', 'stay-started']) {
    const stay = addStay({ propertyId, kind: 'devis', start: inDays(80), end: inDays(82) });
    const id = addLink(stay);
    db.prepare("UPDATE payment_links SET status = 'expired', cancelReason = ?, remoteCancelPendingAt = NULL WHERE id = ?").run(reason, id);
  }
  const withdrawn = addStay({ propertyId, kind: 'devis', start: inDays(80), end: inDays(82) });
  const op = addLink(withdrawn);
  db.prepare("UPDATE payment_links SET status = 'cancelled', cancelReason = 'operator', remoteCancelPendingAt = NULL WHERE id = ?").run(op);
  addStay({ propertyId, platform: 'Booking', start: inDays(80), end: inDays(82) });
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM dates_taken_notices WHERE reservationId IN (SELECT id FROM reservations WHERE propertyId = ?)').get(propertyId).n, 0);
});

test('rules 43, 61 — the stays withdrawn at the upgrade are never mailed; the card says « client non prévenu »', async () => {
  const h = harness();
  const propertyId = freshProperty();
  const devisId = addStay({ propertyId, kind: 'devis', start: inDays(90), end: inDays(93) });
  const linkId = addLink(devisId);
  addStay({ propertyId, platform: 'Booking', start: inDays(91), end: inDays(92) });
  db.prepare("DELETE FROM migrations WHERE name = 'dates_taken_links_withdrawn_v1'").run();
  runDatesTakenUpgradeMigration(db, { logger: { log: () => {} } });
  await providerReads(linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  assert.equal(h.pushes.length, 0);
  assert.deepEqual({ ...noticeRow(devisId) }.noticeReason, 'upgrade');
});

test('rule 43 — re-checked before sending: a stay already begun, paid since, or whose dates were freed is not told', async () => {
  const h = harness();
  const begun = await devisTakenByBooking({ start: 100 });
  await providerReads(begun.linkId);
  db.prepare('UPDATE reservations SET startDate = ? WHERE id = ?').run(inDays(0), begun.devisId);
  const paid = await devisTakenByBooking({ start: 110 });
  await providerReads(paid.linkId);
  db.prepare('UPDATE reservations SET depositPaid = 1 WHERE id = ?').run(paid.devisId);
  const freed = await devisTakenByBooking({ start: 120 });
  await providerReads(freed.linkId);
  db.prepare("UPDATE reservations SET kind = 'cancelled' WHERE id = ?").run(freed.takenById);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 0);
  for (const s of [begun, paid, freed]) {
    assert.equal(noticeRow(s.devisId), undefined, 'nothing claimed: nothing to say');
    assert.ok(linkOf(s.linkId).noticeJudgedAt, 'rule 64 — judged once, never a candidate again');
  }
});

test('rule 44 — fails closed: template off, no address, no English, no SMTP; the push and the row say why', async () => {
  const cases = [
    { name: 'template off', setup: () => templatesModel.update(templatesModel.findByStableKey('dates_unavailable_notice').id, { enabled: false }), undo: () => templatesModel.update(templatesModel.findByStableKey('dates_unavailable_notice').id, { enabled: true }), reason: 'modèle désactivé' },
    { name: 'no address', stay: { email: '' }, reason: 'pas d’adresse e-mail' },
    { name: 'no English', stay: { lang: 'en' }, setup: () => db.prepare("UPDATE email_templates SET bodyEn = '' WHERE stableKey = 'dates_unavailable_notice'").run(), undo: () => require('../utils/defaultEmailTemplatesRegistry').DEFAULT_TEMPLATES.filter((t) => t.stableKey === 'dates_unavailable_notice').forEach((t) => db.prepare("UPDATE email_templates SET bodyEn = ? WHERE stableKey = 'dates_unavailable_notice'").run(t.bodyEn)), reason: 'version anglaise manquante' },
    { name: 'no SMTP', harness: { smtp: false }, reason: 'SMTP non configuré' },
  ];
  let start = 130;
  for (const c of cases) {
    const h = harness(c.harness);
    start += 10;
    const s = await devisTakenByBooking({ start, ...(c.stay || {}) });
    await providerReads(s.linkId);
    if (c.setup) c.setup();
    try {
      await h.notice.runDueNotices();
    } finally {
      if (c.undo) c.undo();
    }
    assert.equal(h.mails.length, 0, c.name);
    const row = noticeRow(s.devisId);
    assert.equal(row.noticeStatus, 'not-sent', c.name);
    assert.equal(h.pushes.length, 1, c.name);
    assert.match(h.pushes[0].body, new RegExp(`client non prévenu : ${c.reason}\\.$`), c.name);
    await h.notice.runDueNotices();
    assert.equal(h.pushes.length, 1, `${c.name}: told once`);
  }
});

test('rule 44 — an English-speaking guest reads the English notice', async () => {
  const h = harness();
  const s = await devisTakenByBooking({ start: 200, lang: 'en' });
  await providerReads(s.linkId);
  await h.notice.runDueNotices();
  assert.equal(h.mails.length, 1);
  assert.match(h.mails[0].subject, /^Your dates at .+ are no longer available$/);
  assert.match(h.mails[0].text, /nothing has been charged\./);
});

test('rule 43 — two passes racing on one stay send one e-mail', async () => {
  const h = harness();
  const s = await devisTakenByBooking({ start: 210 });
  await providerReads(s.linkId);
  await Promise.all([h.notice.runDueNotices(), h.notice.runDueNotices(), h.notice.notifyDatesTaken(s.devisId)]);
  assert.equal(h.mails.length, 1);
  assert.equal(logRows(s.devisId).length, 1);
});
