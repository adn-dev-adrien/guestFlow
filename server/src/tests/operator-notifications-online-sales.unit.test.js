// specs/site/site-outside-resource-booking.md rules 22-23 — what the operator is told, on the shared push channel `online-sales` and by e-mail: a voucher a customer paid (never one the team
// issued), every session booked from the website with or without a voucher, a paid session that could not be booked. The texts are built from the voucher and the resource, never a
// literal activity; the e-mail goes out whether or not the push toggle is on.
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-online-sales-')), 'p.db');

const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../plugins/sdk/testing');

if (!requirePlugins(['hourly-resources', 'gift-vouchers'])) return;

const silent = console.log;
console.log = () => {};
const { buildNotificationService } = require('../utils/notificationService');
const hourly = require('../plugins/hourly-resources/sessionNotices');
const vouchers = require('../plugins/gift-vouchers/voucherNotices');
const { createOrderPaid } = require('../plugins/gift-vouchers/orderPaid');
console.log = silent;

const settings = (over = {}) => ({
  notificationSettings: () => ({
    enabled: true, recipientEmail: 'owner@example.com', explicitRecipientEmail: 'owner@example.com', fromEmail: 'noreply@example.com', publicUrl: 'https://app.example.com', ...over,
  }),
  smtpConfigured: () => true,
  decryptedSmtpSettings: () => ({ host: 'smtp' }),
});

function operator(over = {}) {
  const pushes = [];
  const mails = [];
  const service = buildNotificationService({
    db: {},
    settingsModel: settings(over),
    emailServiceFactory: () => ({ isConfigured: true, send: async (mail) => { mails.push(mail); } }),
    pushService: { sendToPref: async (key, payload) => { pushes.push({ key, payload }); } },
    logger: { warn() {} },
  });
  return { service, pushes, mails };
}

const BOOKED = {
  resourceName: 'Bain nordique', date: '2026-12-06', start: '18:00', end: '20:00', customer: { name: 'Marie Dupont', email: 'marie@example.test', phone: '0612345678' }, people: 3, bookingId: 41, // date-literal-ok: a text built from the day it is given
};

test('rule 23 — notifyOperator sends one push on the channel and one e-mail to the recipient with a link on the public URL; every value is one line', async () => {
  const { service, pushes, mails } = operator();
  await service.notifyOperator({
    channel: 'online-sales', title: 'Titre\nfaux', body: 'Corps', url: '/passages/41', subject: 'Sujet\r\nBcc: x@y.z', lines: ['Une ligne\nforgée', 'Autre'],
  });
  assert.deepEqual(pushes, [{ key: 'online-sales', payload: { title: 'Titre faux', body: 'Corps', url: '/passages/41' } }]);
  assert.equal(mails.length, 1);
  assert.deepEqual([mails[0].to, mails[0].subject], ['owner@example.com', 'Sujet Bcc: x@y.z']);
  assert.equal(mails[0].text, 'Une ligne forgée\nAutre\n\nOuvrir dans GuestFlow : https://app.example.com/passages/41');
});

test('rule 23 — the e-mail does not depend on the push toggle, and a push failure or a missing SMTP never throws', async () => {
  const mails = [];
  const service = buildNotificationService({
    db: {},
    settingsModel: settings(),
    emailServiceFactory: () => ({ isConfigured: true, send: async (mail) => { mails.push(mail); } }),
    pushService: { sendToPref: async () => { throw new Error('push down'); } },
    logger: { warn() {} },
  });
  await service.notifyOperator({
    channel: 'online-sales', title: 't', body: 'b', subject: 's', lines: ['l'],
  });
  assert.equal(mails.length, 1, 'the toggle (and the push itself) governs the push only');
  const none = buildNotificationService({
    db: {}, settingsModel: { ...settings(), smtpConfigured: () => false }, pushService: { sendToPref: async () => {} }, logger: { warn() {} },
  });
  assert.deepEqual(await none.notifyOperator({
    channel: 'online-sales', title: 't', body: 'b', subject: 's', lines: [],
  }), { sent: false, skipped: 'smtp_not_configured' });
});

test('rule 23 — a session booked online: title, one-line body with the day, the slot, the first name and the initial, the people and how it was paid', () => {
  const card = hourly.bookedNotice({ ...BOOKED, tenders: [{ method: 'card', amountCents: 9000, source: 'payment-link:1' }] });
  assert.equal(card.channel, 'online-sales');
  assert.equal(card.title, 'Séance réservée en ligne · Bain nordique');
  assert.equal(card.body, 'dimanche 6 décembre · 18:00 – 20:00 · Marie D., 3 pers. · 90 € payés');
  assert.equal(card.url, '/passages/41');
  assert.ok(card.lines.includes('Règlement : 90 € payés'));
  const voucher = hourly.bookedNotice({ ...BOOKED, tenders: [{ method: 'prepaid', source: 'giftVoucher', ref: '0042', label: 'Bon cadeau', covers: [] }] });
  assert.match(voucher.body, /· bon cadeau n° 0042$/);
  const both = hourly.bookedNotice({
    ...BOOKED, tenders: [{ method: 'prepaid', source: 'giftVoucher', ref: '0042', label: 'Bon cadeau', covers: [] }, { method: 'card', amountCents: 4000, source: 'payment-link:2' }],
  });
  assert.match(both.body, /· bon cadeau n° 0042 \+ 40 € payés$/);
  const alone = hourly.bookedNotice({ ...BOOKED, customer: { name: 'Marie' }, people: null, tenders: [] });
  assert.equal(alone.body, 'dimanche 6 décembre · 18:00 – 20:00 · Marie');
});

test('rule 23 — a voucher paid by a customer: the amount, the campaign title, who gave it to whom, its number and its end of validity', () => {
  const notice = vouchers.soldNotice({
    title: 'Une heure de bain en soirée',
    voucher: { id: 12, number: 'BC-2026-0042', amountCents: 7000, senderName: 'Claire M.', recipientName: 'Julien', expiresOn: '2028-05-25', email: 'claire@example.test' }, // date-literal-ok: a text built from the day it is given
  });
  assert.equal(notice.channel, 'online-sales');
  assert.equal(notice.title, 'Bon cadeau vendu · 70 €');
  assert.equal(notice.body, 'Une heure de bain en soirée, offert par Claire M. à Julien. N° BC-2026-0042, valable jusqu’au 25/05/2028.');
  assert.equal(notice.url, '/bons-cadeaux?bon=12');
  assert.equal(vouchers.soldNotice({ title: 'T', voucher: { id: 1, number: 'N', amountCents: 5050, expiresOn: '2027-01-02' } }).title, 'Bon cadeau vendu · 50,50 €'); // date-literal-ok: a text built from the day it is given
});

test('rule 23 — no text names an activity: the same builders say « Sauna » when the resource is a sauna', () => {
  const sauna = hourly.bookedNotice({ ...BOOKED, resourceName: 'Sauna', tenders: [] });
  const refund = hourly.refundNotice({
    resourceName: 'Sauna', date: '2026-12-06', start: '18:00', end: '20:00', name: 'Marie Dupont', amountCents: 9000, reason: 'créneau pris entre-temps', // date-literal-ok: a text built from the day it is given
  });
  assert.equal(sauna.title, 'Séance réservée en ligne · Sauna');
  assert.equal(refund.title, 'Paiement à rembourser · Sauna');
  assert.equal(refund.body, 'dimanche 6 décembre · 18:00 – 20:00 · Marie D., 90 € payés : créneau pris entre-temps.');
  for (const source of ['sessionNotices.js', 'sessionMail.js', 'publicSessionService.js']) {
    assert.equal(/bain|sauna|nordique/i.test(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'hourly-resources', source), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), false, `${source} names no activity`);
  }
  assert.equal(/bain|sauna|nordique/i.test(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'gift-vouchers', 'voucherNotices.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), false);
});

test('rule 23 — a voucher is announced when the bank confirms it, whoever started the order; an issued voucher has no payment to confirm and never reaches this path', () => {
  const notices = [];
  const order = { id: 5, state: 'pending', amountCents: 5000, createdBy: 'user:7' };
  const paid = createOrderPaid({
    orders: { find: () => order },
    movements: { byKey: () => null },
    issuance: { issue: () => ({ voucherId: 9 }) },
    receipt: { deliverReceipt: async () => {} },
    terms: { current: () => null, accept: () => {} },
    vouchers: { find: () => ({ id: 9, number: 'BC-2026-0007', amountCents: 5000, senderName: 'Paul', recipientName: 'Léa', expiresOn: '2027-11-15', campaignId: null, contents: '{"kind":"lodging"}' }) }, // date-literal-ok: a text built from the day it is given
    campaigns: { find: () => null },
    notify: (notice) => notices.push(notice),
  });
  assert.deepEqual(paid({ ref: '5', linkId: 3, amountCents: 5000 }), { effect: 'voucher-issued' });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, 'Bon cadeau vendu · 50 €');
  assert.deepEqual(paid({ ref: '5', linkId: 3, amountCents: 5000 }), { effect: 'voucher-issued' }, 'a replay of the same link');
});

test('rule 23 — the e-mail goes to the address typed for notifications only: none typed, the sender’s own address is not used; the master switch of the e-mails is honoured, the push is not tied to it', async () => {
  const none = operator({ explicitRecipientEmail: '', recipientEmail: 'noreply@example.com' });
  const answer = await none.service.notifyOperator({
    channel: 'online-sales', title: 't', body: 'b', subject: 's', lines: ['l'],
  });
  assert.deepEqual([answer.skipped, none.mails.length, none.pushes.length], ['no_recipient', 0, 1]);
  const off = operator({ enabled: false });
  const refused = await off.service.notifyOperator({
    channel: 'online-sales', title: 't', body: 'b', subject: 's', lines: ['l'],
  });
  assert.deepEqual([refused.skipped, off.mails.length, off.pushes.length], ['disabled', 0, 1]);
});
