const test = require('node:test');
const assert = require('node:assert/strict');

const { isClientVisibleOption } = require('../utils/optionVisibility');
const { buildContext } = require('../utils/emailContextBuilder');

// specs/laundry-bath-mat.md §3 rule 11 — the generic client-visibility flag hides "internal-only"
// options (displayToClient = 0) from every client-facing surface.

test('isClientVisibleOption: default visible, only explicit 0 hides', () => {
  assert.equal(isClientVisibleOption({}), true, 'absent flag → visible (back-compat)');
  assert.equal(isClientVisibleOption({ displayToClient: 1 }), true);
  assert.equal(isClientVisibleOption({ displayToClient: null }), true);
  assert.equal(isClientVisibleOption({ displayToClient: 0 }), false);
  assert.equal(isClientVisibleOption(null), false);
});

test('email context: internal-only options are dropped from the options lists', () => {
  const reservation = { startDate: '2026-07-01', endDate: '2026-07-04', adults: 2 };
  const client = { firstName: 'A', lastName: 'B' };
  const property = {};
  const options = [
    { title: 'Ménage', displayToClient: 1 },
    { title: 'Tapis de bain', displayToClient: 0 }, // internal — must not appear
    { title: 'Petit déjeuner' }, // no flag → visible
  ];
  const ctx = buildContext({ reservation, client, property, options });
  const vars = ctx.vars || ctx; // tolerate either {vars} or flat shape
  const optionsList = vars.optionsList != null ? vars.optionsList : ctx.optionsList;
  assert.ok(!/Tapis de bain/.test(optionsList), 'internal bath mat hidden from optionsList');
  assert.ok(/Ménage/.test(optionsList) && /Petit déjeuner/.test(optionsList), 'visible options still listed');
});
