// specs/calendar-property-parity.md rules 5-7 — the server picks the readable text colour of a bar, the
// built-in palette reaches 4.5:1 on every platform, and a custom colour the calendar cannot print legibly
// is refused (the previous colour stays).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const { contrastRatio, textColorFor, validateCalendarColor, WHITE, INK } = require('../utils/colorContrast');
const { KNOWN_PLATFORM_COLORS, DEFAULT_PLATFORM_COLOR } = require('../constants/platformColors');
const platformsModel = require('../models/platformsModel');
const propertiesModel = require('../models/propertiesModel');
const platformsController = require('../controllers/platformsController');

function fakeRes() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
const putColor = (key, color) => {
  const res = fakeRes();
  platformsController.setColor({ params: { key }, body: { color } }, res);
  return res;
};

test('rule 5 — contrastRatio matches the WCAG reference pairs', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF').toFixed(2), '21.00');
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF').toFixed(2), '1.00');
  assert.equal(contrastRatio('#777777', '#FFFFFF').toFixed(2), '4.48');
});

test('rule 5 — textColorFor picks white on a dark fill and ink on a light one', () => {
  assert.equal(textColorFor('#1B3F8B'), WHITE);
  assert.equal(textColorFor('#F2CC3D'), INK);
  assert.equal(textColorFor('#FEC700'), INK, 'the custom Lodgify yellow');
});

test('rule 6 — every built-in colour reaches 4.5:1 with its text colour', () => {
  for (const [slug, color] of Object.entries({ ...KNOWN_PLATFORM_COLORS, unknown: DEFAULT_PLATFORM_COLOR })) {
    assert.ok(contrastRatio(color, textColorFor(color)) >= 4.5, `${slug} ${color}`);
    assert.equal(validateCalendarColor(color), null, `${slug} is itself a valid colour`);
  }
});

test('rule 6 — one hue per platform: no two built-in platforms share a colour', () => {
  const bySlug = { ...KNOWN_PLATFORM_COLORS };
  delete bySlug.gitedefrance; // the singular spelling is an alias of the plural
  const colors = Object.values(bySlug).map((c) => c.toUpperCase());
  assert.equal(new Set(colors).size, colors.length);
});

test('rule 7 — validateCalendarColor refuses what the calendar cannot print legibly, with the three messages', () => {
  assert.equal(validateCalendarColor('red'), 'Couleur invalide.');
  assert.equal(validateCalendarColor('#12345'), 'Couleur invalide.');
  assert.equal(validateCalendarColor(''), 'Couleur invalide.');
  assert.equal(validateCalendarColor('#808080'), 'Couleur peu lisible : choisir plus clair ou plus foncé.', 'a mid grey: neither white nor ink reaches 4.5:1');
  assert.equal(validateCalendarColor('#EEEEEE'), 'Couleur trop claire pour le calendrier.');
  assert.equal(validateCalendarColor('#fec700'), null);
});

test('rule 7 — PUT of a refused colour answers 400 and keeps the previous colour', () => {
  assert.equal(putColor('Booking', '#123456').statusCode, 200);
  for (const [bad, message] of [['#808080', /peu lisible/], ['#EEEEEE', /trop claire/], ['bleu', /invalide/]]) {
    const res = putColor('Booking', bad);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, message);
    assert.equal(platformsModel.getColor('Booking'), '#123456', 'the previous colour stays');
  }
  const ok = putColor('Booking', '#1b3f8b');
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.textColor, WHITE);
  assert.equal(platformsModel.getColor('Booking'), '#1B3F8B', 'the built-in colour clears the override');
});

test('rule 7 — the bulk save refuses the same colours and writes nothing', () => {
  platformsModel.setColor('Airbnb', '');
  const row = platformsModel.listSettings().find((p) => p.name === 'Airbnb');
  const res = fakeRes();
  platformsController.saveSettings({ body: { platforms: [{ id: row.id, color: '#EEEEEE' }] } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errors[String(row.id)].color, 'Couleur trop claire pour le calendrier.');
  assert.equal(platformsModel.getColor('Airbnb'), '#C93848');
});

test('rule 5 — the platform-colour listing carries textColors, custom overrides included', () => {
  platformsModel.setColor('Pitchup', '#FEC700');
  const { textColors, knownColors } = propertiesModel.getPlatformColors();
  assert.equal(textColors.airbnb, WHITE);
  assert.equal(textColors.booking, WHITE);
  assert.equal(textColors.abritel, INK);
  assert.equal(textColors.pitchup, INK, 'the override wins over the built-in orange');
  assert.equal(knownColors.airbnb, '#C93848');
  assert.equal(db.prepare("SELECT color FROM platforms WHERE name = 'Pitchup'").get().color, '#FEC700');
});

test('rule 27 — the boot backfill does not freeze the old palette as custom colours; a real custom colour is kept', () => {
  const { backfillPlatformColors } = require('../utils/platformColorBackfill');
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const mem = new Database(':memory:');
  mem.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  mem.prepare("INSERT INTO properties (id, name) VALUES (1, 'Granja')").run();
  const LEGACY = [['Airbnb', '#FF5A5F'], ['Booking', '#003580'], ['GitesDeFrance', '#e6c832'], ['Greengo', '#4CAF50'],
    ['Abracadaroom', '#00bcd4'], ['Campspace', '#757575'], ['direct', '#c9a227'], ['Pitchup', '#f57c00'], ['Abritel', '#1565c0'], ['Lodgify', '#fec700']];
  for (const [label, color] of LEGACY) {
    mem.prepare('INSERT OR IGNORE INTO platforms (name) VALUES (?)').run(label);
    mem.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, platformColor) VALUES (1, ?, '', ?, ?, ?)").run(label, label.toLowerCase(), label, color);
  }
  assert.deepEqual(backfillPlatformColors(mem), ['Lodgify'], 'only Lodgify #fec700 is custom');
  const stored = Object.fromEntries(mem.prepare('SELECT name, color FROM platforms WHERE color IS NOT NULL').all().map((r) => [r.name, r.color]));
  assert.deepEqual(stored, { Lodgify: '#fec700' });
  assert.deepEqual(backfillPlatformColors(mem), [], 'idempotent');
});

test('rule 27 — the colour listing ignores a per-source colour that is only an old built-in default', () => {
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Granja')").run();
  db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, platformColor, isActive) VALUES (1, 'Abritel', '', 'abritel', 'Abritel', '#1565c0', 1)").run();
  db.prepare("INSERT INTO ical_sources (propertyId, name, url, platformKey, platformLabel, platformColor, isActive) VALUES (1, 'Lodgify', '', 'lodgify', 'Lodgify', '#fec700', 1)").run();
  const { customColors } = propertiesModel.getPlatformColors();
  assert.equal(customColors.abritel, undefined, 'the old brand blue does not mask the new palette');
  assert.equal(customColors.lodgify, '#fec700');
});
