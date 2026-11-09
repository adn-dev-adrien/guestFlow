// specs/devis-pdf-and-tourist-tax-fixes.md §3.2 rule 7 reading R32-RES-M1 — the three paths of the one validity reading
// that verification R32 found unpinned (mutants m7, m8, m10 survived every devis suite):
// - m7: an unchanged start keeps its stored date, even after « Validité des devis » changed;
// - m8: the fiche's preview of a moved devis reads the devis's real creation day, as the save does;
// - m10: the link quote (`recomputeQuote` → `computeQuote`) reads a row stored above its cap capped, as the fiche does.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const { db, controller, respond, inDays, seed, stayBody, ADMIN } = require('./ledgerFixture');
const devisModel = require('../models/devisModel');

seed();
db.prepare('UPDATE app_settings SET quoteValidityDays = 15 WHERE id = 1').run();
db.prepare('UPDATE properties SET depositEnabled = 0 WHERE id = 1').run();
test.afterEach(() => db.prepare('UPDATE app_settings SET quoteValidityDays = 15 WHERE id = 1').run());

const devisBody = (startIn) => stayBody({ startDate: inDays(startIn), endDate: inDays(startIn + 3) });
const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

async function preview(id, startIn) {
  const res = respond();
  await controller.calculatePrice({ body: { ...devisBody(startIn), devisId: id }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

// A devis created ten days ago with the 15-day setting: valid until today + 5.
function createdTenDaysAgo(startIn) {
  const id = devisModel.create(devisBody(startIn)).data.id;
  db.prepare("UPDATE reservations SET createdAt = datetime('now', '-10 days'), validUntil = ? WHERE id = ?").run(inDays(5), id);
  return id;
}

test('m7 — « Validité des devis » raised to 30 days: a devis saved with its start unchanged keeps its date', async () => {
  const id = createdTenDaysAgo(60);
  db.prepare('UPDATE app_settings SET quoteValidityDays = 30 WHERE id = 1').run();
  const live = await preview(id, 60);
  const saved = devisModel.update(id, devisBody(60));
  assert.ok(!saved.error, JSON.stringify(saved));
  assert.equal(rowOf(id).validUntil, inDays(5), 'not the 30-day window from the creation day (today + 20)');
  assert.equal(live.validUntil, inDays(5));
  assert.equal(devisModel.findById(id).validUntil, inDays(5));
});

test('m8 — a devis created ten days ago, moved later: the preview reads its creation day, as the save', async () => {
  const id = createdTenDaysAgo(30);
  const live = await preview(id, 70);
  assert.equal(live.validUntil, inDays(5), 'not a window opened today (today + 15)');
  const saved = devisModel.update(id, devisBody(70));
  assert.ok(!saved.error, JSON.stringify(saved));
  assert.equal(rowOf(id).validUntil, live.validUntil);
  assert.equal(rowOf(id).balanceDueDate, live.balanceDueDate);
});

test('m10 — a row stored above start − 2: the link quote reads the capped date, as the fiche', () => {
  const id = devisModel.create(devisBody(42)).data.id;
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(inDays(10), inDays(13), id);
  assert.equal(rowOf(id).validUntil, inDays(15), 'stored above its cap');
  const read = devisModel.findById(id);
  assert.equal(read.validUntil, inDays(8));
  const quote = devisModel.recomputeQuote(id);
  assert.ok(quote, 'the link quote');
  assert.equal(quote.balanceDueDate, read.balanceDueDate, 'the single payment is due on the capped date');
  assert.equal(quote.balanceDueDate, inDays(8));
});
