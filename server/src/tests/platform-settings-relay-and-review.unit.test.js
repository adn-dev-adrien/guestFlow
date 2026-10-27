// specs/platform-settings-relay-and-review.md — « Adresse e-mail relais » and « Où laisser un avis » are
// platform settings: the one-shot migration writes what the code knew by name onto an existing database
// (and nothing on a new one), the settings page serves and saves them, and the J+1 paragraph Solio's
// guests receive is byte-identical to the one the hard-coded names produced (audit 2026-10-27).
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-relay-review-')), 'r.db');

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const silent = console.log;
console.log = () => {};
const db = require('../database');
const platformsController = require('../controllers/platformsController');
const {
  isRelayChannel, platformReviewWhere, refreshGuestContactChannels, setDirectChannels,
} = require('../utils/platformNameFormat');
const { applyPlatformGuestContactSchema, runPlatformGuestContactMigration } = require('../utils/platformGuestContactMigration');
const { planSeasonMail, MAIL } = require('../utils/guestEmailSequence');
const { buildStayContent } = require('../utils/stayContentContext');
const { withSolioWording } = require('./solioWordingFixture');
const BEFORE = require('./fixtures/platform-review-paragraphs-before.json');
console.log = silent;

setDirectChannels(['Lodgify']);

function legacyDb(names) {
  const mem = new Database(':memory:');
  mem.exec('CREATE TABLE migrations (name TEXT PRIMARY KEY); CREATE TABLE platforms (id INTEGER PRIMARY KEY, name TEXT UNIQUE)');
  names.forEach((name) => mem.prepare('INSERT INTO platforms (name) VALUES (?)').run(name));
  applyPlatformGuestContactSchema(mem);
  return mem;
}
const rowsOf = (mem) => Object.fromEntries(mem.prepare('SELECT name, relaysGuestEmail, reviewWhereFr, reviewWhereEn FROM platforms').all()
  .map((r) => [r.name, r]));

test('migration: Airbnb / Booking rows relay the address, the three named platforms keep their wording', () => {
  const mem = legacyDb(['direct', 'Airbnb', 'AirbnbTente', 'BookingCom', 'GitesDeFrance', 'Abracadaroom', 'Lodgify']);
  assert.deepEqual(runPlatformGuestContactMigration(mem), { action: 'migrated', relays: 3, reviews: 4 });
  const rows = rowsOf(mem);
  for (const name of ['Airbnb', 'AirbnbTente', 'BookingCom']) assert.equal(rows[name].relaysGuestEmail, 1, name);
  for (const name of ['direct', 'GitesDeFrance', 'Abracadaroom', 'Lodgify']) assert.equal(rows[name].relaysGuestEmail, 0, name);
  assert.deepEqual([rows.GitesDeFrance.reviewWhereFr, rows.GitesDeFrance.reviewWhereEn], ['votre espace Gîtes de France', 'your Gîtes de France account']);
  assert.deepEqual([rows.BookingCom.reviewWhereFr, rows.Airbnb.reviewWhereEn], ['Booking', 'Airbnb']);
  assert.equal(rows.Abracadaroom.reviewWhereFr, null);
});

test('migration: one shot — an operator who unticks keeps it unticked; a new database has nothing ticked', () => {
  const mem = legacyDb(['Airbnb']);
  runPlatformGuestContactMigration(mem);
  mem.prepare("UPDATE platforms SET relaysGuestEmail = 0 WHERE name = 'Airbnb'").run();
  assert.equal(runPlatformGuestContactMigration(mem).action, 'skipped');
  assert.equal(rowsOf(mem).Airbnb.relaysGuestEmail, 0);

  const fresh = legacyDb([]);
  runPlatformGuestContactMigration(fresh);
  fresh.prepare("INSERT INTO platforms (name) VALUES ('Airbnb')").run();
  refreshGuestContactChannels(fresh);
  assert.equal(isRelayChannel('Airbnb'), false, 'no platform name is known to the code any more');
});

test('the season mails read the switch, not the platform name', () => {
  const mem = legacyDb(['Abritel']);
  runPlatformGuestContactMigration(mem);
  const stay = { id: 1, clientId: 1, platform: 'Abritel', startDate: '2026-05-01', endDate: '2026-05-04' };
  const plan = () => planSeasonMail({ stableKey: MAIL.NOVEMBER, client: { id: 1, email: 'a@b.fr' }, stays: [stay], sendDate: '2027-11-15', startDate: '2026-01-01' });
  refreshGuestContactChannels(mem);
  assert.equal(plan().blocked, null);
  mem.prepare("UPDATE platforms SET relaysGuestEmail = 1 WHERE name = 'Abritel'").run();
  refreshGuestContactChannels(mem);
  assert.equal(plan().blocked, 'relayAddress');
});

function review(platform, lang, googleReviewUrl) {
  return buildStayContent({
    reservation: { id: 1, startDate: '2027-07-10', endDate: '2027-07-17', adults: 2, platform },
    client: { id: 1, email: 'c@x.fr' },
    property: { name: 'La Granja', nameArticle: 'à' },
    options: [],
    facts: withSolioWording({ optionMeta: {}, available: [] }),
    settings: { googleReviewUrl },
    lang,
    sequence: {},
  }).vars.reviewParagraph;
}

test('J+1: after the migration, the paragraphs Solio sends are byte-identical to the hard-coded ones', () => {
  const mem = legacyDb(['GitesDeFrance', 'Airbnb', 'Booking']);
  runPlatformGuestContactMigration(mem);
  refreshGuestContactChannels(mem);
  for (const [key, expected] of Object.entries(BEFORE)) {
    const [platform, lang, google] = key.split('|');
    assert.equal(review(platform, lang, google === 'google' ? 'https://g.page/r/solio/review' : ''), expected, key);
  }
});

test('J+1: another operator writes its own wording; nothing written → the display name; empty English → French', () => {
  const mem = legacyDb(['Abracadaroom', 'GitesDeFrance', 'Greengo']);
  runPlatformGuestContactMigration(mem);
  mem.prepare("UPDATE platforms SET reviewWhereFr = 'votre compte Abracadaroom', reviewWhereEn = NULL WHERE name = 'Abracadaroom'").run();
  mem.prepare("UPDATE platforms SET reviewWhereFr = NULL, reviewWhereEn = NULL WHERE name = 'GitesDeFrance'").run();
  refreshGuestContactChannels(mem);
  assert.match(review('Abracadaroom', 'fr', ''), /quelques mots sur votre compte Abracadaroom nous/);
  assert.equal(platformReviewWhere('Abracadaroom', 'en'), 'votre compte Abracadaroom');
  assert.match(review('GitesDeFrance', 'fr', ''), /quelques mots sur Gîtes de France nous/);
  assert.match(review('Greengo', 'en', ''), /a few words on GreenGo would/);
});

// The settings page.
for (const name of ['Airbnb', 'Booking', 'Lodgify']) db.prepare('INSERT OR IGNORE INTO platforms (name) VALUES (?)').run(name);
// Lodgify is an own channel here: counted as a direct sale (every save re-reads that set).
db.prepare("UPDATE platforms SET countsAsDirect = 1 WHERE name = 'Lodgify'").run();
const idOf = (name) => db.prepare('SELECT id FROM platforms WHERE name = ?').get(name).id;
function call(handler, body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  handler({ body, params: {}, query: {} }, res);
  return res;
}
const rowOf = (res, name) => res.body.platforms.find((p) => p.name === name);

test('settings: served per platform, null on the own channels', () => {
  const res = call(platformsController.listSettings);
  assert.equal(rowOf(res, 'direct').relaysGuestEmail, null);
  assert.equal(rowOf(res, 'direct').reviewWhereFr, null);
  assert.equal(rowOf(res, 'Airbnb').relaysGuestEmail, false, 'rows created after the migration are ticked by nobody');
  assert.equal(rowOf(res, 'Airbnb').reviewWhereFr, '');
});

test('settings: a save writes both, and the caches follow without a restart', () => {
  const res = call(platformsController.saveSettings, {
    platforms: [{ id: idOf('Booking'), relaysGuestEmail: true, reviewWhereFr: '  Booking.com  ', reviewWhereEn: '' }],
  });
  assert.equal(res.statusCode, 200);
  assert.equal(rowOf(res, 'Booking').relaysGuestEmail, true);
  assert.equal(rowOf(res, 'Booking').reviewWhereFr, 'Booking.com');
  assert.equal(isRelayChannel('Booking'), true);
  assert.equal(platformReviewWhere('Booking', 'en'), 'Booking.com');
});

test('settings: a wording too long refuses the whole save; an own channel is never written', () => {
  const res = call(platformsController.saveSettings, {
    platforms: [{ id: idOf('Airbnb'), relaysGuestEmail: true }, { id: idOf('Booking'), reviewWhereFr: 'x'.repeat(81) }],
  });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.errors[String(idOf('Booking'))].reviewWhereFr);
  assert.equal(isRelayChannel('Airbnb'), false, 'nothing written');
  call(platformsController.saveSettings, { platforms: [{ id: idOf('Lodgify'), relaysGuestEmail: true, reviewWhereFr: 'Lodgify' }] });
  const lodgify = db.prepare("SELECT relaysGuestEmail, reviewWhereFr FROM platforms WHERE name = 'Lodgify'").get();
  assert.deepEqual({ ...lodgify }, { relaysGuestEmail: 0, reviewWhereFr: null });
});
