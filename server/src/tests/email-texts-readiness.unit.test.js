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
  arrivalFactsModel.buildModel(db).save(1, { address: '12 chemin des Prés', accessFr: 'Porte bleue.', wifiName: 'Gite' });
}
/** A Solio-shaped J-2: the address written by hand, the phone printed plainly, no arrival paragraph. */
function handWrittenJ2(db) {
  db.prepare(`UPDATE email_templates SET body = 'Bonjour {{clientFirstName}}, 215 côte de Japperenard. Appelez-nous au {{companyPhone}}.'
    WHERE stableKey = 'arrival_reminder_1d'`).run();
}

test('rule 6: nothing to report on a complete instance', () => {
  const { db } = setup();
  complete(db);
  assert.deepEqual(readiness(db).items, []);
});

test('rule 6: company name, company phone and sender name are checked', () => {
  const { db } = setup();
  complete(db);
  // The neutral templates guard the phone sentence: no phone, no hole, nothing to ask.
  assert.deepEqual(ids(readiness(db, { companyName: '', companyPhone: '', smtpFromName: '' })), ['company.name', 'company.sender']);
  handWrittenJ2(db);
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

test('rule 6: address, access and Wi-Fi are asked only of a property with a stay to come', () => {
  const { db } = setup();
  assert.deepEqual(ids(readiness(db)), ['property.address:1', 'property.access:1', 'property.wifi:1']);
  db.prepare('UPDATE properties SET hasWifi = 0 WHERE id = 1').run();
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
  assert.equal(readiness(db).soonCount, 3);
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ?').run(isoDay(30), isoDay(33));
  const later = readiness(db);
  assert.equal(later.items.length, 3);
  assert.equal(later.soonCount, 0);
});

test('rule 6: a fact no stored template uses is never asked for — Solio needs nothing', () => {
  const { db } = setup();
  handWrittenJ2(db);
  // The other neutral emails do not place the arrival paragraphs either once the J-2 is hand-written.
  assert.deepEqual(readiness(db).items, []);
  assert.equal(readiness(db).soonCount, 0);
});

test('rule 6: the company address stands in for the property address', () => {
  const { db } = setup();
  arrivalFactsModel.buildModel(db).save(1, { accessFr: 'Porte bleue.', wifiName: 'Gite' });
  assert.deepEqual(ids(readiness(db)), ['property.address:1']);
  const derived = readiness(db, { ...FULL, companyAddress: '12 chemin des Prés, Pélussin' });
  // Said once, never urgent: a company domiciled elsewhere notices.
  assert.deepEqual(derived.items.map((i) => [i.id, i.label, i.soon]), [
    ['property.address-company:1', 'Adresse — Le Gîte : celle de l’entreprise est utilisée', false],
  ]);
  assert.deepEqual(derived.items[0].target, { path: '/properties/1', search: 'tab=sejour' });
  assert.equal(derived.soonCount, 0);
  // A template that never places the address asks nothing, derived or not (Solio).
  handWrittenJ2(db);
  assert.deepEqual(readiness(db, { ...FULL, companyAddress: '12 chemin des Prés, Pélussin' }).items, []);
});

test('rule 7: an English gap is urgent only when an English-speaking guest arrives within 14 days', () => {
  const { db } = setup();
  complete(db);
  db.prepare("INSERT INTO stay_texts (key, propertyId, fr, en) VALUES ('house', 0, 'Café offert.', '')").run();
  assert.deepEqual(ids(readiness(db)), ['english:text:house']);
  assert.equal(readiness(db).soonCount, 0);
  db.exec("ALTER TABLE reservations ADD COLUMN emailLanguage TEXT DEFAULT 'fr'");
  db.prepare("UPDATE reservations SET emailLanguage = 'en'").run();
  assert.equal(readiness(db).soonCount, 1);
  // A sentence no template places is not reported: the J-2 no longer says « Dans le logement ».
  db.prepare("UPDATE email_templates SET body = 'Bonjour.' WHERE stableKey = 'arrival_reminder_1d'").run();
  assert.deepEqual(ids(readiness(db)).filter((id) => id.startsWith('english:')), []);
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
