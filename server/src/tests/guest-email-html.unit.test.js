// specs/guest-email-texts-made-simple.md rules 37–39 (UI/UX review 2026-10-18, decision 15) — a guest
// email leaves as multipart/alternative: the rendered text unchanged, and a sober HTML part derived from
// that same text, escaped, with plain links and nothing loaded from anywhere.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { guestEmailMessage, renderGuestEmailHtml, textToHtmlBody } = require('../utils/guestEmailHtml');
const { createEmailService } = require('../utils/emailService');
const { FIXTURES } = require('./productisationGoldenFixture');

const guestEmailSendsModel = require('../models/guestEmailSendsModel');
const emailTemplatesModel = require('../models/emailTemplatesModel');
const emailLogModel = require('../models/emailLogModel');
const emailPreferencesModel = require('../models/emailPreferencesModel');
const { runSequencePass } = require('../utils/guestEmailSequenceRunner');
const { freshDb, seedProperty, seedClient, seedReservation, settingsStub, setSequenceMode, mailer } = require('./guestEmailSequenceFixtures');

const GOLDEN = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'golden.json'), 'utf8'));
const goldenBody = (key) => GOLDEN[key].split('\n\n').slice(1).join('\n\n');
const goldenSubject = (key) => GOLDEN[key].split('\n\n')[0];

test('rule 38: everything the text says is escaped — no tag, attribute or entity of the guest’s text survives', () => {
  const html = renderGuestEmailHtml({
    subject: '<script>alert(1)</script>',
    heading: 'Gîte <b>"Les Pins"</b> & Co',
    text: 'Bonjour <b>Léa</b> & "Tom",\n\n- Code : <img src=x onerror=alert(1)>\n- Accès : \'porte\'',
  });
  assert.doesNotMatch(html, /<script|<img|<b>|onerror=alert\(1\)>/);
  assert.match(html, /<title>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/title>/);
  assert.match(html, /Gîte &lt;b&gt;&quot;Les Pins&quot;&lt;\/b&gt; &amp; Co<\/h1>/);
  assert.match(html, /Bonjour &lt;b&gt;Léa&lt;\/b&gt; &amp; &quot;Tom&quot;,/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&#39;porte&#39;/);
});

test('rule 38: only web, email and phone addresses become links, each showing its own text', () => {
  const body = textToHtmlBody('Payer : https://pay.example.com/l/1?a=1&b="2".\nOu javascript:alert(1) et data:text/html,x.\nÉcrire à hote@domaine.fr, appeler le 06 15 73 93 37 ou +33 6 15 73 93 37.');
  assert.match(body, /<a href="https:\/\/pay\.example\.com\/l\/1\?a=1&amp;b=" style="[^"]*">https:\/\/pay\.example\.com\/l\/1\?a=1&amp;b=<\/a>&quot;2&quot;\./);
  assert.match(body, /<a href="mailto:hote@domaine\.fr"[^>]*>hote@domaine\.fr<\/a>,/);
  assert.match(body, /<a href="tel:0615739337"[^>]*white-space:nowrap[^>]*>06 15 73 93 37<\/a>/);
  assert.match(body, /<a href="tel:\+33615739337"[^>]*>\+33 6 15 73 93 37<\/a>\./);
  assert.doesNotMatch(body, /href="(javascript|data):/);
  assert.equal((body.match(/<a /g) || []).length, 4);
});

test('rule 38: paragraphs, line breaks, lists and the « Libellé : valeur » recap', () => {
  const body = textToHtmlBody('Bonjour Camille,\n\nVotre séjour :\n- Logement : La Granja\n- Arrivée : le samedi 10 juillet 2027 à partir de 16 h\n- Montant du séjour : 1240,00 €\n\nDans vos bagages :\n- Des chaussures fermées\n- Maillots de bain\n\nÀ très bientôt,\nAdrien et Sophie');
  assert.match(body, /^<p style="margin:0 0 16px">Bonjour Camille,<\/p>/);
  assert.match(body, /<p style="margin:0 0 8px">Votre séjour :<\/p><table role="presentation"/);
  assert.equal((body.match(/<tr>/g) || []).length, 3);
  assert.match(body, />Arrivée<\/td><td [^>]*>le samedi 10 juillet 2027 à partir de 16 h<\/td>/);
  assert.match(body, />1240,00&nbsp;€<\/td>/);
  assert.match(body, /<ul [^>]*><li [^>]*>Des chaussures fermées<\/li><li [^>]*>Maillots de bain<\/li><\/ul>/);
  assert.match(body, /<p style="margin:0 0 16px">À très bientôt,<br>Adrien et Sophie<\/p>$/);
});

test('rule 39: the document loads nothing, tracks nothing, holds 600 px and has its dark-mode colours', () => {
  const html = renderGuestEmailHtml({ text: 'Bonjour,\n\nTout est sur https://map.example.com', subject: 'Séjour', heading: 'Domaine Solio', lang: 'en' });
  assert.match(html, /^<!doctype html>\n<html lang="en">/);
  assert.match(html, /<meta name="color-scheme" content="light dark">/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)\{/);
  assert.match(html, /max-width:600px/);
  assert.match(html, /<h1 [^>]*font-family:'Iowan Old Style'[^>]*>Domaine Solio<\/h1>/);
  assert.doesNotMatch(html, /<img|<link|<script|<iframe|<form|src=|url\(|@import/i);
  const urls = html.match(/https?:\/\/[^"<\s]+/g) || [];
  assert.deepEqual([...new Set(urls)], ['https://map.example.com']);
  assert.doesNotMatch(renderGuestEmailHtml({ text: 'x', heading: '' }), /<h1/);
});

test('rule 37 (golden): on Solio’s six sequence emails, FR and EN, the text part is the rendered text byte for byte and the HTML part prints no variable', () => {
  const keys = Object.keys(GOLDEN);
  assert.ok(keys.length >= 72);
  for (const key of keys) {
    const text = goldenBody(key);
    const lang = key.endsWith('/en') ? 'en' : 'fr';
    const msg = guestEmailMessage({ to: 'g@example.com', subject: goldenSubject(key), text, settings: { companyName: 'Domaine Solio' }, lang });
    assert.equal(msg.text, text, key);
    assert.equal(msg.subject, goldenSubject(key), key);
    assert.doesNotMatch(msg.html.split('</style>')[1], /\{\{|\}\}|⟦|⟧/, key);
    assert.match(msg.html, new RegExp(`<html lang="${lang}">`), key);
    for (const url of text.match(/https?:\/\/[^\s<>"]+[^\s<>".,;:!?)»’']/g) || []) {
      assert.ok(msg.html.includes(`href="${url.replace(/&/g, '&amp;')}"`), `${key}: ${url}`);
    }
  }
});

test('rule 37: the heading is the sender’s name, as the email signs (override, else the company)', () => {
  assert.match(guestEmailMessage({ subject: 's', text: 't', settings: { companyName: 'SARL Solio', smtpFromName: 'Domaine Solio' } }).html, />Domaine Solio<\/h1>/);
  assert.match(guestEmailMessage({ subject: 's', text: 't', settings: { companyName: 'SARL Solio' } }).html, />SARL Solio<\/h1>/);
});

test('rule 37: the sequence sends both parts, and the text is the one the history records', async () => {
  const db = freshDb();
  setSequenceMode(db, 'auto');
  seedProperty(db);
  seedClient(db);
  seedReservation(db);
  const mail = mailer();
  const deps = {
    database: db,
    ledger: guestEmailSendsModel.buildModel(db),
    templatesModel: emailTemplatesModel.buildModel(db),
    logModel: emailLogModel.buildModel(db),
    settingsModel: settingsStub(),
    emailServiceFactory: mail.factory,
    preferences: emailPreferencesModel.buildModel(db),
  };
  await runSequencePass(deps, { today: '2027-07-03' });
  assert.equal(mail.sent.length, 1);
  const [sent] = mail.sent;
  const logged = db.prepare('SELECT renderedBody FROM email_log ORDER BY id DESC LIMIT 1').get();
  assert.equal(sent.text, logged.renderedBody);
  assert.match(sent.html, /^<!doctype html>/);
  assert.ok(sent.html.includes(textToHtmlBody(sent.text)));
});

test('rule 37: the transport receives `html` beside `text`; without it, the message stays plain text', async () => {
  const calls = [];
  const svc = createEmailService(
    { host: 'smtp.example', port: 587, fromEmail: 'a@b.c', fromName: 'Solio' },
    { env: {}, transportFactory: () => ({ sendMail: async (m) => { calls.push(m); return {}; } }) },
  );
  await svc.send({ to: 'g@x.y', subject: 's', text: 'Bonjour', html: '<p>Bonjour</p>' });
  await svc.send({ to: 'g@x.y', subject: 's', text: 'Bonjour' });
  assert.equal(calls[0].text, 'Bonjour');
  assert.equal(calls[0].html, '<p>Bonjour</p>');
  assert.equal('html' in calls[1], false);
});

test('rule 37: the dev mail catcher keeps the HTML part and the raw multipart/alternative message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-guest-html-'));
  const svc = createEmailService(
    { host: 'smtp.example', port: 587, fromEmail: 'contact@solio.example', fromName: 'Solio' },
    { env: { GUESTFLOW_MAIL_OUTBOX: dir }, transportFactory: () => { throw new Error('never'); } },
  );
  const msg = guestEmailMessage({ to: 'g@example.com', subject: 'Votre séjour', text: 'Bonjour,\n\nÀ bientôt', settings: { companyName: 'Solio' } });
  await svc.send(msg);
  const [file] = fs.readdirSync(dir);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  assert.equal(saved.text, msg.text);
  assert.equal(saved.html, msg.html);
  assert.match(saved.mime, /Content-Type: multipart\/alternative;/);
  const textAt = saved.mime.indexOf('Content-Type: text/plain; charset=utf-8');
  const htmlAt = saved.mime.indexOf('Content-Type: text/html; charset=utf-8');
  assert.ok(textAt > 0 && htmlAt > textAt, 'the text part comes first, the HTML part last');
});

test('rule 37: the preview answers the HTML part beside the text, and the test send carries both', async () => {
  const { setup, call } = require('./emailTextsFixture');
  const { buildController: buildEmails } = require('../controllers/emailsController');
  const { db, emails, templateId } = setup();
  const res = await call(emails.previewDraft, { body: { templateId: templateId('arrival_reminder_1d'), language: 'fr' } });
  assert.equal(res.status, 200);
  assert.match(res.body.body, /^Bonjour Camille,/);
  assert.ok(res.body.html.includes(textToHtmlBody(res.body.body)));

  const caught = [];
  const tester = buildEmails({
    database: db,
    templatesModel: emailTemplatesModel.buildModel(db),
    settingsModel: { read: () => ({ companyEmail: 'contact@lespres.fr' }), smtpConfigured: () => false },
    testMailer: { available: () => true, send: async (m) => { caught.push(m); } },
  });
  await call(tester.sendTest, { body: { templateId: templateId('arrival_reminder_1d') } });
  assert.equal(caught.length, 1);
  assert.ok(caught[0].html.includes(textToHtmlBody(caught[0].text)));
});

test('rule 40: a reference or a code is never a phone link; a phone is, grouped or announced', () => {
  const plain = (text) => textToHtmlBody(text).replace(/ style="[^"]*"/g, '');
  for (const ref of ['Réservation HA-0123456789', 'Booking 2026-0412345678', 'Code wifi : 0612345678', 'Boîte à clés : 0612345678', 'Dossier 12/0612345678']) {
    assert.doesNotMatch(plain(ref), /<a /, ref);
  }
  assert.match(plain('Appelez-nous au 0612345678.'), /<a href="tel:0612345678">0612345678<\/a>\./);
  assert.match(plain('Tél. : 0612345678'), /<a href="tel:0612345678">/);
  assert.match(plain('Code wifi : 06 12 34 56 78'), /<a href="tel:0612345678">06 12 34 56 78<\/a>/);
  assert.match(plain('+33 6 12 34 56 78 ou +33612345678'), /^<p><a href="tel:\+33612345678">\+33 6 12 34 56 78<\/a> ou <a href="tel:\+33612345678">\+33612345678<\/a><\/p>$/);
});

test('rule 40: a closing parenthesis stays in an address that opened one; an apostrophe stays in an email', () => {
  const plain = (text) => textToHtmlBody(text).replace(/ style="[^"]*"/g, '');
  assert.match(plain('Voir https://fr.wikipedia.org/wiki/Gîte_(hébergement).'), /href="https:\/\/fr\.wikipedia\.org\/wiki\/Gîte_\(hébergement\)">[^<]+<\/a>\.<\/p>/);
  assert.match(plain('(https://x.fr/a).'), /^<p>\(<a href="https:\/\/x\.fr\/a">https:\/\/x\.fr\/a<\/a>\)\.<\/p>$/);
  assert.match(plain("Écrire à jean.o'brien@ex.com."), /<a href="mailto:jean\.o&#39;brien@ex\.com">jean\.o&#39;brien@ex\.com<\/a>\./);
});

test('rule 40: no heading when the instance has no name of its own (the « GuestFlow » fallback)', () => {
  assert.doesNotMatch(guestEmailMessage({ subject: 's', text: 't', settings: {} }).html, /<h1/);
});
