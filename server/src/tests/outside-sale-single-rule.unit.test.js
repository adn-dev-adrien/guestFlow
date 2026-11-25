// specs/pricing-components.md rule 124 — which articles sell with no stay is the families' own answer: `articles.outsideSale` is the one function, and the fiche's « Vendable hors séjour »,
// the counter, the « Autre article » suggestions and the sellability endpoint all read it; none keeps a list of families.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const articles = require('../utils/pricing/articles');
const standaloneSale = require('../utils/standaloneSale');
const suggested = require('../utils/suggestedArticles');
const externalArticleFields = require('../utils/externalArticleFields');
const controller = require('../controllers/standaloneSalesController');
const sales = require('../models/standaloneSalesModel');

sales.setExternalRate('options', 10);
sales.setExternalRate('resources', 20);

const OPTION_TYPES = ['per_stay', 'free', 'per_person', 'per_night', 'per_person_per_night', 'percent_of_stay', 'per_participant_progressive'];
const RESOURCE_TYPES = ['per_stay', 'free', 'per_person', 'per_night', 'per_person_per_night', 'per_hour'];
const READS_STAY = new Set(['per_person', 'per_night', 'per_person_per_night', 'percent_of_stay', 'per_participant_progressive']);
const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

function seed() {
  const rows = [];
  for (const kind of ['option', 'resource']) {
    for (const priceType of kind === 'option' ? OPTION_TYPES : RESOURCE_TYPES) {
      for (const card of [0, 1]) {
        for (const insurance of kind === 'option' ? [0, 1] : [0]) {
          const id = kind === 'option'
            ? Number(db.prepare('INSERT INTO options (title, price, priceType, showsPlanningCard, sellableExternally, isCancellationInsurance, vatClass) VALUES (?, 10, ?, ?, 1, ?, \'options\')')
              .run(`${priceType}-${card}-${insurance}`, priceType, card, insurance).lastInsertRowid)
            : Number(db.prepare('INSERT INTO resources (name, quantity, price, priceType, showsPlanningCard, sellableExternally, vatClass) VALUES (?, 1, 10, ?, ?, 1, \'resources\')')
              .run(`${priceType}-${card}`, priceType, card).lastInsertRowid);
          rows.push({ kind, id, priceType, card, insurance });
        }
      }
    }
  }
  return rows;
}
const rows = seed();
const articleOf = (r) => {
  const found = sales.catalogueRow(`${r.kind}:${r.id}`);
  return articles.makeArticle(found.row, { kind: found.kind });
};
const expectedCode = (r, article) => {
  if (r.insurance) return 'INSURANCE';
  if (article.family === 'hourly') return 'NEEDS_FULFILMENT';
  return READS_STAY.has(r.priceType) && !(r.kind === 'option' && r.card && r.priceType !== 'percent_of_stay') ? 'NEEDS_STAY' : null;
};

test('pricing-components rule 124 — outsideSale answers every price type × planning card × insurance, from the family alone', () => {
  for (const r of rows) {
    const article = articleOf(r);
    const answer = articles.outsideSale(article);
    const code = expectedCode(r, article);
    assert.equal(answer.code, code, `${r.kind} ${r.priceType} card=${r.card} insurance=${r.insurance}`);
    assert.equal(answer.sellable, code === null || code === 'NEEDS_FULFILMENT');
    assert.equal(typeof answer.reason, code === null ? 'object' : 'string');
  }
  const per = articles.outsideSale(articleOf(rows.find((r) => r.kind === 'option' && r.priceType === 'per_person' && !r.card && !r.insurance)));
  assert.equal(per.reason, 'Le prix « par personne » a besoin d’un séjour : il ne se vend pas seul.');
  assert.equal(articles.outsideSale(articleOf(rows.find((r) => r.insurance))).reason, 'L’assurance annulation ne se vend qu’avec un séjour.');
});

test('pricing-components rule 124 — a family refuses NEEDS_STAY in the engine exactly when it declares readsStay', () => {
  const families = articles.liveFamilies();
  for (const [id, family] of Object.entries(families)) {
    const refused = family.validate({}, { quantity: 1 }, { customerContext: 'external', persons: 2, nights: 1 }).some((x) => x.code === 'NEEDS_STAY');
    assert.equal(refused, Boolean(family.readsStay), id);
  }
});

test('pricing-components rule 124 — the counter, the suggestions and the fiche agree with outsideSale on every article', () => {
  const external = new Set(suggested.catalogue({ customerContext: 'external' }).map((a) => a.articleRef));
  for (const r of rows) {
    const article = articleOf(r);
    const outside = articles.outsideSale(article);
    const ref = `${r.kind}:${r.id}`;
    const counter = standaloneSale.quote({ lines: [{ articleRef: ref, quantity: 1 }] });
    const counterCodes = (counter.refusals || []).map((x) => x.code);
    const refusal = (counter.refusals || [])[0];
    if (outside.code === null) assert.deepEqual(counterCodes, [], ref);
    else {
      assert.deepEqual(counterCodes, [outside.code === 'INSURANCE' ? 'NEEDS_STAY' : outside.code], ref);
      assert.equal(refusal.message, outside.reason, ref);
    }
    assert.equal(external.has(ref), outside.code === null, `suggestions ${ref}`);
    const stored = sales.catalogueRow(ref).row;
    const details = externalArticleFields.validate({ sellableExternally: true, externalVatRate: 10 }, { kind: r.kind, stored });
    const nonRate = details.filter((d) => d.field === 'sellableExternally');
    assert.deepEqual(nonRate.map((d) => d.message), outside.sellable ? [] : [outside.reason], `fiche ${ref}`);
    if (!outside.sellable) assert.equal(nonRate[0].code, 'NEEDS_STAY');
  }
});

test('pricing-components rule 124 — GET /standalone-sales/sellability judges the draft of an article before the save', () => {
  const ask = (query) => { const out = res(); controller.sellability({ query }, out); return out; };
  assert.deepEqual(ask({ kind: 'option', priceType: 'per_person', showsPlanningCard: '0', isCancellationInsurance: '0' }).body, {
    sellable: false, code: 'NEEDS_STAY', reason: 'Le prix « par personne » a besoin d’un séjour : il ne se vend pas seul.',
  });
  assert.deepEqual(ask({ kind: 'option', priceType: 'per_person', showsPlanningCard: '1' }).body, { sellable: true, code: null, reason: null });
  assert.equal(ask({ kind: 'option', priceType: 'per_stay', isCancellationInsurance: '1' }).body.code, 'INSURANCE');
  assert.equal(ask({ kind: 'resource', priceType: 'per_hour' }).body.sellable, true);
  assert.equal(ask({ kind: 'option' }).body.sellable, true, 'no price type is a lump sum');
  const bad = ask({ kind: 'moon', priceType: 'per_stay' });
  assert.deepEqual([bad.statusCode, bad.body.code], [400, 'INVALID_KIND']);
  assert.equal(ask({}).statusCode, 400);
});

test('pricing-components rule 124 — the route is mounted beside vat-rates', () => {
  const paths = require('../routes/standaloneSales').stack.filter((l) => l.route && l.route.methods.get).map((l) => l.route.path);
  assert.ok(paths.includes('/sellability') && paths.includes('/vat-rates'));
});

test('pricing-components rule 124 — the fiche’s 422 NEEDS_STAY carries the reason outsideSale returns, and an insurance is refused too', () => {
  const optionsController = require('../controllers/optionsController');
  const out = res();
  optionsController.create({ body: { title: 'Peignoir', priceType: 'per_person', price: 5, sellableExternally: true, vatClass: 'options', externalVatRate: 10 } }, out);
  assert.equal(out.statusCode, 422);
  assert.deepEqual(out.body.details.map((d) => [d.field, d.code, d.message]), [['sellableExternally', 'NEEDS_STAY', 'Le prix « par personne » a besoin d’un séjour : il ne se vend pas seul.']]);
});
