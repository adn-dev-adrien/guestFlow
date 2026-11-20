// specs/pricing-components.md §3 rules 10, 17 — the default options an iCal import materialises are priced by the engine, whose extras are the Articles head's:
// the model holds no multiplier of its own (the `families` guard) and reads only the priced line. The amounts the import writes are pinned by
// `import-price-default-options`; PLATFORM PRICE's `platformLinesTotal` is the one sum of the lines inside the platform price.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { platformLinesTotal, isPlatformLine, resolvePlatformPrice } = require('../utils/pricing/platformPrice');

const source = fs.readFileSync(path.join(__dirname, '..', 'models', 'propertyIcalModel.js'), 'utf8');

test('rule 10 — the iCal import prices its default options through the engine, with no arithmetic of its own', () => {
  assert.match(source, /calculateReservationQuote\(\{/);
  assert.doesNotMatch(source, /getTypeMultiplier|unitsPerQuantity|persons\s*\*\s*nights/);
  assert.match(source, /Number\(line\.totalPrice \|\| 0\)/, 'the amount written is the priced line\'s');
});

test('rule 17 — a line is inside the platform price by its declared moment, else by the routing flag the intakes derive it from', () => {
  assert.equal(isPlatformLine({ collectAt: 'platform', inComplement: 1 }), true, 'the declaration wins');
  assert.equal(isPlatformLine({ collectAt: 'arrival', inComplement: 0 }), false, 'a sale made after the booking is never a platform line');
  assert.equal(isPlatformLine({ collectAt: 'departure' }), false);
  assert.equal(isPlatformLine({ inComplement: 0 }), true);
  assert.equal(isPlatformLine({ inComplement: 1 }), false);
});

test('rule 17 — the total of the platform lines is rounded like the pin: the check and the engine agree to the cent', () => {
  const lines = [{ totalPrice: 10.005, inComplement: 0 }, { totalPrice: 20.004, inComplement: 0 }, { totalPrice: 99, inComplement: 1 }];
  assert.equal(platformLinesTotal(lines), 30.01);
  const pin = resolvePlatformPrice({ gross: 100, platformLines: lines.filter(isPlatformLine).map((l) => l.totalPrice) });
  assert.equal(pin.accommodation, Math.round((100 - platformLinesTotal(lines)) * 100) / 100);
  assert.equal(platformLinesTotal(null), 0);
});
