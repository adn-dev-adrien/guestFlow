// specs/vat-optional-mode.md rule 12 (c) and payment-links-vat rule 11 — under « Sans TVA » a payment link
// carries the same items (stay, « Taxe de séjour », « Ajustement ») and the same charged total, to the
// cent, every item at VAT rate 0.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVatGoldenDb } = require('./vatRegimeGoldenFixture');

const db = buildVatGoldenDb();
const payments = require('../controllers/paymentsController').__test;
const devisQuote = require('../utils/devisQuote');
const publicPayment = require('../utils/publicPaymentMode');
const devisModel = require('../models/devisModel');
const { calculateReservationQuote } = require('../utils/pricing');
const { buildVatItems } = require('../utils/paymentLinkItems');
const installments = require('../models/installmentsModel');

const NOT_SUBJECT = Number(db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_293_b', 'all')").run().lastInsertRowid);
const toggle = (id, notSubject) => db.prepare('UPDATE reservations SET vatPeriodId = ? WHERE id = ?').run(notSubject ? NOT_SUBJECT : 1, id);
const gross = (basket) => basket.components.reduce((sum, c) => sum + c.grossCents, 0);

test('rule 12 (c): a stay basket has the same items and the same total, at rate 0', () => {
  let compared = 0;
  for (const type of ['deposit', 'balance', 'full']) {
    for (const id of [101, 104, 108]) {
      const before = payments.storedReservationComponents(id, type);
      if (!before) continue;
      compared += 1;
      toggle(id, true);
      const after = payments.storedReservationComponents(id, type);
      toggle(id, false);
      assert.deepEqual(after.components, before.components, `${id} ${type}`);
      assert.equal(after.vatRatePercent, 0);
      const items = buildVatItems(after);
      assert.equal(items.expectedTotalCents, gross(before));
      assert.ok(items.items.every((i) => i.vatRate === 0));
      assert.ok(!items.items.some((i) => i.title === 'Ajustement'), 'at rate 0 the cents need no adjustment line');
      assert.deepEqual(items.items.map((i) => i.title), buildVatItems(before).items.map((i) => i.title).filter((t) => t !== 'Ajustement'));
    }
  }
  assert.ok(compared >= 6, `baskets compared: ${compared}`);
});

test('rule 12 (c): the tourist-tax line stays its own item', () => {
  toggle(101, true);
  const basket = payments.storedReservationComponents(101, 'balance');
  toggle(101, false);
  assert.ok(buildVatItems(basket).items.some((i) => i.title === 'Taxe de séjour' && i.vatRate === 0));
});

test('rule 12 (c): an installment of a « Sans TVA » stay carries rate 0 and its tax share', () => {
  const plan = installments.listFor(106);
  const before = payments.resolveInstallmentComponents(106, plan[0], plan);
  toggle(106, true);
  const after = payments.resolveInstallmentComponents(106, plan[0], plan);
  toggle(106, false);
  assert.equal(after.vatRatePercent, 0);
  assert.equal(gross(after), gross(before));
});

test('rule 12 (c): the public payment of a devis quoted « Sans TVA » goes at rate 0, same amounts', () => {
  const calc = calculateReservationQuote;
  const before = devisQuote.fullPaymentComponents({ database: db, devisModel, calc }, 202);
  const beforeDeposit = publicPayment.depositPaymentComponents(db, 202);
  db.prepare("INSERT INTO vat_periods (regime, rate, legalMention, basis) VALUES ('not_subject', 0, 'art_261_d_4', 'all')").run();
  const after = devisQuote.fullPaymentComponents({ database: db, devisModel, calc }, 202);
  const afterDeposit = publicPayment.depositPaymentComponents(db, 202);
  assert.equal(after.vatRatePercent, 0);
  assert.equal(afterDeposit.vatRatePercent, 0);
  assert.equal(gross(after), gross(before));
  assert.equal(gross(afterDeposit), gross(beforeDeposit));
  assert.ok(buildVatItems(after).items.every((i) => i.vatRate === 0));
});
