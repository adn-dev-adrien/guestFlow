// specs/outside-booking-sas.md rule 11 (C38) — « Autre article »: the mini SAS searches the articles sellable with no stay, for the administrator and the reception alike,
// each with its label and unit price from the Articles head; an article that needs a stay is never listed; a stay-bound booking has no mini SAS.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');

test('rule 11 — the search lists the articles sellable with no stay, filtered by a fragment, for the administrator and the reception', async () => {
  const id = f.book();
  for (const user of [f.ADMIN, f.RECEPTION]) {
    const all = await f.call('articles', { id, user });
    assert.equal(all.code, 200);
    assert.deepEqual(all.body.articles.map((a) => [a.label, a.unitCents]).sort(), [['Bière locale', 650], ['Limonade', 400]], 'the breakfast, which needs a stay, is never listed');
    const some = await f.call('articles', { id, user, query: { q: 'lim' } });
    assert.deepEqual(some.body.articles.map((a) => a.label), ['Limonade']);
  }
});

test('rule 1 — a booking tied to a stay has no mini SAS, so no search either', async () => {
  const id = f.book();
  f.db.pragma('foreign_keys = OFF');
  f.db.prepare('UPDATE resource_bookings SET reservationId = 7 WHERE id = ?').run(id);
  f.db.pragma('foreign_keys = ON');
  const refused = await f.call('articles', { id });
  assert.deepEqual([refused.code, refused.body.code], [409, 'BOOKING_HAS_STAY']);
  f.db.prepare('UPDATE resource_bookings SET reservationId = NULL WHERE id = ?').run(id);
});
