// specs/options-resources-ux.md rules 15, 16, 27 — the authoritative validation of an option write, the
// payload clean-up the editor used to do in the browser, the catalogue endpoint and the restore.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-option-validation-')), 'g.db');
const db = require('../database');
const controller = require('../controllers/optionsController');
const { validateOptionPayload } = require('../utils/optionValidation');
const { scopePayload } = require('../utils/optionPayloadScope');
const sdkRegistry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');

const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

function property(name) {
  return db.prepare('INSERT INTO properties (name) VALUES (?)').run(name).lastInsertRowid;
}
const granja = property('Granja');
const estiva = property('Estiva');

const valid = (over = {}) => ({
  title: 'Ménage', priceType: 'per_stay', price: 30, propertyIds: [granja, estiva], propertyPrices: {}, ...over,
});
const fieldsOf = (payload) => validateOptionPayload(payload).map((d) => d.field);
const messageOf = (payload, field) => (validateOptionPayload(payload).find((d) => d.field === field) || {}).message;

test('rule 16: a valid payload has no detail', () => {
  assert.deepEqual(validateOptionPayload(valid({ propertyPrices: { [granja]: 85, [estiva]: '' } })), []);
});

test('rule 16: the title is required, blank included', () => {
  assert.equal(messageOf(valid({ title: '' }), 'title'), 'Nom requis');
  assert.equal(messageOf(valid({ title: '   ' }), 'title'), 'Nom requis');
  assert.equal(messageOf(valid({ title: undefined }), 'title'), 'Nom requis');
});

test('rule 16: a base price must be a number with at most 2 decimals', () => {
  assert.equal(messageOf(valid({ price: 'abc' }), 'price'), 'Nombre attendu');
  assert.equal(messageOf(valid({ price: 10.005 }), 'price'), '2 décimales max');
  assert.deepEqual(fieldsOf(valid({ price: '12.5' })), []);
  assert.deepEqual(fieldsOf(valid({ price: '' })), []);
});

test('rule 16: a negative, non-numeric or 3-decimal per-property price is refused with its field', () => {
  assert.equal(messageOf(valid({ propertyPrices: { [granja]: -5 } }), `propertyPrices.${granja}`), 'Positif ou nul');
  assert.equal(messageOf(valid({ propertyPrices: { [granja]: 'dix' } }), `propertyPrices.${granja}`), 'Nombre attendu');
  assert.equal(messageOf(valid({ propertyPrices: { [estiva]: '1.234' } }), `propertyPrices.${estiva}`), '2 décimales max');
});

test('rule 16: a percentage is at most 100 and an override at 0 is valid', () => {
  const insurance = { priceType: 'percent_of_stay' };
  assert.equal(messageOf(valid({ ...insurance, price: 101 }), 'price'), '100 % max');
  assert.equal(messageOf(valid({ ...insurance, price: 4.333 }), 'price'), '2 décimales max');
  assert.equal(messageOf(valid({ ...insurance, price: 5, propertyPrices: { [granja]: 150 } }), `propertyPrices.${granja}`), '100 % max');
  assert.deepEqual(fieldsOf(valid({ propertyPrices: { [granja]: 0 } })), []);
});

test('rule 16: a free or progressive option has no per-property price to judge', () => {
  assert.deepEqual(fieldsOf(valid({ priceType: 'free', price: 'x', propertyPrices: { [granja]: -1 } })), []);
  assert.deepEqual(fieldsOf(valid({ priceType: 'per_participant_progressive', propertyPrices: { [granja]: -1 } })), []);
});

test('rule 16: create and update answer 422 VALIDATION_FAILED with details and write nothing', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM options').get().n;
  const created = res();
  controller.create({ body: valid({ title: '', propertyPrices: { [granja]: -5 } }) }, created);
  assert.equal(created.statusCode, 422);
  assert.equal(created.body.error, 'VALIDATION_FAILED');
  assert.deepEqual(created.body.details.map((d) => d.field).sort(), ['propertyPrices.' + granja, 'title'].sort());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, before);

  const id = db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Existante', 'per_stay', 10)").run().lastInsertRowid;
  const updated = res();
  controller.update({ params: { id }, body: valid({ title: ' ' }) }, updated);
  assert.equal(updated.statusCode, 422);
  assert.equal(db.prepare('SELECT title FROM options WHERE id = ?').get(id).title, 'Existante');
});

test('rule 16: a negative per-property price is refused, not skipped silently', () => {
  const r = res();
  controller.create({ body: valid({ title: 'Silence', propertyPrices: { [estiva]: -1 } }) }, r);
  assert.equal(r.statusCode, 422);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM options WHERE title = 'Silence'").get().n, 0);
});

test('rule 16: the model itself refuses an invalid override instead of skipping it', () => {
  const model = require('../models/optionsModel');
  assert.throws(() => model.create(valid({ title: 'Direct', propertyPrices: { [granja]: -1 } })), /Invalid per-property price/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM options WHERE title = 'Direct'").get().n, 0);
});

test('rule 15: scopePayload drops the overrides, defaults and bath mats of properties outside the scope', () => {
  const out = scopePayload({
    priceType: 'per_stay', propertyIds: [1],
    propertyPrices: { 1: 5, 2: 6 },
    propertyDefaults: { 1: { default: true, offered: true }, 2: { default: true, offered: false } },
    propertyBathMats: { 1: 2, 2: 3 },
  });
  assert.deepEqual(out.propertyPrices, { 1: 5 });
  assert.deepEqual(out.propertyDefaults, { 1: { default: true, offered: true } });
  assert.deepEqual(out.propertyBathMats, { 1: 2 });
});

test('rule 15: a free or progressive option keeps no per-property price; an absent key stays absent', () => {
  assert.deepEqual(scopePayload({ priceType: 'free', propertyIds: [1], propertyPrices: { 1: 5 } }).propertyPrices, {});
  assert.deepEqual(scopePayload({ priceType: 'per_participant_progressive', propertyIds: [1], propertyPrices: { 1: 5 } }).propertyPrices, {});
  const untouched = scopePayload({ priceType: 'per_stay', propertyIds: [1] });
  assert.equal('propertyPrices' in untouched, false);
  assert.equal('propertyDefaults' in untouched, false);
  const noScope = { priceType: 'per_stay', propertyPrices: { 9: 1 } };
  assert.equal(scopePayload(noScope), noScope);
});

test('rule 15: saving an option removes the out-of-scope rows from the database', () => {
  const r = res();
  controller.create({ body: valid({
    title: 'Nettoyée', propertyIds: [granja],
    propertyPrices: { [granja]: 40, [estiva]: 99 },
    propertyDefaults: { [granja]: { default: true, offered: false }, [estiva]: { default: true, offered: true } },
  }) }, r);
  const id = r.body.id;
  assert.deepEqual(db.prepare('SELECT propertyId FROM property_options WHERE optionId = ?').all(id).map((x) => x.propertyId), [granja]);
  assert.deepEqual(db.prepare('SELECT propertyId, price FROM property_option_prices WHERE optionId = ?').all(id), [{ propertyId: granja, price: 40 }]);
  assert.deepEqual(db.prepare('SELECT propertyId FROM property_option_defaults WHERE optionId = ?').all(id).map((x) => x.propertyId), [granja]);
});

test('rule 16: a negative base price is a 422 detail on `price` carrying the legacy code, next to the other field errors', () => {
  const r = res();
  controller.create({ body: valid({ title: '', price: -3, propertyPrices: { [granja]: -1 } }) }, r);
  assert.equal(r.statusCode, 422);
  const byField = Object.fromEntries(r.body.details.map((d) => [d.field, d]));
  assert.equal(byField.price.code, 'NEGATIVE_OPTION_PRICE');
  assert.equal(byField.price.message, 'Positif ou nul');
  assert.ok(byField.title);
  assert.ok(byField[`propertyPrices.${granja}`]);
});

test('rule 16: validation judges the scoped payload — an invalid price on a property that is not proposed is dropped, not refused', () => {
  const r = res();
  controller.create({ body: valid({ title: 'Hors périmètre', propertyIds: [granja], propertyPrices: { [granja]: 40, [estiva]: -5 } }) }, r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(db.prepare('SELECT propertyId FROM property_option_prices WHERE optionId = ?').all(r.body.id).map((x) => x.propertyId), [granja]);
});

test('rule 16: a percentage above 100 on a property that is not proposed is dropped too', () => {
  const r = res();
  controller.create({ body: valid({
    title: 'Assurance hors périmètre', priceType: 'percent_of_stay', price: 4, propertyIds: [granja], propertyPrices: { [granja]: 5, [estiva]: 400 },
  }) }, r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(db.prepare('SELECT propertyId, price FROM property_option_prices WHERE optionId = ?').all(r.body.id), [{ propertyId: granja, price: 5 }]);
  const still = res();
  controller.create({ body: valid({ title: 'Assurance dans le périmètre', priceType: 'percent_of_stay', price: 4, propertyPrices: { [granja]: 400 } }) }, still);
  assert.equal(still.statusCode, 422);
});

test('rule 16: a free option with a garbage base price saves at 0 instead of failing', () => {
  const r = res();
  controller.create({ body: valid({ title: 'Gratuite x', priceType: 'free', price: 'x' }) }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(db.prepare('SELECT price FROM options WHERE id = ?').get(r.body.id).price, 0);
});

test('rule 16: a property key that is not a positive integer is a 422 on that key, not a 500', () => {
  for (const key of ['abc', '-3', '0', '1.5']) {
    const r = res();
    controller.create({ body: { title: 'Clés', priceType: 'per_stay', price: 5, propertyPrices: { [key]: 4 } } }, r);
    assert.equal(r.statusCode, 422, key);
    assert.deepEqual(r.body.details, [{ field: `propertyPrices.${key}`, message: 'Logement inconnu' }]);
  }
});

test('rule 2, 4: the catalogue-view endpoint answers the grouped payload and 404 on an unknown property', () => {
  const ok = res();
  controller.catalogueView({ query: {} }, ok);
  assert.equal(ok.statusCode, 200);
  assert.ok(Array.isArray(ok.body.groups));
  assert.ok(Array.isArray(ok.body.chips));
  assert.equal(typeof ok.body.total, 'number');
  assert.ok(Array.isArray(ok.body.archived));
  const early = ok.body.groups.flatMap((g) => g.items).filter((i) => /arriv|départ tardif/i.test(i.title));
  assert.deepEqual(early, []);

  const filtered = res();
  controller.catalogueView({ query: { propertyId: String(granja) } }, filtered);
  assert.equal(filtered.statusCode, 200);

  const missing = res();
  controller.catalogueView({ query: { propertyId: '99999' } }, missing);
  assert.equal(missing.statusCode, 404);
});

test('rule 2: archived options are not in the groups but in `archived`, latest first (rule 26)', () => {
  const a = db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Archivée A', 'per_stay', 1)").run().lastInsertRowid;
  const b = db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Archivée B', 'per_stay', 1)").run().lastInsertRowid;
  db.prepare("UPDATE options SET archivedAt = '2026-10-01 10:00:00' WHERE id = ?").run(a);
  db.prepare("UPDATE options SET archivedAt = '2026-10-02 10:00:00' WHERE id = ?").run(b);
  const r = res();
  controller.catalogueView({ query: {} }, r);
  const titles = r.body.groups.flatMap((g) => g.items).map((i) => i.title);
  assert.equal(titles.includes('Archivée A'), false);
  assert.deepEqual(r.body.archived.map((i) => i.title).slice(0, 2), ['Archivée B', 'Archivée A']);
});

test('rule 27: restore brings an archived option back, without its property defaults, and announces a pricing change', async () => {
  const events = [];
  sdkRegistry.configure({ isActive: () => true, allows: () => true });
  createContext('pricing-probe').events.on('pricing.changed', (payload) => events.push(payload));
  const created = res();
  controller.create({ body: valid({ title: 'À restaurer', propertyDefaults: { [granja]: { default: true, offered: false } } }) }, created);
  const id = created.body.id;
  controller.remove({ params: { id } }, res());
  assert.notEqual(db.prepare('SELECT archivedAt FROM options WHERE id = ?').get(id).archivedAt, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM property_option_defaults WHERE optionId = ?').get(id).n, 0);

  const restored = res();
  controller.restore({ params: { id } }, restored);
  await new Promise((resolve) => { setImmediate(() => setImmediate(resolve)); });
  sdkRegistry.reset();
  assert.equal(restored.statusCode, 200);
  assert.ok(events.some((e) => e.source === 'options' && e.propertyId === null));
  assert.equal(db.prepare('SELECT archivedAt FROM options WHERE id = ?').get(id).archivedAt, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM property_option_defaults WHERE optionId = ?').get(id).n, 0);
});

test('rule 27: restoring an unknown option answers 404, an active one 409', () => {
  const missing = res();
  controller.restore({ params: { id: 987654 } }, missing);
  assert.equal(missing.statusCode, 404);
  const id = db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Active', 'per_stay', 1)").run().lastInsertRowid;
  const active = res();
  controller.restore({ params: { id } }, active);
  assert.equal(active.statusCode, 409);
  assert.equal(active.body.error, 'OPTION_NOT_ARCHIVED');
});

test('rule 16: a property id the payload names that does not exist is a 422 « Logement inconnu », never a 500', () => {
  const cases = [
    { propertyIds: [1.5] },
    { propertyIds: [999999] },
    { propertyPrices: { 999999: 3 } },
    { propertyDefaults: { 999999: { default: true, offered: false } } },
    { propertyBathMats: { 999999: 2 } },
  ];
  for (const extra of cases) {
    const r = res();
    controller.create({ body: { title: 'Inconnu', priceType: 'per_stay', price: 5, ...extra } }, r);
    assert.equal(r.statusCode, 422, JSON.stringify(extra));
    assert.ok(r.body.details.every((d) => d.message === 'Logement inconnu'), JSON.stringify(r.body.details));
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM options WHERE title = 'Inconnu'").get().n, 0);
});

test('rule 16: an unknown property price key outside an explicit scope is dropped, like any out-of-scope line', () => {
  const r = res();
  controller.create({ body: valid({ title: 'Clé hors périmètre', propertyIds: [granja], propertyPrices: { [granja]: 4, 999999: 3 } }) }, r);
  assert.equal(r.statusCode, 200);
});

test('rule 28: a fresh database declares property_resource_prices.price nullable, so the first boot rebuilds nothing', () => {
  const column = db.prepare('PRAGMA table_info(property_resource_prices)').all().find((c) => c.name === 'price');
  assert.equal(Number(column.notnull), 0);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_property_resource_prices_resource'").get());
});
