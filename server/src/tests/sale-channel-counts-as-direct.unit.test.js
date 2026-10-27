// specs/plugins-phase-p-productisation.md rule 45 (audit 2026-10-27) — a platform « Compté comme vente
// directe » is a direct sale in every money path: acompte and solde like direct, no default
// extras-to-complement, tourist tax on the solde, and a paid solde follows an entered platform amount.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote } = require('../utils/pricing');
const { buildLedger } = require('../utils/reservationLedger');
const { saleChannel } = require('../utils/saleChannel');
const { setDirectChannels } = require('../utils/platformNameFormat');
const { pricingAuditDb, STAY } = require('./pricingAuditFixture');

test.beforeEach(() => setDirectChannels(['lodgify']));
test.after(() => setDirectChannels([]));

const lodgifyDb = (mode = { collects: 0, remits: 0 }) => pricingAuditDb({
  touristTax: 1.2, platforms: [{ name: 'Lodgify', countsAsDirect: 1, ...mode }, { name: 'Booking', collects: 0, remits: 0 }],
});

test('the helper: own channel, platform sale, named channel', () => {
  assert.deepEqual(saleChannel('direct'), { ownChannel: true, platformSale: false, namedChannel: false });
  assert.deepEqual(saleChannel('Lodgify'), { ownChannel: true, platformSale: false, namedChannel: true });
  assert.deepEqual(saleChannel('Booking'), { ownChannel: false, platformSale: true, namedChannel: true });
});

test('an extra added without a flag stays in the acompte / solde, and the acompte is the direct one', () => {
  const lodgify = calculateReservationQuote({ ...STAY, db: lodgifyDb(), platform: 'Lodgify', selectedOptions: [{ optionId: 10, quantity: 1 }] });
  const direct = calculateReservationQuote({ ...STAY, db: lodgifyDb(), platform: 'direct', selectedOptions: [{ optionId: 10, quantity: 1 }] });
  assert.equal(lodgify.optionLines[0].inComplement, 0);
  for (const key of ['finalPrice', 'depositAmount', 'touristTaxTotal']) {
    assert.equal(lodgify[key], direct[key], key);
  }
  assert.equal(lodgify.touristTaxCollectedOnArrival, true, 'the tax follows the platform\'s own mode (owner: on arrival)');
  assert.equal(lodgify.platformSale, false);
  assert.equal(lodgify.platformTakesDeposit, false);
});

test('a brut entered on the site engine is read like a direct sale: the extras stay inside it', () => {
  const q = calculateReservationQuote({
    ...STAY, db: lodgifyDb({ collects: 1, remits: 0 }), platform: 'Lodgify',
    selectedOptions: [{ optionId: 10, quantity: 1 }], platformGrossAmount: 684.8, platformCommissionAmount: 6.85,
  });
  assert.equal(q.totalStayPrice, 684.8, 'nothing added on top of the brut');
  assert.equal(q.complementAmount, 0);
  assert.equal(q.platformCommissionAmount, 6.85, 'a commission can still be booked on the channel');
  assert.equal(q.sejourNetTotal, 677.95);
});

test('a paid single payment with a platform amount follows the amount, no arrival complement', () => {
  const q = calculateReservationQuote({
    ...STAY, db: lodgifyDb({ collects: 1, remits: 1 }), platform: 'Lodgify',
    platformGrossAmount: 700, balancePaid: 1, balanceAmount: 600, depositAmount: 0,
  });
  assert.deepEqual([q.depositAmount, q.balanceAmount, q.complementAmount], [0, 700, 0]);
  assert.equal(q.sejourNetTotal, 700);
});

test('Booking keeps the platform rules', () => {
  const q = calculateReservationQuote({ ...STAY, db: lodgifyDb(), platform: 'Booking', selectedOptions: [{ optionId: 10, quantity: 1 }] });
  assert.equal(q.optionLines[0].inComplement, 1);
  assert.equal(q.depositAmount, 0);
  assert.equal(q.touristTaxCollectedOnArrival, true);
  assert.equal(q.platformSale, true);
});

test('the ledger shows the acompte of a counts-as-direct stay instead of « encaisse en une fois »', () => {
  const quote = calculateReservationQuote({ ...STAY, db: lodgifyDb(), platform: 'Lodgify' });
  const row = { id: 9, kind: 'reservation', platform: 'Lodgify', startDate: '2026-05-01', finalPrice: quote.finalPrice, depositAmount: quote.depositAmount, balanceAmount: quote.balanceAmount };
  const ledger = buildLedger({ row, quote, today: '2026-01-15' });
  const deposit = ledger.rows.find((r) => r.key === 'deposit');
  assert.notEqual(deposit.state, 'na');
  assert.equal(deposit.amount, quote.depositAmount);
});
