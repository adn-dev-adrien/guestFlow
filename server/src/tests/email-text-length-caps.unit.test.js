// specs/email-automation.md rule 20 (review of #869) — every writer of an email sentence applies the
// 20 000-character cap with the same 422 { field, message }: the stay texts, the mentions and the
// resource sentence, as the template editor and the texts screen already did.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedProperty } = require('./guestEmailSequenceFixtures');
const { buildController: buildStayTexts } = require('../controllers/stayTextsController');
const { buildController: buildMentions } = require('../controllers/emailMentionsController');
const resourcesController = require('../controllers/resourcesController');
const { CATALOGUE } = require('../utils/stayTextCatalogue');

function call(handler, req) {
  let out;
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { out = { status: this.statusCode, body }; return this; },
    end() { out = { status: this.statusCode }; return this; },
  };
  handler({ query: {}, params: {}, body: {}, ...req }, res);
  return out;
}

const LONG = 'a'.repeat(20001);
const AT_CAP = 'a'.repeat(20000);

test('rule 20: a stay text over 20 000 characters is refused with the editor\'s 422', () => {
  const db = freshDb();
  seedProperty(db, { id: 1, name: 'La Grange', nameArticle: 'à' });
  const controller = buildStayTexts({ database: db });
  const key = CATALOGUE[0].key;
  const refused = call(controller.save, { params: { key }, body: { fr: LONG } });
  assert.equal(refused.status, 422);
  assert.deepEqual(refused.body, { field: 'fr', message: '20000 caractères au plus' });
  assert.equal(call(controller.save, { params: { key }, body: { fr: 'ok', en: LONG } }).body.field, 'en');
  assert.equal(call(controller.save, { params: { key }, body: { fr: AT_CAP } }).status, 200);
});

test('rule 20: a mention over 20 000 characters is refused, on create and on update', () => {
  const db = freshDb();
  db.prepare('INSERT INTO options (id, title, price) VALUES (1, ?, 6)').run('Cidre');
  const controller = buildMentions({ database: db });
  const base = { section: 'local', optionIds: [1], offerFr: 'le cidre', bookedFr: 'Le cidre est là.' };
  for (const field of ['offerFr', 'offerEn', 'bookedFr', 'bookedEn']) {
    const refused = call(controller.create, { body: { ...base, [field]: LONG } });
    assert.equal(refused.status, 422, field);
    assert.deepEqual(refused.body, { field, message: '20000 caractères au plus' });
  }
  const created = call(controller.create, { body: { ...base, offerFr: AT_CAP } });
  assert.equal(created.status, 201);
  const upd = call(controller.update, { params: { id: created.body.id }, body: { ...base, bookedEn: LONG } });
  assert.equal(upd.status, 422);
  assert.equal(upd.body.field, 'bookedEn');
});

test('rule 20: a resource sentence over 20 000 characters is refused, on create and on update', () => {
  const written = [];
  const model = {
    insert: (body) => { written.push(body); return 1; },
    update: (id, body) => { written.push(body); },
    findById: () => ({ id: 1, priceType: 'per_day' }),
  };
  const controller = resourcesController.buildController(model, { isOffered: () => true, properties: () => [] });
  const body = { name: 'Sauna', priceType: 'per_day', price: 10, quantity: 1 };
  for (const field of ['emailBookedText', 'emailBookedTextEn']) {
    const refused = call(controller.create, { body: { ...body, [field]: LONG } });
    assert.equal(refused.status, 422, field);
    assert.deepEqual(refused.body, { field, message: '20000 caractères au plus' });
  }
  assert.equal(call(controller.update, { params: { id: 1 }, body: { ...body, emailBookedText: LONG } }).status, 422);
  assert.equal(call(controller.create, { body: { ...body, emailBookedText: AT_CAP } }).status, 200);
  assert.equal(written.length, 1);
});
