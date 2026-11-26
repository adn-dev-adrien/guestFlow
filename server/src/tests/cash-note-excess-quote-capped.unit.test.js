// specs/pricing/pricing-components.md §3 rule 106 b (stabilisation loop t7, data observation, 2026-11-16) — the default « Caisse interne » refund means of a
// save not written yet reads the cash a note took beyond what the quote charges on its line, capped by what the quote charges anew: a line added,
// un-offered or raised takes the freed note money first (rule 104), so a mixed save — cash freed on one line, an unpaid line added, a booked
// trop-perçu elsewhere — never defaults that booked money to the caisse interne. Before: the quote branch was uncapped.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, beer, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');
const { cashNoteExcessCents } = require('../utils/cashNoteExcess');

const wine = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Vin cash', 10, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9701, ?)').run(wine);
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const patch = (id, body) => ctrl.updatePayment({ params: { id: String(id) }, body, query: {}, user: { id: 1, role: 'admin' } }, respond());

// A started direct stay, solde paid, 30 € of beer sold during the stay and paid in cash (a cash note).
function cashBeer() {
  const id = stay(20);
  ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true });
  patch(id, { balancePaid: true, balancePaidDate: todayIso() });
  patch(id, { checkInDone: true });
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 5 }], { now: at(id, '12:00', 1), payment: 'cash' }).status, 200);
  return id;
}
const quoteOf = (lines) => ({ optionLines: lines, resourceLines: [] });

test('the cash beer offered in a save: its 30 € are cash freed, the default means can be « Caisse interne »', () => {
  const id = cashBeer();
  assert.equal(cashNoteExcessCents(db, id, { quote: quoteOf([{ optionId: beer, totalPrice: 30, offered: true }]) }), 3000);
});

test('the same save adding an unpaid 30 € line: that line takes the freed cash first, nothing is left to default to the caisse interne', () => {
  const id = cashBeer();
  const quote = quoteOf([{ optionId: beer, totalPrice: 30, offered: true }, { optionId: wine, totalPrice: 30, offered: false }]);
  assert.equal(cashNoteExcessCents(db, id, { quote }), 0);
});

test('an unpaid 10 € line added: 20 € of the freed cash are left; an offered new line takes nothing', () => {
  const id = cashBeer();
  assert.equal(cashNoteExcessCents(db, id, { quote: quoteOf([{ optionId: beer, totalPrice: 30, offered: true }, { optionId: wine, totalPrice: 10, offered: false }]) }), 2000);
  assert.equal(cashNoteExcessCents(db, id, { quote: quoteOf([{ optionId: beer, totalPrice: 30, offered: true }, { optionId: wine, totalPrice: 10, offered: true }]) }), 3000);
});

test('the stored read (no quote) is unchanged: capped by what no bucket absorbs', () => {
  const id = cashBeer();
  assert.equal(cashNoteExcessCents(db, id), 0, 'the beer is charged: nothing freed');
});
