// specs/outside-booking-sas.md rules 10-12, 14 — the lines of a visit: the session line priced by the `hourly` family with its parts (day band, evening band,
// offered time) and its fulfilment, the extras in sale order, the articles suggested for the resource (never one that needs a stay), the quantity bounds, a
// committed line frozen and more of the same article a new line once committed.
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./visitFixture');
const suggestedArticles = require('../../../utils/suggestedArticles');

test('rule 10 — the session line comes first, priced by the hourly family, with its parts as the screen shows them', async () => {
  const id = f.bookEvening();
  const view = (await f.call('getVisit', { id })).body;
  const [session] = view.lines;
  assert.equal(session.kind, 'session');
  assert.equal(session.totalCents, 12000);
  assert.deepEqual(session.components.map((part) => [part.label, part.detail, part.amountCents]), [
    ['Jour · 18:00–19:00', '1 h × 50,00 €', 5000], ['Soir · 19:00–20:00', '1 h × 70,00 €', 7000],
  ]);
  assert.equal(session.draft, true, 'not written before the first commit');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM standalone_sales').get().n, 0, 'a read writes nothing');
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 2)] } });
  const stored = f.db.prepare('SELECT kind, family, fulfilmentRef, totalCents FROM standalone_sale_lines ORDER BY id').all();
  assert.deepEqual(stored[0], { kind: 'session', family: 'hourly', fulfilmentRef: `hourly-slot:${id}`, totalCents: 12000 });
  assert.equal(stored[1].kind, 'extra');
  assert.equal(f.row(id).saleRef, `standalone:${f.db.prepare('SELECT id FROM standalone_sales ORDER BY id DESC').get().id}`);
});

test('rule 11 — the suggestions are the resource\'s list, filtered for an outside client: an article that needs a stay is never listed', async () => {
  const id = f.book();
  const { resourceId } = f.row(id);
  suggestedArticles.save('resource', String(resourceId), [`option:${f.breakfast}`, `option:${f.beer}`, `option:${f.lemonade}`]);
  const view = (await f.call('getVisit', { id })).body;
  assert.deepEqual(view.suggestions.map((s) => [s.label, s.unitCents]), [['Bière locale', 650], ['Limonade', 400]]);
  const refused = (await f.call('quote', { id, body: { extras: [f.extra(f.breakfast, 1)] } })).body;
  assert.deepEqual(refused.refusals.map((r) => r.code), ['NEEDS_STAY']);
  assert.equal(refused.totals.totalCents, 5000, 'the refused article is not added');
});

test('rule 12 — quantity bounds: 1 to 99; out of bounds is refused, the line not added, the commit refused', async () => {
  const id = f.book();
  for (const quantity of [0, 100, 2.5]) {
    const quoted = (await f.call('quote', { id, body: { extras: [f.extra(f.beer, quantity)] } })).body;
    assert.equal(quoted.refusals[0].error, 'Quantité : 1 à 99.');
  }
  const commit = await f.call('commit', { id, body: { extras: [f.extra(f.beer, 100)] } });
  assert.deepEqual([commit.code, commit.body.code], [400, 'QUANTITY_OUT_OF_BOUNDS']);
  assert.equal(f.row(id).arrivedAt, null);
});

test('rule 12 — after a commit, more of the same article is a new line, shown grouped', async () => {
  const id = f.book();
  await f.call('commit', { id, body: { extras: [f.extra(f.beer, 1)] } });
  const visit = (await f.call('commit', { id, body: { extras: [f.extra(f.beer, 2)] } })).body.visit;
  const beers = visit.lines.filter((line) => line.label === 'Bière locale');
  assert.deepEqual(beers.map((line) => line.quantity), [1, 2]);
  assert.equal(visit.groups.length, 1);
  assert.match(visit.groups[0].title, /^Bière locale — 3 × 6,50 € \(2 lignes\)$/);
  assert.equal(visit.totals.totalCents, 5000 + 3 * 650);
});

test('rule 14 — a committed line is frozen: a later price change moves nothing', async () => {
  const id = f.book();
  await f.call('commit', { id, body: { extras: [f.extra(f.lemonade, 1)] } });
  f.db.prepare('UPDATE options SET price = 9 WHERE id = ?').run(f.lemonade);
  f.db.prepare('UPDATE resources SET hourlyExternalDayRate = 90 WHERE id = ?').run(f.row(id).resourceId);
  const visit = (await f.call('getVisit', { id })).body;
  assert.deepEqual(visit.lines.map((line) => line.totalCents), [5000, 400]);
  f.db.prepare('UPDATE options SET price = 4 WHERE id = ?').run(f.lemonade);
});

test('rule 4 (C38) — the visit payload says whether an invoice can be made now: the server\'s answer, the screen never guesses it', async () => {
  const id = f.book();
  const view = (await f.call('getVisit', { id })).body;
  assert.equal(typeof view.invoiceReady, 'boolean');
});
