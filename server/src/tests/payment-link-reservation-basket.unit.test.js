// specs/payment-links-vat.md rule 8 and specs/qonto-payment-link-reference.md rule 10 — a link
// created for a RESERVATION (no engine replay) carries its VAT basket built from the stored columns,
// and its stay line names the logement, the reference and the guest (mega review #5, M6: one
// « Solde séjour » line at 0 % with no reference, unidentifiable in Qonto).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const paymentLinksModel = require('../models/paymentLinksModel');
const { ensurePaymentLink } = require('../utils/paymentRequestService');
const { storedLinkComponents } = require('../utils/storedLinkComponents');
const { __test: { storedReservationComponents } } = require('../controllers/paymentsController');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
const TITLES = { deposit: 'Acompte séjour', balance: 'Solde séjour', full: 'Paiement séjour' };

function seed({ touristTaxInComplement = 0 } = {}) {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  const cols = db.prepare('PRAGMA table_info(reservations)').all().map((c) => c.name);
  if (!cols.includes('reservationNumber')) db.exec('ALTER TABLE reservations ADD COLUMN reservationNumber TEXT');
  db.prepare('INSERT OR REPLACE INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare("INSERT INTO properties (id, name) VALUES (1, 'Gîte')").run();
  db.prepare("INSERT INTO clients (id, firstName, lastName, email) VALUES (1, 'Zoë', 'Martin', 'z@x.fr')").run();
  const id = Number(db.prepare(`INSERT INTO reservations (kind, propertyId, clientId, startDate, endDate, adults,
      finalPrice, depositAmount, balanceAmount, touristTaxTotal, touristTaxInComplement, reservationNumber)
    VALUES ('reservation', 1, 1, '2027-03-08', '2027-03-11', 2, 400, 100, 307.20, 7.20, ?, '202609-014')`).run(touristTaxInComplement).lastInsertRowid);
  return { db, id };
}

test('rule 8 — the stored basket: solde minus tax at the VAT rate, plus a 0 % tax line', () => {
  const row = { depositAmount: 100, balanceAmount: 307.2, finalPrice: 400, touristTaxTotal: 7.2 };
  assert.deepEqual(storedLinkComponents(row, 'balance', { vatRatePercent: 10, taxOnArrival: false, titles: TITLES }), {
    components: [{ title: 'Solde séjour', grossCents: 30000, taxable: true }, { title: 'Taxe de séjour', grossCents: 720, taxable: false }],
    vatRatePercent: 10,
  });
  assert.deepEqual(storedLinkComponents(row, 'balance', { vatRatePercent: 10, taxOnArrival: true, titles: TITLES }).components, [{ title: 'Solde séjour', grossCents: 30720, taxable: true }]);
  assert.deepEqual(storedLinkComponents(row, 'deposit', { vatRatePercent: 10, taxOnArrival: false, titles: TITLES }).components, [{ title: 'Acompte séjour', grossCents: 10000, taxable: true }]);
  assert.equal(storedLinkComponents({ ...row, touristTaxTotal: 500 }, 'balance', { vatRatePercent: 10, taxOnArrival: false, titles: TITLES }), null, 'a tax above the solde cannot be split');
});

// specs/qonto-payment-link-reference.md rule 10 — the stay line's title, checked below.
test('rule 8 — a reservation link is created as a VAT basket named after the stay (rule 10)', async () => {
  const { db, id } = seed();
  const sent = [];
  const provider = { id: 'qonto', createLink: async (args) => { sent.push(args); return { id: 'ql_1', url: 'https://pay/1', status: 'open' }; } };
  await ensurePaymentLink({
    database: db,
    paymentLinksModel: paymentLinksModel.buildModel(db),
    resolveAmountCents: () => 30720,
    resolveItems: (rid, type) => storedReservationComponents(rid, type, db),
    provider,
  }, id, 'balance');
  assert.equal(sent.length, 1);
  const { items, expectedTotalCents } = sent[0];
  assert.equal(expectedTotalCents, 30720);
  assert.ok(Array.isArray(items) && items.length === 2, 'two lines: the stay and the tourist tax');
  const stay = items[0];
  assert.match(stay.title, /Gîte/);
  assert.match(stay.title, /202609-014/);
  assert.match(stay.title, /Zoë Martin/);
  assert.equal(String(stay.vat_rate ?? stay.vatRate), '10');
});

// specs/qonto-payment-link-reference.md rule 10
test('rule 10 — the single 0 % fallback line is named like the stay line too', async () => {
  const { db, id } = seed();
  const sent = [];
  const provider = { id: 'qonto', createLink: async (args) => { sent.push(args); return { id: 'ql_2', url: 'https://pay/2', status: 'open' }; } };
  await ensurePaymentLink({
    database: db, paymentLinksModel: paymentLinksModel.buildModel(db), resolveAmountCents: () => 30720, provider,
  }, id, 'balance');
  assert.equal(sent[0].items, undefined);
  assert.match(sent[0].title, /202609-014/);
  assert.match(sent[0].title, /Zoë Martin/);
});
