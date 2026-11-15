// specs/outside-booking-sas.md rule 11 and CLAUDE.md §7 (end review R3-7) — the « Autre article » answer comes grouped by the server, in the
// catalogue's order: `[{ category, articles }]`, the screen groups nothing.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const suggested = require('../utils/suggestedArticles');

const option = (title, price, category) => db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, category) VALUES (?, ?, 'per_stay', 1, ?)").run(title, price, category);
option('Thé', 3, 'Boissons');
option('Planche', 14, 'Restauration');
option('Bière', 6.5, 'Boissons');

test('rule 11 — catalogueGroups is the catalogue grouped by category, nothing more, nothing less', () => {
  const flat = suggested.catalogue({ customerContext: 'external' }).filter((a) => ['Thé', 'Planche', 'Bière'].includes(a.label));
  const groups = suggested.catalogueGroups({ customerContext: 'external' })
    .map((g) => ({ category: g.category, articles: g.articles.filter((a) => ['Thé', 'Planche', 'Bière'].includes(a.label)) }))
    .filter((g) => g.articles.length);
  assert.deepEqual(groups.map((g) => [g.category, g.articles.map((a) => a.label)]), [['Boissons', ['Bière', 'Thé']], ['Restauration', ['Planche']]]);
  assert.deepEqual(groups.flatMap((g) => g.articles), flat);
});
