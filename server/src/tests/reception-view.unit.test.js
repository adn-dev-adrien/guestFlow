const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toReceptionReservationView,
  toReceptionReservationList,
  toReceptionPropertyView,
  toReceptionPaymentPatch,
} = require('../utils/receptionView');

// specs/reception-role-checkin-only.md §3.2 — the money guard. Door money (caution / complement) is
// kept; total / deposit / balance / remaining / commission / tourist-tax / contribs and client PII
// are dropped. Whitelist, so a new financial field can never leak.

const FULL_RESERVATION = {
  id: 7,
  reservationNumber: 'R-2026-007',
  kind: 'reservation',
  clientId: 3,
  firstName: 'Marie',
  lastName: 'Durand',
  email: 'marie@example.com',
  phone: '+33600000000',
  propertyId: 2,
  propertyName: 'Gîte du Lac',
  propertyPhoto: '/uploads/lac.jpg',
  platform: 'Airbnb',
  startDate: '2026-08-01',
  endDate: '2026-08-08',
  checkInTime: '16:00',
  checkOutTime: '10:00',
  adults: 2,
  children: 1,
  teens: 0,
  babies: 0,
  babyBeds: 1,
  doubleBeds: 2,
  singleBeds: 1,
  notes: 'Late arrival',
  bedLinenAlert: 'no-linen',
  // Door money — kept.
  cautionAmount: 300,
  cautionReceived: 0,
  cautionReturned: 0,
  complementAmount: 45,
  complementPaid: 0,
  endOfStayComplementAmount: 0,
  endOfStayComplementPaid: 0,
  // Status flags — kept.
  checkInReady: 1,
  checkInDone: 0,
  checkOutDone: 0,
  arrivalSasDoneAt: null,
  departureSasDoneAt: null,
  // Finance — MUST be dropped.
  totalPrice: 980,
  customPrice: 980,
  clientGrossAmount: 1000,
  commissionAmount: 20,
  depositAmount: 294,
  depositAmountOverride: '',
  depositPaid: 1,
  depositPaidDate: '2026-06-01',
  balanceAmount: 686,
  balancePaid: 0,
  remainingDue: 686,
  paymentComplete: false,
  discountPercent: 0,
  touristTaxAmount: 12,
  platformCommissionAmount: 20,
  options: [
    { id: 1, optionId: 5, title: 'Ménage', quantity: 1, autoOptionType: 'cleaning', totalPrice: 60, unitPrice: 60, originalTotalPrice: 60, acompteContribTtc: 10 },
  ],
  resources: [
    { id: 9, resourceId: 4, name: 'Kayak', quantity: 2, totalPrice: 40, unitPrice: 20 },
  ],
};

const KEPT_KEYS = [
  'id', 'reservationNumber', 'kind', 'clientId', 'firstName', 'lastName', 'propertyId',
  'propertyName', 'propertyPhoto', 'platform', 'startDate', 'endDate', 'checkInTime',
  'checkOutTime', 'adults', 'children', 'teens', 'babies', 'babyBeds', 'doubleBeds', 'singleBeds',
  'notes', 'bedLinenAlert',
  'cautionAmount', 'cautionReceived', 'cautionReturned', 'complementAmount', 'complementPaid',
  'endOfStayComplementAmount', 'endOfStayComplementPaid', 'checkInReady', 'checkInDone',
  'checkOutDone', 'arrivalSasDoneAt', 'departureSasDoneAt',
];

const DROPPED_KEYS = [
  'email', 'phone', 'totalPrice', 'customPrice', 'clientGrossAmount', 'commissionAmount',
  'depositAmount', 'depositAmountOverride', 'depositPaid', 'depositPaidDate', 'balanceAmount',
  'balancePaid', 'remainingDue', 'paymentComplete', 'discountPercent', 'touristTaxAmount',
  'platformCommissionAmount',
];

test('toReceptionReservationView keeps every operational + door-money field', () => {
  const view = toReceptionReservationView(FULL_RESERVATION);
  for (const key of KEPT_KEYS) {
    assert.ok(key in view, `expected "${key}" to survive`);
    assert.deepEqual(view[key], FULL_RESERVATION[key], key);
  }
});

test('toReceptionReservationView drops every finance + PII field', () => {
  const view = toReceptionReservationView(FULL_RESERVATION);
  for (const key of DROPPED_KEYS) {
    assert.ok(!(key in view), `expected "${key}" to be stripped, got ${JSON.stringify(view[key])}`);
  }
});

test('toReceptionReservationView strips prices off option / resource lines', () => {
  const view = toReceptionReservationView(FULL_RESERVATION);
  assert.deepEqual(view.options, [
    { id: 1, optionId: 5, customOptionId: undefined, title: 'Ménage', quantity: 1, autoOptionType: 'cleaning', isCustom: undefined },
  ]);
  assert.deepEqual(view.resources, [{ id: 9, resourceId: 4, name: 'Kayak', quantity: 2 }]);
  // No price key survives on any line.
  for (const line of [...view.options, ...view.resources]) {
    for (const priceKey of ['totalPrice', 'unitPrice', 'originalTotalPrice', 'amount', 'acompteContribTtc']) {
      assert.ok(!(priceKey in line), `${priceKey} leaked on a line`);
    }
  }
});

test('toReceptionReservationView is null-safe and list maps', () => {
  assert.equal(toReceptionReservationView(null), null);
  const list = toReceptionReservationList([FULL_RESERVATION, FULL_RESERVATION]);
  assert.equal(list.length, 2);
  assert.ok(!('totalPrice' in list[0]));
});

test('toReceptionPaymentPatch keeps only the 3 status flags, drops finance fields', () => {
  const patch = toReceptionPaymentPatch({
    checkInReady: true, checkInDone: false, checkOutDone: true,
    depositPaid: true, balancePaid: true, complementPaid: true, complementPaidCash: true,
    cautionReceived: true, cautionReturned: true, depositAmount: 300, cautionAmount: 500,
  });
  assert.deepEqual(patch, { checkInReady: true, checkInDone: false, checkOutDone: true });
});

test('toReceptionPaymentPatch is null-safe', () => {
  assert.deepEqual(toReceptionPaymentPatch(null), { checkInReady: undefined, checkInDone: undefined, checkOutDone: undefined });
});

test('toReceptionPropertyView keeps display fields, drops pricing', () => {
  const view = toReceptionPropertyView({
    id: 2, name: 'Gîte du Lac', photo: '/uploads/lac.jpg', color: '#123456', sortOrder: 1, isActive: 1,
    basePrice: 120, defaultCautionAmount: 300, cleaningPrice: 60, priceProgressiveTiers: '[]',
  });
  assert.deepEqual(view, { id: 2, name: 'Gîte du Lac', photo: '/uploads/lac.jpg', color: '#123456', sortOrder: 1, isActive: 1 });
  for (const key of ['basePrice', 'defaultCautionAmount', 'cleaningPrice', 'priceProgressiveTiers']) {
    assert.ok(!(key in view), `${key} leaked`);
  }
});
