// specs/guest-app.md rule 62 (audit R37-INJ-L1) — the studio's search refuses a query too short or too long in
// French words, never the bare refusal key of the guest's table (`searchLength`).
const test = require('node:test');
const assert = require('node:assert/strict');

const { enable, freshDb, startApi } = require('./guestAppFixtures');

const SEARCH = '/api/guest-app/studio/lodgings/1/search';

test('rule 62: the studio search refusal is a French sentence, short and long queries alike', async () => {
  const db = freshDb();
  const ctx = await startApi(db);
  try {
    enable(ctx.api, db, 1);
    for (const q of ['a', 'x'.repeat(200)]) {
      // eslint-disable-next-line no-await-in-loop
      const refused = await ctx.call('GET', `${SEARCH}?q=${encodeURIComponent(q)}`);
      assert.equal(refused.status, 400);
      assert.equal(refused.body.error, 'La recherche fait de 2 à 100 caractères.');
    }
    const empty = await ctx.call('GET', SEARCH);
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error, 'Recherche vide.');
    const found = await ctx.call('GET', `${SEARCH}?q=wifi`);
    assert.equal(found.status, 200, JSON.stringify(found.body));
  } finally {
    await ctx.close();
  }
});
