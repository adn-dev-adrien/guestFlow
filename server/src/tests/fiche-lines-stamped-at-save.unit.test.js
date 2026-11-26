// specs/pricing/pricing-components.md §3 rules 36, 37, 97 (loop t1 D-2) — a line the operator adds on the fiche is stamped by the save that writes it: its sale
// date is the save's (never the booking's at the next boot), its moment, article and family are set, and a second migration run changes nothing.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, beer } = require('./saleRound1Fixtures');
const controller = require('../controllers/reservationsController');
const model = require('../models/reservationsModel');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { runPricingLinesMigration } = require('../utils/pricingLinesMigration');

test('D-2 — a fiche save adding an option stamps it now: soldAt today, moment, articleRef, family and label; the boot pass finds nothing left', async () => {
  const id = stay(20);
  db.prepare("UPDATE reservations SET createdAt = datetime('now', '-30 day') WHERE id = ?").run(id);
  const body = { ...toUpdateBody(model.getByIdWithDetails(id), new Set()), options: [{ optionId: beer, quantity: 1, offered: false }] };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await controller.update({ params: { id: String(id) }, query: {}, user: { roles: ['admin'] }, body }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const line = db.prepare('SELECT source, soldAt, collectAt, articleRef, family, label FROM reservation_options WHERE reservationId = ?').get(id);
  assert.equal(line.source, 'fiche');
  assert.equal(String(line.soldAt).slice(0, 10), new Date().toISOString().slice(0, 10), 'sold today, not on the booking day');
  assert.deepEqual([line.collectAt, line.articleRef, line.family, line.label], ['plan', `option:${beer}`, 'fixed', 'Bière ronde']);
  assert.equal(runPricingLinesMigration(db).lineColumns, 0);
});
