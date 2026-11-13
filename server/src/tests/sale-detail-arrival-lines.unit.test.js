// specs/pricing-components.md §3 rule 91 — the sale detail lists everything the arrival complement collects as arrival lines: the tax part
// it collects, the added guests, and what it collects beyond its lines (« Complément d'arrivée »); the guest e-mails read their itemised
// complement from it (`arrivalComplementDetailOf`), in the very shape and order of the stored breakdown (`buildArrivalComplementDetail`).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');
const extraSale = require('../utils/extraSale');
const { buildSaleDetail, arrivalComplementLines } = require('../utils/saleDetail');
const { ADDED_GUESTS_TAX_LABEL } = require('../utils/platformPaidGuests');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const quote = (over = {}) => ({
  nights: 4, finalPrice: 450, touristTaxTotal: 12, vatRegime: { regime: 'subject', rate: 10 }, preArrivalAmount: 412, complementAmount: 0, endOfStayComplementTotal: 0,
  optionLines: [{ optionId: 1, title: 'Petit déjeuner', quantity: 2, billedUnits: 4, unitPrice: 10, totalPrice: 40, inComplement: 1 }],
  resourceLines: [],
  ...over,
});
const byRef = (detail) => Object.fromEntries(detail.lines.map((line) => [line.ref, line]));

test('rule 91 — the tax part the complement collects is an arrival line of its own, the rest stays in the plan', () => {
  const detail = buildSaleDetail({
    quote: quote({ complementAmount: 44 }),
    stored: { finalCents: 45000, touristTaxCents: 1200, touristTaxArrivalCents: 400, touristTaxArrivalLabel: ADDED_GUESTS_TAX_LABEL },
  });
  const lines = byRef(detail);
  assert.deepEqual([lines.touristTax.totalCents, lines.touristTax.collectAt], [800, 'plan']);
  assert.deepEqual([lines.touristTaxArrival.totalCents, lines.touristTaxArrival.collectAt, lines.touristTaxArrival.label], [400, 'arrival', ADDED_GUESTS_TAX_LABEL]);
  assert.equal(detail.totals.totalCents, 45000 + 1200);
});

test('rule 91 — a tax wholly collected at the arrival keeps one line, at the arrival', () => {
  const detail = buildSaleDetail({ quote: quote({ complementAmount: 52 }), stored: { finalCents: 45000, touristTaxCents: 1200, touristTaxArrivalCents: 1200 } });
  const taxLines = detail.lines.filter((line) => line.kind === 'touristTax');
  assert.deepEqual(taxLines.map((line) => [line.ref, line.collectAt, line.totalCents]), [['touristTax', 'arrival', 1200]]);
});

test('rule 91 — the added guests are an arrival line taken out of the accommodation; offered, they bill 0', () => {
  const sold = byRef(buildSaleDetail({
    quote: quote({ complementAmount: 90 }),
    stored: { finalCents: 45000, touristTaxCents: 1200, extraGuestsCents: 5000, extraGuestsCount: 2 },
  }));
  assert.deepEqual([sold.extraGuests.totalCents, sold.extraGuests.collectAt, sold.extraGuests.unitCents, sold.extraGuests.quantity], [5000, 'arrival', 2500, 2]);
  assert.equal(sold.accommodation.totalCents, 45000 - 4000 - 5000);
  const offered = byRef(buildSaleDetail({
    quote: quote({ complementAmount: 40 }),
    stored: { finalCents: 45000, touristTaxCents: 1200, extraGuestsCents: 5000, extraGuestsOffered: true, extraGuestsCount: 1 },
  }));
  assert.deepEqual([offered.extraGuests.totalCents, offered.extraGuests.status], [0, 'offered']);
  assert.equal(offered.accommodation.totalCents, 45000 - 4000);
});

test('rule 91 — what the complement collects beyond its lines is « Complément d\'arrivée »; a lower complement lists nothing', () => {
  const above = byRef(buildSaleDetail({ quote: quote({ complementAmount: 60.6 }), stored: { finalCents: 45000, touristTaxCents: 1200 } }));
  assert.deepEqual([above.arrivalAdjustment.totalCents, above.arrivalAdjustment.label, above.arrivalAdjustment.collectAt], [2060, 'Complément d\'arrivée', 'arrival']);
  const below = byRef(buildSaleDetail({ quote: quote({ complementAmount: 30 }), stored: { finalCents: 45000, touristTaxCents: 1200 } }));
  assert.equal(below.arrivalAdjustment, undefined);
  const oneCent = byRef(buildSaleDetail({ quote: quote({ complementAmount: 40.01 }), stored: { finalCents: 45000, touristTaxCents: 1200 } }));
  assert.equal(oneCent.arrivalAdjustment, undefined, 'one cent is rounding, as the e-mails have always read it');
});

test('rule 91 — the e-mail lines: billed units × unit price, the e-mail order, nothing offered nor at 0 €', () => {
  const detail = buildSaleDetail({
    quote: quote({
      complementAmount: 120,
      resourceLines: [{ resourceId: 2, name: 'Bain nordique', quantity: 1, unitPrice: 0, totalPrice: 0, inComplement: 1 }],
    }),
    stored: { finalCents: 45000, touristTaxCents: 1200, touristTaxArrivalCents: 1200, extraGuestsCents: 3000, extraGuestsCount: 2 },
  });
  assert.deepEqual(arrivalComplementLines(detail), [
    { kind: 'option', label: 'Petit déjeuner', qty: 4, unitPrice: 10, amount: 40 },
    { kind: 'extraGuests', label: 'Voyageurs ajoutés', qty: 2, unitPrice: 15, amount: 30 },
    { kind: 'tax', label: 'Taxe de séjour', qty: 1, unitPrice: 12, amount: 12 },
    { kind: 'remainder', label: 'Complément d\'arrivée', qty: 1, unitPrice: 38, amount: 38 },
  ]);
});

db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9911, 'Arrivées', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9911, 'Camille', 'Arrivée')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9911, 'Standard', 100)").run();
const basket = Number(db.prepare("INSERT INTO options (title, price, priceType) VALUES ('Panier', 25, 'per_stay')").run().lastInsertRowid);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (9911, ?)').run(basket);

test('rule 91 — on a stored stay, the e-mail reads from the sale detail exactly what the stored breakdown lists', () => {
  const startDate = addDaysToIsoDate(todayIso(), 5);
  const id = Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime, balanceDueDate)
    VALUES (9911, 9911, ?, ?, 'direct', 2, 400, 400, 'reservation', '15:00', ?)`).run(startDate, addDaysToIsoDate(startDate, 4), startDate).lastInsertRowid);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${basket}`, quantity: 1 }]).status, 200);
  const ref = extraSale.saleDetailOf(id).lines.find((line) => line.label === 'Panier').ref;
  assert.equal(extraSale.changeLine(id, ref, { collectAt: 'arrival' }).status, 200);
  db.prepare("UPDATE reservations SET complementAmount = 31.5, complementAmountOverride = '31.5' WHERE id = ?").run(id);
  const fromSale = extraSale.arrivalComplementDetailOf(id);
  const stored = model.buildArrivalComplementDetail(id);
  assert.deepEqual(fromSale.detail, stored.detail.map(({ ref: _ref, ...line }) => line));
  assert.deepEqual([fromSale.amount, fromSale.paid], [stored.amount, stored.paid]);
  assert.deepEqual(fromSale.detail.map((line) => [line.kind, line.amount]), [['option', 25], ['remainder', 6.5]]);
});
