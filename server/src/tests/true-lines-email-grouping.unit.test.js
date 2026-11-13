// specs/pricing-components.md §3 rules 13 and 85 — the lines of one article read as ONE entry in a guest e-mail: one title in the option and
// resource lists, one itemised complement line (« 3 × 6,50 € », or « 1 × 6,50 € + 2 × 7 € » when the lines were sold at different prices).
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContext } = require('../utils/emailContextBuilder');

const input = (over = {}) => ({
  reservation: { startDate: '2026-07-10', endDate: '2026-07-13', checkInTime: '15:00', checkOutTime: '10:00', adults: 2, teens: 0, children: 0, babies: 0, ...(over.reservation || {}) },
  client: { firstName: 'Jean', lastName: 'Dupont', email: 'jean@dupont.fr' },
  property: { name: 'Villa A', defaultCheckIn: '15:00', defaultCheckOut: '10:00' },
  options: over.options || [],
  resources: over.resources || [],
  customOptions: [],
  settings: { companyName: 'GuestFlow Demo' },
  ...(over.arrivalComplementDetail ? { arrivalComplementDetail: over.arrivalComplementDetail } : {}),
});

test('rule 13 — an article sold on two lines is named once in the option and resource lists', () => {
  const { vars } = buildContext(input({
    options: [{ title: 'Bière locale', optionId: 1, quantity: 1 }, { title: 'Bière locale', optionId: 1, quantity: 2 }, { title: 'Panier vin', optionId: 2, quantity: 1 }],
    resources: [{ name: 'Sauna', resourceId: 3, quantity: 1 }, { name: 'Sauna', resourceId: 3, quantity: 1 }],
  }));
  assert.equal(vars.optionsList, 'Bière locale, Panier vin');
  assert.equal(vars.reservedOptionsList, 'Bière locale, Panier vin');
  assert.equal(vars.resourcesList, 'Sauna');
});

test('rule 13 — the complement notice groups the lines of an article: same price « 3 × 6,50 € », different prices « 1 × 6,50 € + 2 × 7 € »', () => {
  const same = buildContext(input({
    reservation: { complementAmount: 19.5, complementPaid: 0 },
    arrivalComplementDetail: { amount: 19.5, paid: 0, detail: [
      { kind: 'option', label: 'Bière locale', qty: 1, unitPrice: 6.5, amount: 6.5 },
      { kind: 'option', label: 'Bière locale', qty: 2, unitPrice: 6.5, amount: 13 },
    ] },
  })).vars.complementNotice;
  assert.match(same, /- Bière locale : 3 × 6,50 € = 19,50 €/);
  assert.equal((same.match(/Bière locale/g) || []).length, 1);
  const different = buildContext(input({
    reservation: { complementAmount: 20.5, complementPaid: 0 },
    arrivalComplementDetail: { amount: 20.5, paid: 0, detail: [
      { kind: 'option', label: 'Bière locale', qty: 1, unitPrice: 6.5, amount: 6.5 },
      { kind: 'option', label: 'Bière locale', qty: 2, unitPrice: 7, amount: 14 },
    ] },
  })).vars.complementNotice;
  assert.match(different, /- Bière locale : 1 × 6,50 € \+ 2 × 7 € = 20,50 €/);
});

test('rule 13 — an article on one line reads exactly as before', () => {
  const { vars } = buildContext(input({
    reservation: { complementAmount: 13, complementPaid: 0 },
    arrivalComplementDetail: { amount: 13, paid: 0, detail: [{ kind: 'option', label: 'Bière locale', qty: 2, unitPrice: 6.5, amount: 13 }] },
  }));
  assert.match(vars.complementNotice, /- Bière locale : 2 × 6,50 € = 13 €/);
});
