// specs/pricing-components.md §3 rules 53, 88 and owner Q-C11 — the three catalogue fields of an article sold outside a stay: « Vendable hors séjour », its VAT class and the external
// rate of that class. Server validation (the only one that can reject a write): a family that needs a stay answers NEEDS_STAY, a class with no external rate is refused,
// the rate is the one of the whole class; the write stores what the payload carries and a key not sent keeps the stored value.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const optionsController = require('../controllers/optionsController');
const resourcesController = require('../controllers/resourcesController');
const standaloneSalesController = require('../controllers/standaloneSalesController');
const sales = require('../models/standaloneSalesModel');
const standaloneSale = require('../utils/standaloneSale');

const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const row = (id) => db.prepare('SELECT sellableExternally, vatClass FROM options WHERE id = ?').get(id);
const detailsOf = (r) => (r.body && r.body.details ? r.body.details.map((d) => [d.field, d.code || d.message]) : null);

test('rule 53 — a perennial article is made sellable outside with its class and the rate of that class; the sale then prices it', () => {
  const created = res();
  optionsController.create({ body: { title: 'Bière locale', priceType: 'per_stay', price: 6.5, sellableExternally: true, vatClass: 'drinks', externalVatRate: 20 } }, created);
  assert.equal(created.statusCode, 200);
  const { id } = created.body;
  assert.deepEqual(row(id), { sellableExternally: 1, vatClass: 'drinks' });
  assert.equal(sales.externalRates().drinks, 20);
  const sold = standaloneSale.sell({ lines: [{ articleRef: `option:${id}`, quantity: 2 }] });
  assert.deepEqual(sold.document.lines.map((l) => [l.totalCents, l.vatRate, l.vatClass]), [[1300, 20, 'drinks']]);
});

test('rule 53 — the external rate belongs to the class: set from one article, it is the rate of every article of the class', () => {
  const a = Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES ('Soda', 3, 'per_stay', 1, 'drinks')").run().lastInsertRowid);
  const other = res();
  optionsController.update({ params: { id: a }, body: { title: 'Soda', priceType: 'per_stay', price: 3, externalVatRate: 5.5 } }, other);
  assert.equal(other.statusCode, 200);
  assert.equal(sales.externalRates().drinks, 5.5);
  const rates = res();
  standaloneSalesController.vatRates({}, rates);
  assert.deepEqual(rates.body.classes.find((c) => c.vatClass === 'drinks'), { vatClass: 'drinks', externalRate: 5.5 });
  assert.deepEqual(rates.body.classes.map((c) => c.vatClass), ['options', 'resources', 'drinks', 'catering']);
  sales.setExternalRate('drinks', 20);
});

test('rule 53 — an article that reads the stay cannot be made sellable outside: NEEDS_STAY, nothing written', () => {
  const before = db.prepare('SELECT COUNT(*) AS n FROM options').get().n;
  const r = res();
  optionsController.create({ body: { title: 'Petit-déjeuner', priceType: 'per_person_per_night', price: 12, sellableExternally: true, vatClass: 'catering', externalVatRate: 10 } }, r);
  assert.equal(r.statusCode, 422);
  assert.deepEqual(detailsOf(r), [['sellableExternally', 'NEEDS_STAY']]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM options').get().n, before);
  const stored = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Nuitée', 5, 'per_night')").run().lastInsertRowid);
  const update = res();
  optionsController.update({ params: { id: stored }, body: { title: 'Nuitée', priceType: 'per_night', price: 5, sellableExternally: true, externalVatRate: 10 } }, update);
  assert.deepEqual(detailsOf(update), [['sellableExternally', 'NEEDS_STAY']]);
});

test('rule 53 — a class with no external rate is refused until one is sent; the franchise regime needs none', () => {
  const r = res();
  optionsController.create({ body: { title: 'Planche', priceType: 'per_stay', price: 14, sellableExternally: true, vatClass: 'catering' } }, r);
  assert.deepEqual(detailsOf(r), [['externalVatRate', 'EXTERNAL_RATE_REQUIRED']]);
  const ok = res();
  optionsController.create({ body: { title: 'Planche', priceType: 'per_stay', price: 14, sellableExternally: true, vatClass: 'catering', externalVatRate: 10 } }, ok);
  assert.equal(ok.statusCode, 200);
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_293_b', 'all')").run();
  const franchise = res();
  optionsController.create({ body: { title: 'Chips', priceType: 'per_stay', price: 2, sellableExternally: true, vatClass: 'resources' } }, franchise);
  assert.equal(franchise.statusCode, 200, 'franchise: no VAT, no rate to ask');
  db.prepare('DELETE FROM vat_periods').run();
});

test('rule 53 — the fields are judged: an unknown class, an unknown flag, a rate out of range', () => {
  for (const [body, field] of [[{ vatClass: 'luxury' }, 'vatClass'], [{ sellableExternally: 'maybe' }, 'sellableExternally'], [{ externalVatRate: 120 }, 'externalVatRate'], [{ externalVatRate: 'abc' }, 'externalVatRate'], [{ externalVatRate: 5.555 }, 'externalVatRate']]) {
    const r = res();
    optionsController.create({ body: { title: 'X', priceType: 'per_stay', price: 1, ...body } }, r);
    assert.equal(r.statusCode, 422, JSON.stringify(body));
    assert.equal(r.body.details[0].field, field);
  }
});

test('rule 53 — a key the save does not send keeps the stored value, and an unflagged article is not sellable', () => {
  const id = Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES ('Miel', 9, 'per_stay', 1, 'options')").run().lastInsertRowid);
  sales.setExternalRate('options', 20);
  const r = res();
  optionsController.update({ params: { id }, body: { title: 'Miel', priceType: 'per_stay', price: 10 } }, r);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(row(id), { sellableExternally: 1, vatClass: 'options' });
  const off = res();
  optionsController.update({ params: { id }, body: { title: 'Miel', priceType: 'per_stay', price: 10, sellableExternally: false } }, off);
  assert.equal(row(id).sellableExternally, 0);
  assert.equal(standaloneSale.quote({ lines: [{ articleRef: `option:${id}`, quantity: 1 }] }).refusals[0].code, 'NOT_SELLABLE');
});

test('rule 53 — the resource form carries the same fields: an hourly resource may be sold outside, its class is « resources »', () => {
  const created = res();
  resourcesController.create({ body: { name: 'Sauna', quantity: 1, price: 20, priceType: 'per_stay', sellableExternally: true, externalVatRate: 20 } }, created);
  assert.equal(created.statusCode, 200);
  const stored = db.prepare('SELECT sellableExternally, vatClass FROM resources WHERE id = ?').get(created.body.id);
  assert.deepEqual(stored, { sellableExternally: 1, vatClass: null });
  assert.equal(sales.externalRates().resources, 20, 'the rate of the class of its kind');
  const refused = res();
  resourcesController.create({ body: { name: 'Chambre', quantity: 1, price: 20, priceType: 'per_night', sellableExternally: true, externalVatRate: 20 } }, refused);
  assert.deepEqual(detailsOf(refused), [['sellableExternally', 'NEEDS_STAY']]);
});
