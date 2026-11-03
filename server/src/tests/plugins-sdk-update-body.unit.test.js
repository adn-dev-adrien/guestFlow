// specs/plugins-phase-1-sdk.md rule 38 (audit R20, E20-1) — `ctx.core.reservations.updateBody(id)` (SDK 2.21.0)
// hands the very body `ctx.core.reservations.update` spreads a patch over, so a plugin that rewrites a line list
// starts from the fiche's own lines and can never drop a field the fiche's save carries again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const semver = require('semver');

process.env.DB_PATH = ':memory:';
const f = require('./reservationSaveFixture');
const core = require('../plugins/sdk/coreServices');
const reservationsModel = require('../models/reservationsModel');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { SDK_VERSION } = require('../plugins/sdk/version');
const { readSourceManifest } = require('../plugins/manifest');
const { PLUGIN_IDS } = require('../constants/plugins');

f.seed();
f.db.prepare("INSERT INTO options (id, title, priceType, price, showsPlanningCard) VALUES (60, 'Petit déjeuner', 'per_person', 10, 1)").run();
f.db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 60)').run();

const MOMENTS = [{ date: f.inDays(271), time: '08:30' }];
const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

function pluginSources(id) {
  const out = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'node_modules') walk(p); return; }
    if (e.name.endsWith('.js')) out.push(fs.readFileSync(p, 'utf8'));
  });
  walk(path.join(PLUGINS_DIR, id));
  return out.join('\n');
}

test('rule 38: updateBody is the body update spreads over, planning-card fields included', () => {
  const id = f.createStay({
    adults: 4,
    options: [{ optionId: 60, quantity: 1, cardOccurrences: MOMENTS, cardPersons: 3 }],
    customOptions: [{ customKey: 'custom_1', description: 'Panier', amount: 25, offered: false, inComplement: 0 }],
  });
  const body = core.reservations.updateBody(id);
  const autoIds = new Set(f.db.prepare('SELECT id FROM options WHERE COALESCE(autoEnabled, 0) = 1').all().map((o) => o.id));
  assert.deepEqual(body, toUpdateBody(reservationsModel.getByIdWithDetails(id), autoIds));
  const card = body.options.find((o) => Number(o.optionId) === 60);
  assert.deepEqual(card.cardOccurrences.map(({ date, time }) => ({ date, time })), MOMENTS);
  assert.equal(card.cardPersons, 3);
  assert.equal(body.customOptions.length, 1);
});

test('rule 38: no body for an unknown id or a devis', () => {
  assert.equal(core.reservations.updateBody(999999), null);
  const id = f.createStay({ startDate: f.inDays(300), endDate: f.inDays(302) });
  f.db.prepare("UPDATE reservations SET kind = 'devis' WHERE id = ?").run(id);
  assert.equal(core.reservations.updateBody(id), null);
});

test('rule 38: every plugin writing a line list through reservations.update starts from updateBody and asks for SDK 2.21', () => {
  assert.ok(semver.gte(SDK_VERSION, '2.21.0'));
  const writers = PLUGIN_IDS.filter((id) => /ctx\.core\.reservations\.update\b/.test(pluginSources(id)));
  const listWriters = writers.filter((id) => /\b(customOptions|offeredOptionIds)\b|\bresources\s*:/.test(pluginSources(id)));
  listWriters.forEach((id) => {
    assert.match(pluginSources(id), /ctx\.core\.reservations\.updateBody\b/, `${id} rewrites a line list without updateBody`);
    assert.ok(semver.gte(semver.minVersion(readSourceManifest(id).sdk), '2.21.0'), `${id} sdk ${readSourceManifest(id).sdk}`);
  });
  assert.deepEqual(listWriters.sort(), ['airbnb-intake', 'gites-de-france-intake'].filter((id) => PLUGIN_IDS.includes(id)));
});

// Review of PR #942 (optional follow-up, closed 2026-11-03): the exclusion is the core's own, not the
// doubles'. An engine-added line (`options.autoEnabled = 1`) is left out of `options` — the engine adds it
// back from the stay itself — and only its « dans le complément » choice rides along.
test('rule 38: through the real core, an engine-added line stays out of updateBody and is not doubled by update', () => {
  const early = Number(f.db.prepare(`INSERT INTO options (title, priceType, price, autoOptionType, autoEnabled, autoPricingMode, autoFullNightThreshold)
    VALUES ('Arrivée anticipée', 'per_stay', 40, 'early_check_in', 1, 'proportional', '10:00')`).run().lastInsertRowid);
  f.db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(early);
  const id = f.createStay({
    startDate: f.inDays(320), endDate: f.inDays(323), checkInTime: '13:00',
    options: [{ optionId: 60, quantity: 1, cardOccurrences: [{ date: f.inDays(321), time: '08:30' }], cardPersons: 2 }],
  });
  const stored = (rid) => reservationsModel.getByIdWithDetails(rid).options.filter((o) => !o.isCustom).map((o) => Number(o.optionId)).sort();
  assert.deepEqual(stored(id), [60, early].sort(), 'the stay carries the engine-added line');
  f.db.prepare('UPDATE reservation_options SET inComplement = 1 WHERE reservationId = ? AND optionId = ?').run(id, early);

  const body = core.reservations.updateBody(id);
  assert.deepEqual(body.options.map((o) => Number(o.optionId)), [60]);
  assert.deepEqual(body.autoOptionsInComplement, [early]);

  const saved = core.reservations.update(id, { notes: 'Relu par la saisie' }, 'Test');
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(stored(id), [60, early].sort(), 'one engine-added line, never two');
  const line = f.db.prepare('SELECT inComplement FROM reservation_options WHERE reservationId = ? AND optionId = ?').all(id, early);
  assert.deepEqual(line.map((l) => l.inComplement), [1]);
});
