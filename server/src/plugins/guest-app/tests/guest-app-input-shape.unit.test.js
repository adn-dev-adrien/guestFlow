// specs/guest-app.md rules 1, 3, 6, 28, 40, 41 and 16-18, 48 — the guest and studio routes against malformed bodies. A
// stay link, a poster code or a lookup whose fields are not text answers the same generic 404 as a wrong code (no
// oracle, never a 500); the service hours, the delivery times and the slots answer a field of the wrong type with a
// 400, never a 500; so do the studio's pages, blocks and photos.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, addStay, enable, freshDb, livePlugins, openStay, sell, startApi,
} = require('./guestAppFixtures');

const NOT_TEXT = [['a number', 12], ['an array', ['x']], ['an object', { $gt: '' }], ['null', null], ['blank', '   '], ['too long', 'x'.repeat(121)]];

async function withApi(fn) {
  const db = freshDb();
  const ctx = await startApi(db);
  enable(ctx.api, db);
  try {
    await fn({ db, ...ctx });
  } finally {
    await ctx.close();
  }
}

test('rules 1, 3: a stay token or a poster code that is not text answers the unknown-code 404', () => withApi(async ({ call }) => {
  for (const key of ['stayToken', 'lodgingCode']) {
    for (const [label, value] of NOT_TEXT) {
      // eslint-disable-next-line no-await-in-loop
      const res = await call('POST', '/public/v1/guest/sessions', { [key]: value });
      assert.equal(res.status, 404, `${key} ${label}`);
      assert.equal(res.body.error.code, 'CODE_NOT_FOUND', `${key} ${label}`);
    }
  }
  assert.equal((await call('POST', '/public/v1/guest/sessions')).status, 404, 'no body');
  assert.equal((await call('POST', '/public/v1/guest/sessions', ['x'])).status, 404, 'an array body');
}));

test('rule 6: a lookup whose fields are not text answers the one generic error', () => withApi(async ({ call, db }) => {
  addStay(db);
  for (const [label, value] of NOT_TEXT.slice(0, 4)) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('POST', '/public/v1/guest/sessions/lookup', { lastName: value, reservationNumber: value });
    assert.equal(res.status, 404, label);
    assert.equal(res.body.error.code, 'STAY_NOT_FOUND', label);
  }
}));

test('rule 40: a service-hours PUT whose fields have the wrong type is a 400', () => withApi(async ({ call }) => {
  const wrong = [
    ['an array body', [{ weekly: {} }]],
    ['weekly as a list', { weekly: [[]], exceptions: [] }],
    ['a day as text', { weekly: { 1: '08:00-12:00' }, exceptions: [] }],
    ['a range as text', { weekly: { 1: ['08:00'] }, exceptions: [] }],
    ['an hour as a number', { weekly: { 1: [{ from: 8, to: 12 }] }, exceptions: [] }],
    ['an hour as an object', { weekly: { 1: [{ from: { $gt: '' }, to: '12:00' }] }, exceptions: [] }],
    ['exceptions as an object', { weekly: {}, exceptions: { date: 'x' } }],
    ['an exception date as a number', { weekly: {}, exceptions: [{ date: 20991231, closed: true }] }],
    ['closed as text', { weekly: {}, exceptions: [{ date: 'x', closed: 'yes' }] }],
    ['ranges as an object', { weekly: {}, exceptions: [{ date: 'x', ranges: { from: '08:00' } }] }],
  ];
  for (const [label, body] of wrong) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call('PUT', '/api/guest-app/service-hours', body);
    assert.equal(res.status, 400, label);
    assert.equal(typeof res.body.error, 'string', label);
  }
}));

test('rules 28, 41: delivery times and slots answer a malformed cart or id with a 400 INVALID_INPUT', async () => {
  const teardown = livePlugins();
  try {
    await withApi(async ({ call, db }) => {
      const id = addStay(db);
      addOption(db, { id: 1, title: 'Cidre' });
      sell(db, 'option', 1, { needsStaff: 1 });
      await openStay(call, db, id);
      const carts = [
        ['no lines', {}],
        ['lines as text', { lines: 'cidre' }],
        ['an empty cart', { lines: [] }],
        ['21 lines', { lines: Array.from({ length: 21 }, () => ({ kind: 'option', id: 1 })) }],
        ['a null line', { lines: [null] }],
        ['a kind as a number', { lines: [{ kind: 1, id: 1 }] }],
        ['an id as text', { lines: [{ kind: 'option', id: '1' }] }],
        ['an id as an object', { lines: [{ kind: 'option', id: { $gt: 0 } }] }],
        ['an unknown key', { lines: [{ kind: 'option', id: 1 }], deliverAt: 'x' }],
      ];
      for (const [label, body] of carts) {
        // eslint-disable-next-line no-await-in-loop
        const res = await call('POST', '/public/v1/guest/shop/delivery-slots', body);
        assert.equal(res.status, 400, label);
        assert.equal(res.body.error.code, 'INVALID_INPUT', label);
      }
      for (const id of ['abc', '1.5', '-1', '0']) {
        // eslint-disable-next-line no-await-in-loop
        const res = await call('GET', `/public/v1/guest/shop/resources/${id}/slots`);
        assert.equal(res.status, 400, id);
        assert.equal(res.body.error.code, 'INVALID_INPUT', id);
      }
      assert.equal((await call('GET', '/public/v1/guest/shop/resources/1/slots?from=2099-07-07&from=2099-07-08')).status, 400, 'a date given twice');
    });
  } finally {
    teardown();
  }
});

// specs/guest-app.md rules 16-18, 48 — the studio's write routes answer a field of the wrong type with a 400 and a
// French message, never a 500.
test('rules 16-18, 48: the studio routes answer a malformed body with a 400', () => withApi(async ({ call, db }) => {
  const model = require('../models/bookletModel')(db);
  const { page } = model.createPage(1, { slug: 'bienvenue', title: { fr: 'Bienvenue' } }, new Date());
  const { block } = model.createBlock(page.id, { type: 'text', data: { html: { fr: '<p>x</p>' } } }, new Date());
  const studio = '/api/guest-app/studio';
  const cases = [
    ['PUT', `${studio}/lodgings/1/booklet`, { pages: 'all' }],
    ['PUT', `${studio}/lodgings/1/booklet`, { pages: [{ pageId: '1', sortOrder: 0, published: true }] }],
    ['PUT', `${studio}/lodgings/1/booklet`, { pages: [{ pageId: page.id, sortOrder: -1, published: true }] }],
    ['PUT', `${studio}/lodgings/1/booklet`, { pages: [{ pageId: page.id, sortOrder: 0, published: 'yes' }] }],
    ['POST', `${studio}/lodgings/1/pages`, { slug: 12, title: { fr: 'x' } }],
    ['POST', `${studio}/lodgings/1/pages`, { slug: 'x', title: 'x' }],
    ['POST', `${studio}/lodgings/1/pages`, { slug: 'x', title: { fr: 'x' }, icon: { $ne: '' } }],
    ['POST', `${studio}/lodgings/1/pages`, { slug: 'x', title: { fr: 'x' }, coverMediaId: '3' }],
    ['POST', `${studio}/lodgings/1/pages`, [{ slug: 'x' }]],
    ['PUT', `${studio}/pages/${page.id}`, {}],
    ['PUT', `${studio}/pages/${page.id}`, { slug: ['a'] }],
    ['POST', `${studio}/pages/${page.id}/placements`, { propertyId: '2' }],
    ['POST', `${studio}/pages/${page.id}/duplicate`, { toPropertyId: null }],
    ['POST', `${studio}/pages/${page.id}/blocks`, { type: ['text'], data: {} }],
    ['POST', `${studio}/pages/${page.id}/blocks`, { type: 'text', data: 'x' }],
    ['POST', `${studio}/pages/${page.id}/blocks`, { type: 'text', data: { html: { fr: 'x' } }, onlyForPropertyIds: '1' }],
    ['POST', `${studio}/pages/${page.id}/blocks`, { type: 'text', data: { html: { fr: 'x' } }, onlyForPropertyIds: [1, 1] }],
    ['PUT', `${studio}/pages/${page.id}/blocks/order`, { blockIds: String(block.id) }],
    ['PUT', `${studio}/pages/${page.id}/blocks/order`, { blockIds: [{ id: block.id }] }],
    ['PUT', `${studio}/blocks/${block.id}`, { data: { html: { fr: ['x'] } } }],
    ['PUT', `${studio}/blocks/${block.id}`, { type: 'image' }],
    ['PUT', `${studio}/media/1`, { altFr: ['x'] }],
    ['PUT', `${studio}/pages/abc`, { slug: 'x' }],
    ['DELETE', `${studio}/pages/abc`],
    ['DELETE', `${studio}/blocks/1.5`],
    ['DELETE', `${studio}/pages/${page.id}/placements/x`],
  ];
  for (const [method, url, body] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const res = await call(method, url, body);
    assert.equal(res.status, 400, `${method} ${url} ${JSON.stringify(body)}`);
    assert.equal(typeof res.body.error, 'string', url);
  }
}));
