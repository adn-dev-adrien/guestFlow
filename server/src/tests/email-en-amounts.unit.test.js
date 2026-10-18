// specs/email-language-fr-en.md rule 8 — an English email writes every amount « €963.39 », like the
// prices of its stay texts; French keeps « 963,39 € ».

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContext } = require('../utils/emailContextBuilder');

const input = (lang) => ({
  reservation: {
    startDate: '2026-07-10', endDate: '2026-07-13', checkInTime: '15:00', checkOutTime: '10:00',
    adults: 2, teens: 0, children: 0, babies: 0, singleBeds: 0, doubleBeds: 1, babyBeds: 0,
    finalPrice: 963.39, depositAmount: 300, balanceAmount: 663.39, cautionAmount: 400, depositPaid: 0,
  },
  client: { firstName: 'Jane', lastName: 'Doe', email: 'jane@doe.uk' },
  property: { name: 'Gite', defaultCheckIn: '15:00', defaultCheckOut: '10:00', defaultCautionAmount: 400 },
  options: [],
  resources: [],
  settings: {},
  lang,
});

test('rule 8: English amounts read €963.39, French ones 963,39 €', () => {
  const en = buildContext(input('en')).vars;
  assert.equal(en.finalPrice, '€963.39');
  assert.equal(en.depositAmount, '€300.00');
  assert.equal(en.balanceAmount, '€663.39');
  assert.equal(en.cautionAmount, '€400.00');
  const fr = buildContext(input('fr')).vars;
  assert.equal(fr.finalPrice, '963,39 €');
  assert.equal(fr.cautionAmount, '400,00 €');
});
