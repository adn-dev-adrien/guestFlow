// specs/plugins-phase-p-productisation.md §3.C rules 12–17 — a brand-new database starts neutral: no
// catering, no pool, a free baby cot, neutral sequence emails, no extinguisher row, an unsubscribe
// page in the company's name.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-neutral-')), 'new.db');
const silent = console.log;
console.log = () => {};
const db = require('../database');
console.log = silent;

const { loadReservationGraph } = require('../utils/reservationEmailGraph');
const { buildContext } = require('../utils/emailContextBuilder');
const { renderTemplate } = require('../utils/emailTemplateRenderer');
const { SEQUENCE_STABLE_KEYS } = require('../utils/guestEmailSequence');
const { buildController } = require('../controllers/public/emailPreferencesController');

const SOLIO = /Solio|Satillieu|Japperenard|Pilat|trappeur|trapper|hectare|nordique|nordic|Nespresso|domaine|domain\b|piscine|pool/i;

test('rule 12: no catering article is seeded', () => {
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM options WHERE seedKey LIKE 'drink_%' OR seedKey LIKE 'board_%'").get().n, 0);
});

test('rules 14–15: no pool season, a free baby cot, breakfast proposed in neutral words', () => {
  const s = db.prepare('SELECT poolSeasonStart, poolSeasonEnd FROM app_settings').get();
  assert.deepEqual({ ...s }, { poolSeasonStart: '', poolSeasonEnd: '' });
  assert.equal(db.prepare("SELECT price FROM options WHERE autoOptionType = 'baby_bed'").get().price, 0);
  const mentions = db.prepare('SELECT * FROM email_mentions').all();
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].section, 'extras');
  assert.match(mentions[0].offerFr, /^le petit-déjeuner/);
});

test('rule 16: no extinguisher row', () => {
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM repair_amounts WHERE repairKey LIKE 'extinguisher%'").get().n, 0);
});

test('rule 13: the six sequence emails of a new stay say nothing of Solio, in either language', () => {
  db.prepare("UPDATE app_settings SET companyName = 'Les Tilleuls', companyPhone = '01 02 03 04 05'").run();
  db.prepare("INSERT INTO properties (id, name, nameArticle, doubleBeds) VALUES (1, 'La Grange', 'à', 1)").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Sam', 'Roy', 's@x.fr')").run();
  db.prepare("INSERT INTO reservations (id, kind, propertyId, clientId, startDate, endDate, adults, children, babies, platform, finalPrice) VALUES (1, 'reservation', 1, 1, '2027-07-10', '2027-07-14', 2, 1, 1, 'direct', 600)").run();
  const graph = loadReservationGraph(db, 1);
  const settings = db.prepare('SELECT * FROM app_settings').get();
  for (const key of SEQUENCE_STABLE_KEYS) {
    const t = db.prepare('SELECT * FROM email_templates WHERE stableKey = ?').get(key);
    for (const lang of ['fr', 'en']) {
      const context = buildContext({ ...graph, settings, lang, sequence: { sendDate: '2027-11-15', giftDeadline: '2027-12-15', unsubscribeUrl: 'https://x/u' } });
      const side = lang === 'en' ? { subject: t.subjectEn, body: t.bodyEn } : { subject: t.subject, body: t.body };
      const out = renderTemplate(side, context);
      assert.doesNotMatch(`${out.subject}\n${out.body}`, SOLIO, `${key}/${lang}`);
      assert.deepEqual(out.missingVariables, [], `${key}/${lang}`);
      assert.doesNotMatch(out.body, /\n{3,}/, `${key}/${lang}: no stray blank lines`);
    }
  }
});

test('rule 17: the unsubscribe page speaks for the company, « GuestFlow » without one', () => {
  const page = () => {
    let html = '';
    const res = { set() {}, status() { return this; }, type() { return this; }, send(h) { html = h; return this; } };
    buildController({ preferences: { findByToken: () => null }, database: db }).show({ query: { t: 'x' } }, res);
    return html;
  };
  assert.match(page(), /<h1>Vos nouvelles de Les Tilleuls<\/h1>/);
  assert.doesNotMatch(page(), /Solio|domaine|bons cadeau|vœux/i);
  db.prepare("UPDATE app_settings SET companyName = ''").run();
  assert.match(page(), /<h1>Vos nouvelles de GuestFlow<\/h1>/);
});
