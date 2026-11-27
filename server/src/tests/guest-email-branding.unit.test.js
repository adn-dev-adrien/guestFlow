// specs/emails/guest-email-branding.md — the guest emails wear the house's identity: a white letter on the
// page colour, the company logo (inline, never remote), three colours from Settings refused where typed,
// and a night variant. Rules 1–9 are cited in the test names.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const { uploadsDir } = require('../utils/instancePaths');
const { renderGuestEmailHtml, guestEmailMessage } = require('../utils/guestEmailHtml');
const { emailLogoPng } = require('../utils/emailLogo');
const { validateEmailColor, resolveEmailColors, contrastOnWhite } = require('../utils/emailColors');
const { createEmailService } = require('../utils/emailService');

const TEXT = 'Bonjour Camille,\n\nVotre séjour : https://sejour.example/s/abc';
const SETTINGS = { companyName: 'Domaine Solio' };

fs.mkdirSync(uploadsDir(), { recursive: true });

async function writeLogo(name, { width = 600, height = 300, color = '#2F5D46' } = {}) {
  const bytes = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
  fs.writeFileSync(path.join(uploadsDir(), name), bytes);
  return `/uploads/${name}`;
}

const darkBlock = (html) => html.split('@media (prefers-color-scheme: dark){')[1].split('}</style>')[0];

test('rule 1: the HTML part is a white letter, 600 px, 1 px line, 4 px radius, 32 px padding (20 px on a phone), on the page colour', () => {
  const html = renderGuestEmailHtml({ text: TEXT, subject: 'Séjour', heading: 'Domaine Solio' });
  const card = html.match(/<div class="gf-card"[^>]*style="([^"]*)"/)[1];
  assert.match(card, /max-width:600px/);
  assert.match(card, /padding:32px/);
  assert.match(card, /background:#FFFFFF/);
  assert.match(card, /border:1px solid #DCD4C2/);
  assert.match(card, /border-radius:4px/);
  assert.match(html, /<div class="gf-page" style="[^"]*background:#F8F5EF"/);
  assert.match(html, /@media \(max-width:600px\)\{.*\.gf-card\{padding:20px !important\}/);
  assert.match(html, /\.gf-logo\{height:56px !important\}/);
  assert.match(html, /color:#22271F/);
});

test('rule 2: with a stored logo the email carries it centred above the name, then the accent rule; no logo → the name alone', async () => {
  const logoPath = await writeLogo('company-logo.png');
  const msg = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: TEXT, settings: { ...SETTINGS, companyLogoPath: logoPath } });
  assert.match(msg.html, /<img class="gf-logo gf-logo-tile" src="cid:gf-logo-day@guestflow" alt="Domaine Solio" height="72"/);
  assert.ok(msg.html.indexOf('<img') < msg.html.indexOf('<h1'), 'the logo sits above the name');
  assert.match(msg.html, /<h1 [^>]*font-family:Georgia[^>]*letter-spacing:\.08em;text-transform:uppercase">Domaine Solio<\/h1>/);
  assert.match(msg.html, /width:56px;height:2px;[^"]*background:#C99038/);

  const bare = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: TEXT, settings: SETTINGS });
  assert.doesNotMatch(bare.html, /<img/);
  assert.match(bare.html, /<h1 [^>]*>Domaine Solio<\/h1>/);
  assert.equal('attachments' in bare, false);
});

test('rule 2: a logo the server cannot read gives an email without it, never no email', async () => {
  fs.writeFileSync(path.join(uploadsDir(), 'broken-logo.png'), Buffer.from('not an image'));
  const broken = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: TEXT, settings: { ...SETTINGS, companyLogoPath: '/uploads/broken-logo.png' } });
  const missing = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: TEXT, settings: { ...SETTINGS, companyLogoPath: '/uploads/absent.png' } });
  for (const msg of [broken, missing]) {
    assert.doesNotMatch(msg.html, /<img/);
    assert.match(msg.html, /<h1 [^>]*>Domaine Solio<\/h1>/);
    assert.equal(msg.to, 'g@example.com');
    assert.equal('attachments' in msg, false);
  }
});

test('rule 3: the logo is an inline attachment (Content-ID), a 144 px-high PNG, and nothing is loaded from the network', async () => {
  const logoPath = await writeLogo('company-logo.png', { width: 1200, height: 600 });
  const msg = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: TEXT, settings: { ...SETTINGS, companyLogoPath: logoPath } });
  assert.equal(msg.attachments.length, 1);
  const [att] = msg.attachments;
  assert.equal(att.cid, 'gf-logo-day@guestflow');
  assert.equal(att.contentDisposition, 'inline');
  assert.equal(att.contentType, 'image/png');
  const meta = await sharp(att.content).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.height, 144);
  assert.equal(meta.width, 288);
  assert.deepEqual([...new Set(msg.html.match(/(?:src|href)="[^"]+"/g) || [])].sort(), ['href="https://sejour.example/s/abc"', 'src="cid:gf-logo-day@guestflow"']);
  assert.doesNotMatch(msg.html, /url\(|@import|<link|<script|https?:\/\/[^"]*\.(?:png|jpe?g|gif)/i);
});

test('rule 3: the text/plain part is the rendered text byte for byte, with or without a logo', async () => {
  const logoPath = await writeLogo('company-logo.png');
  for (const settings of [SETTINGS, { ...SETTINGS, companyLogoPath: logoPath, emailColorLink: '#2E3B2A' }]) {
    const msg = await guestEmailMessage({ to: 'g@example.com', subject: 'Séjour', text: TEXT, settings });
    assert.equal(msg.text, TEXT);
    assert.equal(msg.subject, 'Séjour');
  }
});

test('rule 3: the logo is cached by path and modification time, so a re-upload is seen at once', async () => {
  const logoPath = await writeLogo('company-logo.png', { height: 300 });
  const first = await emailLogoPng(logoPath);
  assert.equal(await emailLogoPng(logoPath), first, 'same bytes object while the file is unchanged');
  const file = path.join(uploadsDir(), 'company-logo.png');
  await writeLogo('company-logo.png', { width: 300, height: 600 });
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  assert.equal((await sharp(await emailLogoPng(logoPath)).metadata()).width, 72);
});

test('rule 4: the email declares light and dark, and the dark block carries the fixed night palette', () => {
  const html = renderGuestEmailHtml({ text: TEXT, heading: 'Domaine Solio', colors: { page: '#F5F0E6', accent: '#B87B2A', link: '#2E3B2A' } });
  assert.match(html, /<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">/);
  const dark = darkBlock(html);
  for (const value of ['#161C16', '#1F261E', '#2E3B2A', '#ECE8DF', '#B9B3A6', '#E2B46A']) assert.ok(dark.includes(value), value);
  assert.doesNotMatch(dark, /B87B2A/, 'the accent rule keeps the configured colour: the night block does not touch it');
});

test('rule 4bis: a stored night logo is a second inline image, hidden by default and shown only in the dark block', async () => {
  const day = await writeLogo('company-logo.png');
  const night = await writeLogo('company-logo-dark.png', { color: '#F5F0E6' });
  const msg = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: TEXT, settings: { ...SETTINGS, companyLogoPath: day, companyLogoDarkPath: night } });
  assert.deepEqual(msg.attachments.map((a) => a.cid), ['gf-logo-day@guestflow', 'gf-logo-night@guestflow']);
  const nightImg = msg.html.match(/<img class="gf-logo gf-logo-night"[^>]*>/)[0];
  assert.match(nightImg, /src="cid:gf-logo-night@guestflow"/);
  assert.match(nightImg, /display:none;max-height:0;overflow:hidden;mso-hide:all/);
  const dark = darkBlock(msg.html);
  assert.match(dark, /\.gf-logo-night\{display:block !important/);
  assert.match(dark, /\.gf-logo-day\{display:none !important/);
  assert.match(msg.html, /<img class="gf-logo gf-logo-day"/);
  assert.doesNotMatch(msg.html, /<img[^>]*gf-logo-tile/);
});

test('rule 4bis: no night logo → the day logo sits on a white rounded tile in the dark block (8 px, 10 px padding)', async () => {
  const day = await writeLogo('company-logo.png');
  const msg = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: TEXT, settings: { ...SETTINGS, companyLogoPath: day } });
  assert.equal(msg.attachments.length, 1);
  assert.match(msg.html, /<img class="gf-logo gf-logo-tile"/);
  assert.match(darkBlock(msg.html), /\.gf-logo-tile\{background:#FFFFFF !important;border-radius:8px !important;padding:10px !important\}/);
  assert.doesNotMatch(msg.html, /<img[^>]*gf-logo-night/);
});

test('rule 4bis: a night logo without a day logo is ignored — there is nothing to pair it with', async () => {
  const night = await writeLogo('company-logo-dark.png');
  const msg = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: TEXT, settings: { ...SETTINGS, companyLogoDarkPath: night } });
  assert.doesNotMatch(msg.html, /<img/);
  assert.equal('attachments' in msg, false);
});

test('rule 5: the three colours from Settings drive the page, the rule and the links; empty or malformed = Maison’s defaults', async () => {
  const solio = { emailColorPage: '#F5F0E6', emailColorAccent: '#b87b2a', emailColorLink: '#2E3B2A' };
  const msg = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: TEXT, settings: { ...SETTINGS, ...solio } });
  assert.match(msg.html, /<body class="gf-body" style="[^"]*background:#F5F0E6/);
  assert.match(msg.html, /<div class="gf-page" style="[^"]*background:#F5F0E6/);
  assert.match(msg.html, /height:2px;[^"]*background:#B87B2A/);
  assert.match(msg.html, /<a href="https:\/\/sejour\.example\/s\/abc" style="color:#2E3B2A;/);
  assert.deepEqual(resolveEmailColors({}), { page: '#F8F5EF', accent: '#C99038', link: '#2F5D46' });
  assert.deepEqual(resolveEmailColors({ emailColorPage: '', emailColorAccent: null, emailColorLink: 'red' }), { page: '#F8F5EF', accent: '#C99038', link: '#2F5D46' });
  const plain = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: TEXT, settings: SETTINGS });
  assert.match(plain.html, /style="color:#2F5D46;/);
});

test('rule 5: the text colours are fixed ink and muted, whatever the settings', async () => {
  const msg = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: '- Total : 120 €', settings: { ...SETTINGS, emailColorPage: '#000000' } });
  assert.match(msg.html, /color:#22271F/);
  assert.match(msg.html, /color:#5C6153/);
});

test('rule 6: a colour is #RRGGBB only; the link needs 4.5:1 on white, the accent 3:1, and the refusal names the ratio', () => {
  assert.equal(validateEmailColor('emailColorLink', ''), '');
  assert.equal(validateEmailColor('emailColorLink', null), '');
  assert.equal(validateEmailColor('emailColorPage', '#F5F0E6'), '');
  assert.equal(validateEmailColor('emailColorLink', '#2E3B2A'), '');
  assert.equal(validateEmailColor('emailColorAccent', '#B87B2A'), '');
  for (const bad of ['red', '#FFF', '2E3B2A', '#GGGGGG', '#2E3B2AFF', 12]) {
    assert.equal(validateEmailColor('emailColorPage', bad), 'Couleur au format #RRGGBB.', String(bad));
  }
  assert.equal(validateEmailColor('emailColorLink', '#C99038'), 'Contraste 2,7:1 sur fond blanc — 4,5:1 minimum pour les liens');
  assert.match(validateEmailColor('emailColorAccent', '#FFEEAA'), /^Contraste 1,\d:1 sur fond blanc — 3:1 minimum/);
  assert.ok(contrastOnWhite('#000000') > 20.9 && contrastOnWhite('#FFFFFF') === 1.05 / 1.05);
  assert.equal(validateEmailColor('emailColorPage', '#FFFFFF'), '', 'the page colour has no contrast rule: the text sits on the white card');
});

// ---- Settings controller: save the colours, the night logo ---------------------------------------

let stored = {};
let logoDark = null;
require.cache[require.resolve('../models/settingsModel')] = {
  exports: {
    upsert(payload) { stored = { ...stored, ...payload }; },
    read() { return stored; },
    updateLogoPath() {},
    updateLogoDarkPath(p) { logoDark = p; stored = { ...stored, companyLogoDarkPath: p }; },
    smtpConfigured() { return false; },
    decryptedSmtpSettings() { return {}; },
    publicUrl() { return ''; },
  },
};
const settingsController = require('../controllers/settingsController');

function respond() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
}

test('rule 6: the settings save refuses a low-contrast link colour with 400 INVALID_EMAIL_COLOR, the field and the ratio, and writes nothing', async () => {
  stored = {};
  const res = respond();
  await settingsController.updateSettings({ body: { smtp: { emailColorLink: '#C99038', emailColorPage: '#F5F0E6' } } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_EMAIL_COLOR');
  assert.equal(res.body.field, 'emailColorLink');
  assert.equal(res.body.message, 'Contraste 2,7:1 sur fond blanc — 4,5:1 minimum pour les liens');
  assert.equal(res.body.errors.emailColorLink, res.body.message);
  assert.deepEqual(stored, {});
});

test('rule 6: a malformed colour is refused on its own field; Solio’s three values are saved; an empty string goes back to the default', async () => {
  stored = {};
  const bad = respond();
  await settingsController.updateSettings({ body: { smtp: { emailColorAccent: 'ochre' } } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.errors.emailColorAccent, 'Couleur au format #RRGGBB.');

  const ok = respond();
  await settingsController.updateSettings({ body: { smtp: { emailColorPage: '#F5F0E6', emailColorAccent: '#B87B2A', emailColorLink: '#2E3B2A' } } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual([stored.emailColorPage, stored.emailColorAccent, stored.emailColorLink], ['#F5F0E6', '#B87B2A', '#2E3B2A']);
  assert.equal(ok.body.smtp.emailColorLink, '#2E3B2A');

  const cleared = respond();
  await settingsController.updateSettings({ body: { smtp: { emailColorLink: '' } } }, cleared);
  assert.equal(cleared.statusCode, 200);
  assert.equal(stored.emailColorLink, '');
  assert.equal(cleared.body.smtp.emailColorLink, '');
});

test('rule 4bis: the night logo is uploaded and deleted like the company logo, under its own file name', async () => {
  const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#FFFFFF' } }).png().toBuffer();
  const res = respond();
  await settingsController.uploadLogoDark({ file: { buffer: png } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { company: { logoDarkPath: '/uploads/company-logo-dark.png' } });
  assert.ok(fs.existsSync(path.join(uploadsDir(), 'company-logo-dark.png')));
  assert.equal(logoDark, '/uploads/company-logo-dark.png');

  const refused = respond();
  await settingsController.uploadLogoDark({ file: { buffer: Buffer.from('<svg/>') } }, refused);
  assert.equal(refused.statusCode, 400);
  assert.equal(logoDark, '/uploads/company-logo-dark.png', 'a refused file replaces nothing');

  const none = respond();
  await settingsController.uploadLogoDark({}, none);
  assert.equal(none.statusCode, 400);

  const removed = respond();
  settingsController.deleteLogoDark({}, removed);
  assert.deepEqual(removed.body, { company: { logoDarkPath: '' } });
  assert.equal(fs.existsSync(path.join(uploadsDir(), 'company-logo-dark.png')), false);
  assert.equal(logoDark, '');
});

test('rule 4bis: the settings response carries the night logo, the colours default to empty', () => {
  const { shapeResponse } = require('../utils/settingsResponse');
  const shaped = shapeResponse({ companyLogoDarkPath: '/uploads/company-logo-dark.png', emailColorLink: '#2E3B2A' }, {}, {});
  assert.equal(shaped.company.logoDarkPath, '/uploads/company-logo-dark.png');
  assert.equal(shaped.smtp.emailColorLink, '#2E3B2A');
  assert.equal(shaped.smtp.emailColorPage, '');
  assert.equal(shapeResponse({}, {}, {}).company.logoDarkPath, '');
});

test('§5: the migration adds the four nullable columns, and existing rows read NULL', () => {
  const db = require('../database');
  const cols = db.prepare('PRAGMA table_info(app_settings)').all();
  for (const name of ['companyLogoDarkPath', 'emailColorPage', 'emailColorAccent', 'emailColorLink']) {
    const col = cols.find((c) => c.name === name);
    assert.ok(col, name);
    assert.equal(col.type, 'TEXT');
    assert.equal(col.dflt_value, null, `${name} has no default: NULL = Maison's / none`);
  }
});

// ---- One look on every path ------------------------------------------------------------------------

test('rule 8: the sent email carries the logo as cid, the preview as a data: URI; the manual send goes through the same builder', async () => {
  const { setup, call } = require('./emailTextsFixture');
  const logoPath = await writeLogo('company-logo.png');
  const { emails, mail, reservationId, templateId } = setup({ settings: { companyLogoPath: logoPath, emailColorLink: '#2E3B2A' } });
  const id = templateId('arrival_reminder_1d');

  const preview = await call(emails.preview, { query: { reservationId: String(reservationId), templateId: String(id) } });
  assert.equal(preview.status, 200);
  assert.match(preview.body.html, /<img [^>]*src="data:image\/png;base64,/);
  assert.doesNotMatch(preview.body.html, /cid:/);
  assert.match(preview.body.html, /style="color:#2E3B2A;/);

  const draft = await call(emails.previewDraft, { body: { templateId: id, language: 'fr' } });
  assert.match(draft.body.html, /<img [^>]*src="data:image\/png;base64,/);
  assert.equal('mail' in draft.body, false, 'the settings used to build the email never leave in the payload');

  const sent = await call(emails.send, { body: { reservationId, templateId: id } });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.equal(mail.sent.length, 1);
  assert.match(mail.sent[0].html, /<img [^>]*src="cid:gf-logo-day@guestflow"/);
  assert.equal(mail.sent[0].attachments.length, 1);
  assert.doesNotMatch(mail.sent[0].html, /data:image/);
});

test('rule 8: « M’envoyer un test » leaves with the logo as an inline attachment, not the preview’s data: URI', async () => {
  const { setup, call } = require('./emailTextsFixture');
  const { buildController: buildEmails } = require('../controllers/emailsController');
  const emailTemplatesModel = require('../models/emailTemplatesModel');
  const logoPath = await writeLogo('company-logo.png');
  const { db, templateId } = setup();
  const caught = [];
  const stub = require('./guestEmailSequenceFixtures').settingsStub({ companyLogoPath: logoPath });
  const tester = buildEmails({
    database: db,
    templatesModel: emailTemplatesModel.buildModel(db),
    settingsModel: { ...stub, read: () => ({ ...stub.read(), companyEmail: 'contact@lespres.fr' }), smtpConfigured: () => false },
    testMailer: { available: () => true, send: async (m) => { caught.push(m); } },
  });
  const res = await call(tester.sendTest, { body: { templateId: templateId('arrival_reminder_1d') } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(caught[0].subject, /^\[Test\] /);
  assert.match(caught[0].html, /src="cid:gf-logo-day@guestflow"/);
  assert.equal(caught[0].attachments.length, 1);
  assert.doesNotMatch(caught[0].html, /data:image/);
});

test('rule 3: the transport hands the inline attachments to the mail as they are, beside the text and HTML parts', async () => {
  const logoPath = await writeLogo('company-logo.png');
  const handed = [];
  const svc = createEmailService(
    { host: 'smtp.example', port: 587, fromEmail: 'contact@solio.example', fromName: 'Solio' },
    { env: {}, transportFactory: () => ({ sendMail: async (m) => { handed.push(m); } }) },
  );
  const msg = await guestEmailMessage({ to: 'g@example.com', subject: 's', text: TEXT, settings: { ...SETTINGS, companyLogoPath: logoPath } });
  await svc.send(msg);
  assert.equal(handed[0].text, TEXT);
  assert.equal(handed[0].html, msg.html);
  assert.deepEqual(handed[0].attachments.map((a) => a.cid), ['gf-logo-day@guestflow']);
});
