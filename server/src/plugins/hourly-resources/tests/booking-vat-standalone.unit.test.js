// specs/resource-booking-pricing-and-invoicing.md rules 5, 21 and 35 (R35-S2, R35-DB-M3, R35-M-M1) — the VAT of a
// resource booking, on a real core database: a walk-in guest takes the « TVA des ventes hors séjour » setting, a booking
// on a stay its stay's rate, an instance out of VAT none. Once paid, the rate is frozen with the payment: the journal and
// the invoice keep it whatever the setting or the VAT period says later; an unpaid booking's preview follows them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVatGoldenDb } = require('../../../tests/vatRegimeGoldenFixture');
const migrations = require('../migrations');
const bookingsModel = require('../bookingsModel');
const { createInvoicing } = require('../invoicing');
const { FAR_YEAR: Y } = require('../../../tests/farYearFixture');

const db = buildVatGoldenDb();
let setting = 20;
const model = bookingsModel.create(db, { standaloneVatRate: () => setting });
migrations.createTables(db);
migrations.bookingsV2(db);
migrations.bookingsV3(db, (d, row) => model.vatFor(row).rate);
migrations.bookingsV4(db);
const resourceId = Number(db.prepare(`INSERT INTO resources (name, quantity, price, priceType, slotDuration, openTime, closeTime,
  showsPlanningCard, hourlyEveningStart, hourlyEveningRate, hourlyExternalDayRate, hourlyExternalEveningRate)
  VALUES ('Bain fictif', 3, 25, 'per_hour', 30, '10:00', '22:00', 1, '19:00', 35, 50, 70)`).run().lastInsertRowid);
const DAY = `${Y}-02-13`;
const draft = (extra = {}) => ({ resourceId, date: DAY, startTime: '18:00', endTime: '20:00', ...extra });
const book = (extra = {}) => Number(model.createBooking({ ...draft(), clientName: 'Ana Lune', ...extra }).id);
const card = (cents) => [{ method: 'card', amountCents: cents, internal: false }];
const salesOf = () => model.standaloneSales({ from: `${Y}-01-01`, to: `${Y}-12-31` });
const subject = () => db.prepare("UPDATE vat_periods SET regime = 'subject', rate = 10, legalMention = NULL").run();
const notSubject = () => db.prepare("UPDATE vat_periods SET regime = 'not_subject', rate = 0, legalMention = 'art_293_b'").run();

test('rule 5 — a walk-in guest takes the setting; a booking on a stay its stay\'s rate', () => {
  setting = 20;
  assert.equal(model.priceBooking(draft()).vat.rate, 20);
  // A stay-linked row is a stored one (rule 46: no write links a booking to a stay any more).
  const onStay = Number(model.createBooking({ ...draft({ startTime: '10:00', endTime: '11:00' }), clientName: 'X' }).id);
  db.prepare('UPDATE resource_bookings SET reservationId = 101 WHERE id = ?').run(onStay);
  assert.equal(model.priceBooking(draft({ startTime: '10:00', endTime: '11:00', bookingId: onStay })).vat.rate, 10);
  setting = 10;
  assert.equal(model.priceBooking(draft()).vat.rate, 10, 'the preview of an unpaid booking follows the setting');
  setting = 20;
});

test('rule 5 — an instance out of VAT: no VAT whatever the setting', () => {
  notSubject();
  try {
    assert.equal(model.priceBooking(draft()).vat, null);
  } finally { subject(); }
});

test('rule 35 — paid at 20 %, the setting then at 10 %: journal, invoice and preview keep 20 %', async () => {
  setting = 20;
  const id = book({ startTime: '12:00', endTime: '13:00' });
  assert.equal(model.recordPayment(id, { tenders: card(5000), paidAt: DAY }).ok, true);
  setting = 10;
  const sale = salesOf().find((s) => s.key === `resource-booking:${id}`);
  assert.equal(sale.vatRate, 20);
  assert.equal(model.priceBooking(draft({ startTime: '12:00', endTime: '13:00', bookingId: id })).vat.rate, 20);
  let asked = null;
  const invoicing = createInvoicing({
    bookings: () => model,
    issuers: () => ({ isReady: () => true, async issue(r) { asked = r; return { invoiceId: 'i', number: 'F-1', clientId: 'c', markedPaid: true }; }, async findCardBatch() { return null; } }),
    logger: { error() {}, warn() {} },
  });
  assert.equal((await invoicing.issue(id)).ok, true);
  assert.deepEqual(asked.items.map((i) => i.vatRate), [20]);
  assert.equal(model.rawById(id).invoiceVatRate, 20);
  setting = 20;
});

test('rule 35 — a VAT period moved out of VAT later never re-books a sale paid under it', () => {
  setting = 20;
  const id = book({ startTime: '14:00', endTime: '15:00' });
  model.recordPayment(id, { tenders: [{ method: 'cheque', amountCents: 5000 }], paidAt: DAY });
  notSubject();
  try {
    assert.equal(salesOf().find((s) => s.key === `resource-booking:${id}`).vatRate, 20);
  } finally { subject(); }
});

test('rule 35 — un-recording the payment unfreezes: paid again, the rate of the day', () => {
  setting = 20;
  const id = book({ startTime: '15:00', endTime: '16:00' });
  model.recordPayment(id, { tenders: card(5000), paidAt: DAY });
  setting = 10;
  assert.equal(model.clearPayment(id).ok, true);
  assert.equal(model.rawById(id).paidVatRate, null);
  model.recordPayment(id, { tenders: card(5000), paidAt: DAY });
  assert.equal(salesOf().find((s) => s.key === `resource-booking:${id}`).vatRate, 10);
  setting = 20;
});

test('rules 21, 35 — a split payment (caisse interne + CB) journals its part on the books only, at its frozen rate', () => {
  setting = 20;
  const id = book({ startTime: '16:00', endTime: '17:00' });
  model.recordPayment(id, { tenders: [{ method: 'cash', amountCents: 2000, internal: true }, { method: 'card', amountCents: 3000 }], paidAt: DAY });
  const sale = salesOf().find((s) => s.key === `resource-booking:${id}`);
  assert.equal(sale.totalCents, 5000);
  assert.equal(sale.booksCents, 3000);
  assert.equal(sale.cardCents, 3000);
});

test('rule 35 — the migration freezes a booking paid before it at the rate in force, an invoiced one at its invoice\'s', () => {
  setting = 20;
  const paid = book({ startTime: '10:30', endTime: '11:30' });
  const invoiced = book({ startTime: '11:30', endTime: '12:30' });
  db.prepare("UPDATE resource_bookings SET paid = 1, paidAt = ?, paymentRecordedAt = datetime('now'), paymentTenders = ?, paidVatRate = NULL WHERE id IN (?, ?)")
    .run(DAY, JSON.stringify(card(5000)), paid, invoiced);
  db.prepare("UPDATE resource_bookings SET qontoInvoiceId = 'q', invoiceVatRate = 5.5 WHERE id = ?").run(invoiced);
  migrations.bookingsV3(db, (d, row) => model.vatFor(row).rate);
  assert.equal(model.rawById(paid).paidVatRate, 20);
  assert.equal(model.rawById(invoiced).paidVatRate, 5.5);
});
