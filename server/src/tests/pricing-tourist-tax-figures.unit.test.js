// specs/pricing-components.md §3 rules 3, 64 and 66 (commit « tourist tax through TOURIST TAX »): the person × night arithmetic of
// the tax lives in TOURIST TAX (`personNights`, `unitFromTotal`), and the report of the tax a platform remits itself reads its two
// figures from the TOURIST TAX slice of the pipeline, not from a replay of the whole quote. Proof on every stay of the
// price-gate fixture: the slice answers what the full quote answers, to the bit.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { personNights, unitFromTotal } = require('../utils/pricing/touristTax');

test('rule 3: the person-nights of a party and the unit a tax total comes from are the plain products', () => {
  assert.equal(personNights(3, 4), 12);
  assert.equal(personNights(0, 4), 0);
  assert.equal(unitFromTotal(36, 4, 3), 3);
  assert.equal(unitFromTotal(10, 3, 2), 10 / (3 * 2));
  assert.equal(unitFromTotal(10, 2, 3), unitFromTotal(10, 3, 2));
});

const DIR = process.env.PRICE_GATE_FIXTURE_DIR || path.join(__dirname, 'fixtures', 'price-gate');
const captured = fs.existsSync(path.join(DIR, 'inputs.json'));

test('rule 64: the TOURIST TAX slice gives the tax figures the full quote gives, on every stay of the price-gate fixture', { skip: captured ? false : 'price-gate fixture absent' }, () => {
  const inputs = JSON.parse(fs.readFileSync(path.join(DIR, 'inputs.json'), 'utf8'));
  const { freezeClock } = require('./vatRegimeGoldenFixture');
  freezeClock(new Date(inputs.meta.capturedAt));
  const db = require('../database');
  const { loadInputs } = require('../../../scripts/price-gate/recompute');
  loadInputs(db, inputs);
  const { quoteStoredReservation, touristTaxFigureOfStoredReservation } = require('../utils/storedReservationQuote');

  let checked = 0;
  for (const stay of db.prepare("SELECT * FROM reservations WHERE kind IN ('reservation', 'cancelled')").all()) {
    const quote = quoteStoredReservation(db, stay) || {};
    const figure = touristTaxFigureOfStoredReservation(db, stay) || {};
    assert.equal(figure.touristTaxOriginalTotal, quote.touristTaxOriginalTotal, `stay ${stay.id} estimate`);
    assert.equal(figure.platformTouristTaxWithheld, quote.platformTouristTaxWithheld, `stay ${stay.id} withheld`);
    checked += 1;
  }
  assert.ok(checked > 50, `${checked} stays compared`);
});
