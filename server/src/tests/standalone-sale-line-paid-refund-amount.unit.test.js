// specs/sas/outside-booking-sas.md rules 44 (mock M5) and 55 (stabilisation loop t3, B3-3) — the LINE_PAID refusal names what the confirmed lowering would
// really open: the line's money first pays the lines still due (rule 52), only the rest is owed back. Nothing to open, no confirmation asked.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const sales = require('../models/standaloneSalesModel');

const option = (title, price, vatClass) => Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES (?, ?, 'per_stay', 1, ?)")
  .run(title, price, vatClass).lastInsertRowid);
const beer = option('Bière à confirmer', 6.5, 'drinks');
const board = option('Planche à confirmer', 14, 'catering');
sales.setExternalRate('drinks', 20);
sales.setExternalRate('catering', 10);

const sell = (cents) => standaloneSale.sell({
  lines: [{ articleRef: `option:${beer}`, quantity: 2 }, { articleRef: `option:${board}`, quantity: 1 }],
  payment: { tenders: [{ method: 'card', amountCents: cents }], ...(cents < 2700 ? { shortfall: { kind: 'due' } } : {}) },
}).document;
const openRows = (id) => sales.obligationsOf(id).map((row) => row.amountCents);

for (const action of ['offer', 'remove']) {
  const lower = (id, lineId, extra = {}) => (action === 'offer'
    ? standaloneSale.offerLine(id, lineId, { offered: true, ...extra })
    : standaloneSale.removeLine(id, lineId, extra));

  test(`B3-3 ${action} — paid beers on a document whose plank is still due: their money pays the plank, no refund to confirm`, () => {
    const sold = sell(1300);
    const { id } = sold.document;
    const done = lower(id, sold.lines[0].id);
    assert.equal(done.status, 200, 'no LINE_PAID: nothing would be owed back');
    assert.deepEqual([done.document.totals.remainingCents, done.document.totals.refundOwedCents], [100, 0]);
    assert.deepEqual(openRows(id), []);
  });

  test(`B3-3 ${action} — paid beers on a document fully paid: the refusal names the 13 € the confirmation opens`, () => {
    const sold = sell(2700);
    const { id } = sold.document;
    const ask = lower(id, sold.lines[0].id);
    assert.equal(ask.status, 409);
    assert.equal(ask.body.code, 'LINE_PAID');
    assert.equal(ask.body.refundCents, 1300);
    assert.equal(ask.body.error, 'Ligne payée : remboursement à confirmer. 13,00 € à rembourser.');
    lower(id, sold.lines[0].id, { confirmRefund: true });
    assert.deepEqual(openRows(id), [1300]);
  });

  test(`B3-3 ${action} — paid beers, plank partly paid: the refusal names only what is left once the plank is paid`, () => {
    const sold = sell(2000);
    const { id } = sold.document;
    const ask = lower(id, sold.lines[0].id);
    assert.equal(ask.status, 409);
    assert.equal(ask.body.refundCents, 600, '13 € held, 7 € pay the plank, 6 € owed back');
    assert.match(ask.body.error, /6,00 € à rembourser/);
    const done = lower(id, sold.lines[0].id, { confirmRefund: true });
    assert.deepEqual(openRows(id), [600], 'the row the confirmation opened is the amount the dialog named');
    assert.equal(done.document.totals.remainingCents, 0);
  });
}
