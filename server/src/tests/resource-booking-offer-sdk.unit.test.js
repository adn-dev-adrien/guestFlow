// specs/gift-voucher-campaigns.md rules 15, 29, 36, 53 (SDK 2.33.0, generic — it names no consumer): what the core gained so a plugin can book an outside session for another —
// the booking offer a plugin declares and the core hands out, the prepaid source's optional `unused` call and its words, and the sale document paid in part by money an instrument
// already collected (`takePrepaid`): filed on the lines it names, off the books, never taken for caisse-interne money, readable line by line.
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const coreServices = require('../plugins/sdk/coreServices');
const prepaidSources = require('../utils/prepaidSources');
const standaloneSale = require('../utils/standaloneSale');
const sales = require('../models/standaloneSalesModel');
const payments = require('../models/standalonePaymentsModel');

const reset = () => {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
};
const OFFER = { freeSlots() {}, quote() {}, hold() {}, release() {}, bookOutside() {}, limits() {} };
const SOURCE = {
  source: 'storedCredit', label: 'Crédit', apply: () => ({}), held: () => null, settle: () => null, release: () => {},
};

test('a plugin declares the booking offer, one per instance, with its five calls; the core hands it out while the plugin is live and null otherwise', () => {
  reset();
  assert.equal(coreServices.resourceBookingOffer(), null);
  const ctx = createContext('desk', {});
  ['freeSlots', 'quote', 'hold', 'release', 'bookOutside', 'limits'].forEach((member) => {
    assert.throws(() => ctx.resourceBookingOffer({ ...OFFER, [member]: undefined }), new RegExp(`lacks "${member}"`));
  });
  ctx.resourceBookingOffer(OFFER);
  assert.equal(coreServices.resourceBookingOffer(), OFFER);
  assert.throws(() => createContext('other', {}).resourceBookingOffer(OFFER), /already declared by desk/);
  registry.configure({ isActive: (id) => id !== 'desk', allows: () => true });
  assert.equal(coreServices.resourceBookingOffer(), null, 'a plugin switched off offers nothing');
});

test('a prepaid source may declare `unused` and its words; without them it reads the defaults of its label, and a wrong declaration is refused', () => {
  reset();
  const ctx = createContext('credit', {});
  assert.throws(() => ctx.prepaid({ ...SOURCE, unused: 'nope' }), /unused must be a function/);
  assert.throws(() => ctx.prepaid({ ...SOURCE, includedTitle: ' ' }), /wording must be texts/);
  ctx.prepaid({ ...SOURCE, unused: () => {} });
  assert.deepEqual(prepaidSources.wordingOf('storedCredit'), { label: 'Crédit', includedTitle: 'Compris dans : Crédit', paidMark: 'Réglé par : Crédit' });
  reset();
  createContext('credit', {}).prepaid({ ...SOURCE, includedTitle: 'Compris dans le crédit', paidMark: 'Réglé par crédit' });
  assert.deepEqual(prepaidSources.wordingOf('storedCredit'), { label: 'Crédit', includedTitle: 'Compris dans le crédit', paidMark: 'Réglé par crédit' });
  assert.deepEqual(prepaidSources.wordingOf('gone', 'Ancien crédit'), { label: 'Ancien crédit', includedTitle: 'Compris dans : Ancien crédit', paidMark: 'Réglé par : Ancien crédit' }, 'a source no longer live is read from the tender\'s own label');
});

test('`unusedFor` tells the live source that declared the call, once; a source without it, an unknown one and a failing one are simply not told', () => {
  reset();
  const told = [];
  createContext('credit', {}).prepaid({ ...SOURCE, unused: (args) => told.push(args) });
  assert.equal(prepaidSources.unusedFor('storedCredit', { ref: 'C-1', label: 'Planche', valueCents: 1400 }), true);
  assert.deepEqual(told, [{ ref: 'C-1', label: 'Planche', valueCents: 1400 }]);
  assert.equal(prepaidSources.unusedFor('unknown', { ref: 'C-1', label: 'x', valueCents: 1 }), false);
  reset();
  createContext('credit', {}).prepaid(SOURCE);
  assert.equal(prepaidSources.unusedFor('storedCredit', { ref: 'C-1', label: 'x', valueCents: 1 }), false);
  reset();
  const quiet = console.error;
  console.error = () => {};
  try {
    createContext('credit', {}).prepaid({ ...SOURCE, unused: () => { throw new Error('down'); } });
    assert.equal(prepaidSources.unusedFor('storedCredit', { ref: 'C-1', label: 'x', valueCents: 1 }), false);
  } finally { console.error = quiet; }
});

const option = (title, price) => Number(db.prepare("INSERT INTO options (title, price, priceType, vatClass, sellableExternally) VALUES (?, ?, 'per_stay', 'catering', 1)").run(title, price).lastInsertRowid);
sales.setExternalRate('catering', 10);
const board = option('Planche', 14);
const drink = option('Boisson', 6.5);

function soldSale() {
  const sold = standaloneSale.sell({ lines: [{ articleRef: `option:${board}`, quantity: 1 }, { articleRef: `option:${drink}`, quantity: 2 }], customer: { name: 'Léa' } });
  assert.equal(sold.status, 200);
  return sold.document.document.id;
}
const TENDER = { source: 'storedCredit', ref: 'C-1', label: 'Crédit' };

test('takePrepaid files the money on the lines it names, off the books, and the rest of the sale is collected the usual way', () => {
  const saleId = soldSale();
  const taken = standaloneSale.takePrepaid(saleId, { tender: TENDER, covers: [{ articleRef: `option:${board}`, amountCents: 1400 }], actor: 'tester' });
  assert.deepEqual([taken.status, taken.receivedCents], [200, 1400]);
  const document = standaloneSale.documentOf(saleId);
  assert.deepEqual(document.lines.map((l) => [l.label, l.status, l.settledCents]), [['Planche', 'paid', 1400], ['Boisson', 'due', 0]]);
  assert.deepEqual([document.totals.totalCents, document.totals.paidCents, document.totals.remainingCents, document.totals.internalHeldCents], [2700, 1400, 1300, 0]);
  const rows = payments.allocationsOf(saleId);
  assert.deepEqual(rows.map((r) => [r.paymentRef.replace(/\d+/, 'N'), r.amountCents, r.books]), [['standalone-payment:N:prepaid', 1400, 0]], 'off the books: its sale was the encaissement');
  assert.deepEqual(standaloneSale.paidByOf(saleId).map((p) => [p.kind, p.label, p.source, p.ref, p.amountCents]), [['prepaid', 'Crédit', 'storedCredit', 'C-1', 1400]]);
  standaloneSale.receive(saleId, { method: 'card', amountCents: 1300, source: 'basket:1' });
  assert.deepEqual(standaloneSale.paidByOf(saleId).map((p) => [p.kind, p.label, p.amountCents]), [['prepaid', 'Crédit', 1400], ['money', 'CB', 1300]]);
  assert.equal(standaloneSale.documentOf(saleId).totals.remainingCents, 0);
  assert.deepEqual(standaloneSale.historyOf(saleId).map((h) => h.text).slice(-2), ['14,00 € réglés : Crédit', '13,00 € encaissés : CB']);
});

test('takePrepaid refuses a cover that names no line, more than the line asks, or nothing — and writes nothing', () => {
  const saleId = soldSale();
  const refused = (covers) => standaloneSale.takePrepaid(saleId, { tender: TENDER, covers });
  [[{ articleRef: 'option:999999', amountCents: 100 }], [{ articleRef: `option:${board}`, amountCents: 1401 }], [{ articleRef: `option:${board}`, amountCents: 0 }], []]
    .forEach((covers) => assert.deepEqual([refused(covers).status, refused(covers).body.code], [409, 'PREPAID_COVER_INVALID']));
  assert.deepEqual(payments.allocationsOf(saleId), []);
  assert.equal(standaloneSale.documentOf(saleId).totals.paidCents, 0);
});

test('a prepaid line is not caisse-interne money: an internal payment on the same sale still counts as held, the prepaid one never does', () => {
  const saleId = soldSale();
  standaloneSale.takePrepaid(saleId, { tender: TENDER, covers: [{ articleRef: `option:${board}`, amountCents: 1400 }] });
  assert.equal(standaloneSale.documentOf(saleId).totals.internalHeldCents, 0);
  standaloneSale.takePayment(saleId, { tenders: [{ method: 'cash', amountCents: 1300, internal: true }] });
  assert.equal(standaloneSale.documentOf(saleId).totals.internalHeldCents, 1300);
});

test('the journal reads the prepaid allocations as off the books: the sale it came from declared that money', () => {
  const saleId = soldSale();
  standaloneSale.takePrepaid(saleId, { tender: TENDER, covers: [{ articleRef: `option:${board}`, amountCents: 1400 }], paidAt: '2026-11-16' }); // date-literal-ok: the suite runs on its own clock, never the real today
  standaloneSale.receive(saleId, { method: 'card', amountCents: 1300, paidAt: '2026-11-16', source: 'basket:2' }); // date-literal-ok: the suite runs on its own clock, never the real today
  const [moved] = payments.documentsPaidBetween('2026-11-16', '2026-11-16').filter((d) => d.sale.id === saleId); // date-literal-ok: the suite runs on its own clock, never the real today
  const booked = moved.payments.flatMap((p) => p.allocations || []).filter((a) => Number(a.books) === 1).reduce((sum, a) => sum + a.amountCents, 0);
  assert.equal(booked, 1300, 'only what the card collected is booked');
});

test('nothing the core gained for this names a consumer: no « voucher », no « bon cadeau » in the files that carry it', () => {
  const fs = require('fs');
  const path = require('path');
  ['plugins/sdk/createContext.js', 'plugins/sdk/coreServices.js', 'utils/prepaidSources.js', 'utils/standaloneSale.js', 'models/standalonePaymentsModel.js', 'utils/receptionView.js']
    .forEach((file) => assert.equal(/voucher|bon cadeau/i.test(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')), false, file));
});
