// Context builder: shapes reservation/client/property/options/settings into a flat
// { vars, flags } object the renderer consumes. See specs/email-automation.md §3 rule 3 + §4.4.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContext, __test } = require('../utils/emailContextBuilder');

const SAMPLE_SETTINGS = { companyName: 'GuestFlow Demo', companyPhone: '+33102030405', companyEmail: 'demo@gf.test' };

function baseInput(over = {}) {
  return {
    reservation: {
      startDate: '2026-07-10', endDate: '2026-07-13',
      checkInTime: '15:00', checkOutTime: '10:00',
      adults: 2, teens: 0, children: 1, babies: 0,
      singleBeds: 1, doubleBeds: 1, babyBeds: 0,
      finalPrice: 380, depositAmount: 100, depositDueDate: '2026-05-15',
      balanceAmount: 280, balanceDueDate: '2026-07-01',
      cautionAmount: 500, depositPaid: 0,
      ...(over.reservation || {}),
    },
    client: {
      firstName: 'Jean', lastName: 'Dupont', email: 'jean@dupont.fr', phone: '0612',
      streetNumber: '12', street: 'rue des Fleurs', postalCode: '75001', city: 'Paris',
      ...(over.client || {}),
    },
    property: { name: 'Villa A', defaultCheckIn: '15:00', defaultCheckOut: '10:00', ...(over.property || {}) },
    options: over.options || [],
    settings: { ...SAMPLE_SETTINGS, ...(over.settings || {}) },
  };
}

test('vars expose the canonical client + reservation + property + financial tokens', () => {
  const { vars } = buildContext(baseInput());
  assert.equal(vars.clientFirstName, 'Jean');
  assert.equal(vars.clientLastName, 'Dupont');
  assert.equal(vars.clientFullName, 'Jean Dupont');
  assert.equal(vars.clientEmail, 'jean@dupont.fr');
  assert.equal(vars.clientPhone, '0612');
  assert.equal(vars.clientAddress, '12 rue des Fleurs, 75001 Paris');
  assert.equal(vars.startDate, '10 juillet 2026');
  assert.equal(vars.endDate, '13 juillet 2026');
  assert.equal(vars.checkInTime, '15:00');
  assert.equal(vars.checkOutTime, '10:00');
  assert.equal(vars.nights, '3');
  assert.equal(vars.adultsCount, '2');
  assert.equal(vars.childrenCount, '1');
  assert.equal(vars.totalGuests, '3');
  assert.equal(vars.propertyName, 'Villa A');
  assert.equal(vars.finalPrice, '380,00 €');
  assert.equal(vars.cautionAmount, '500,00 €');
  assert.equal(vars.companyName, 'GuestFlow Demo');
});

test('reservation checkInTime falls back to property.defaultCheckIn when blank', () => {
  const { vars } = buildContext(baseInput({ reservation: { checkInTime: '', checkOutTime: '' } }));
  assert.equal(vars.checkInTime, '15:00');
  assert.equal(vars.checkOutTime, '10:00');
});

test('formatBedConfig: pluralization + zero counts dropped', () => {
  const { formatBedConfig } = __test;
  assert.equal(formatBedConfig({ singleBeds: 1, doubleBeds: 1, babyBeds: 0 }), '1 lit double, 1 lit simple');
  assert.equal(formatBedConfig({ singleBeds: 2, doubleBeds: 0, babyBeds: 0 }), '2 lits simples');
  assert.equal(formatBedConfig({ singleBeds: 0, doubleBeds: 2, babyBeds: 1 }), '2 lits doubles, 1 lit bébé');
  assert.equal(formatBedConfig({ singleBeds: 0, doubleBeds: 0, babyBeds: 0 }), '');
});

test('bedConfig var follows the reservation columns', () => {
  const { vars } = buildContext(baseInput({ reservation: { singleBeds: 2, doubleBeds: 1, babyBeds: 1 } }));
  assert.equal(vars.bedConfig, '1 lit double, 2 lits simples, 1 lit bébé');
});

test('optionsList: empty when no options, sorted alphabetically when several', () => {
  const empty = buildContext(baseInput({ options: [] }));
  assert.equal(empty.vars.optionsList, '');

  const several = buildContext(baseInput({
    options: [
      { title: 'Ménage', autoOptionType: null },
      { title: 'Linge de lit', autoOptionType: 'bed_linen' },
      { title: 'Petit-déjeuner', autoOptionType: 'breakfast' },
    ],
  }));
  assert.equal(several.vars.optionsList, 'Linge de lit, Ménage, Petit-déjeuner');
  // sortedAlphabetically: `localeCompare('fr')` handles diacritics — Ménage between L and P.
});

test('flag hasBedLinenOption is true iff an option carries autoOptionType=bed_linen', () => {
  const yes = buildContext(baseInput({
    options: [{ title: 'Linge de lit', autoOptionType: 'bed_linen' }],
  }));
  assert.equal(yes.flags.hasBedLinenOption, true);

  const no = buildContext(baseInput({
    options: [{ title: 'Petit-déjeuner', autoOptionType: 'breakfast' }],
  }));
  assert.equal(no.flags.hasBedLinenOption, false);
});

test('flag cautionNotBanked: depends on cautionAmount > 0 AND depositPaid != 1', () => {
  const notPaid = buildContext(baseInput({ reservation: { cautionAmount: 500, depositPaid: 0 } }));
  assert.equal(notPaid.flags.cautionNotBanked, true);

  const paid = buildContext(baseInput({ reservation: { cautionAmount: 500, depositPaid: 1 } }));
  assert.equal(paid.flags.cautionNotBanked, false);

  const noCaution = buildContext(baseInput({ reservation: { cautionAmount: 0, depositPaid: 0 } }));
  assert.equal(noCaution.flags.cautionNotBanked, false);
});

test('flag hasOptions reflects the options array', () => {
  assert.equal(buildContext(baseInput({ options: [] })).flags.hasOptions, false);
  assert.equal(buildContext(baseInput({ options: [{ title: 'X' }] })).flags.hasOptions, true);
});

test('missing client → vars stay empty strings (no crash, no undefined leaks)', () => {
  const { vars } = buildContext({ reservation: baseInput().reservation, client: null, property: null });
  assert.equal(vars.clientFirstName, '');
  assert.equal(vars.clientFullName, '');
  assert.equal(vars.clientAddress, '');
  assert.equal(vars.propertyName, '');
});

test('nights computation matches diffDays', () => {
  const { vars } = buildContext(baseInput({ reservation: { startDate: '2026-07-10', endDate: '2026-07-14' } }));
  assert.equal(vars.nights, '4');
});
