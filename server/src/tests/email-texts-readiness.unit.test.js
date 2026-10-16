// specs/guest-email-texts-made-simple.md §3.B rules 6–8 — what would render badly is computed, one
// check at a time, each item with where to fix it; the dashboard counts the items of a stay within
// 14 days; a sentence built on an empty setting is left out, never printed with a hole.

const test = require('node:test');
const assert = require('node:assert/strict');

const { setup, isoDay } = require('./emailTextsFixture');
const { buildController } = require('../controllers/emailReadinessController');
const arrivalFactsModel = require('../models/propertyArrivalFactsModel');
const { buildContext } = require('../utils/emailContextBuilder');
const { renderTemplate } = require('../utils/emailTemplateRenderer');
const { loadReservationGraph } = require('../utils/reservationEmailGraph');

const FULL = { companyName: 'Les Prés', companyPhone: '06 12 34 56 78', smtpFromName: 'Claire' };

function readiness(db, settings = FULL) {
  return buildController({ database: db, settingsModel: { read: () => settings } }).compute();
}
const ids = (r) => r.items.map((i) => i.id);
function complete(db) {
  arrivalFactsModel.buildModel(db).save(1, { address: '12 chemin des Prés', accessFr: 'Porte bleue.' });
}

test('rule 6: nothing to report on a complete instance', () => {
  const { db } = setup();
  complete(db);
  assert.deepEqual(readiness(db).items, []);
});

test('rule 6: company name, company phone and sender name are checked', () => {
  const { db } = setup();
  complete(db);
  const r = readiness(db, { companyName: '', companyPhone: '', smtpFromName: '' });
  assert.deepEqual(ids(r), ['company.name', 'company.phone', 'company.sender']);
  assert.equal(r.items[1].target.path, '/settings/etablissement');
  // The company name doubles as the sender name.
  assert.deepEqual(ids(readiness(db, { companyName: 'Les Prés', companyPhone: '1', smtpFromName: '' })), []);
});

test('rule 6: an article never confirmed is listed, a confirmed one is not', () => {
  const { db } = setup();
  complete(db);
  db.prepare('UPDATE properties SET nameArticleConfirmed = 0 WHERE id = 1').run();
  const r = readiness(db);
  assert.deepEqual(ids(r), ['property.article:1']);
  assert.equal(r.items[0].target.path, '/properties/1');
  db.prepare('UPDATE properties SET nameArticleConfirmed = 1 WHERE id = 1').run();
  assert.deepEqual(ids(readiness(db)), []);
});

test('rule 6: address and access are asked only of a property with a stay to come', () => {
  const { db } = setup();
  assert.deepEqual(ids(readiness(db)), ['property.address:1', 'property.access:1']);
  assert.deepEqual(readiness(db).items[0].target, { path: '/properties/1', search: 'tab=sejour' });
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ?').run(isoDay(-20), isoDay(-15));
  assert.deepEqual(ids(readiness(db)), []);
});

test('rule 6: a stay text or a mention with French but no English is listed', () => {
  const { db } = setup();
  complete(db);
  db.prepare("INSERT INTO stay_texts (key, propertyId, fr, en) VALUES ('house', 0, 'Café offert.', '')").run();
  db.prepare("INSERT INTO email_mentions (section, offerFr, offerEn, bookedFr, bookedEn) VALUES ('extras', 'du pain', 'bread', 'Pain prêt.', '')").run();
  const r = readiness(db);
  assert.deepEqual(ids(r), ['english:text:house', 'english:mention:1:booked']);
  assert.deepEqual(r.items[0].target, { path: '/settings/emails/textes', hash: 'j2' });
});

test('rule 6: a stored template naming an unknown variable is listed', () => {
  const { db } = setup();
  complete(db);
  db.prepare("UPDATE email_templates SET body = body || ' {{prenon}}' WHERE stableKey = 'arrival_reminder_7d'").run();
  const r = readiness(db);
  assert.equal(r.items.length, 1);
  assert.match(r.items[0].label, /Variable inconnue \{\{prenon\}\}/);
  assert.equal(r.items[0].target.hash, 'j7');
});

test('rule 7: the dashboard counts what concerns a stay within 14 days', () => {
  const { db } = setup();
  assert.equal(readiness(db).soonCount, 2);
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ?').run(isoDay(30), isoDay(33));
  const later = readiness(db);
  assert.equal(later.items.length, 2);
  assert.equal(later.soonCount, 0);
});

test('rule 8: an empty company phone leaves its sentence out of every neutral email, never a hole', () => {
  const { db, reservationId } = setup();
  const graph = loadReservationGraph(db, reservationId);
  const keys = db.prepare('SELECT stableKey FROM email_templates WHERE body LIKE ?').all('%companyPhone%').map((r) => r.stableKey);
  assert.ok(keys.length >= 8, 'the neutral templates that speak of the phone');
  for (const key of keys) {
    const t = db.prepare('SELECT * FROM email_templates WHERE stableKey = ?').get(key);
    for (const [settings, lang] of [[{ companyPhone: '' }, 'fr'], [{ companyPhone: '' }, 'en'], [{ companyPhone: '06 12 34 56 78' }, 'fr']]) {
      const side = lang === 'en' ? { subject: t.subjectEn || t.subject, body: t.bodyEn || t.body } : t;
      const out = renderTemplate(side, buildContext({ ...graph, settings, lang })).body;
      if (!settings.companyPhone) assert.doesNotMatch(out, /call us (on|at)/i, key);
      assert.doesNotMatch(out, /\{\{/, key);
      if (!settings.companyPhone) assert.doesNotMatch(out, /appelez-nous au|Appelez-nous au|disposition au/i, key);
    }
  }
  // The Google review and Instagram sentences were already conditional.
  const ctx = buildContext({ ...graph, settings: { googleReviewUrl: '', instagramUrl: '' }, lang: 'fr' });
  assert.equal(ctx.vars.reviewParagraph, '');
  assert.equal(ctx.vars.instagramParagraph, '');
});
