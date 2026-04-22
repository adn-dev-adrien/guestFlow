const assert = require('assert');

// Test des données réelles fournies
test('calculateFlexiblePrice applies the correct ratio for rates under 1250€', () => {
  // Très basse saison (1008€)
  assert.equal(calculateFlexiblePrice(1008, 10), 1527);
  assert.equal(calculateFlexiblePrice(1008, 15), 2394);

  // Basse saison (1213€)
  assert.equal(calculateFlexiblePrice(1213, 10), 1732);
  assert.equal(calculateFlexiblePrice(1213, 15), 2599);
});

test('calculateFlexiblePrice applies the correct ratio for Mid-range (1306€)', () => {
  assert.equal(calculateFlexiblePrice(1306, 8), 1493);
  assert.equal(calculateFlexiblePrice(1306, 10), 1867);
  assert.equal(calculateFlexiblePrice(1306, 15), 2799);
});

test('calculateFlexiblePrice applies the correct ratio for High rates (> 1400€)', () => {
  // Haute saison (1525€)
  assert.equal(calculateFlexiblePrice(1525, 10), 2293);
  assert.equal(calculateFlexiblePrice(1525, 15), 3572);

  // Très haute saison (1791€)
  assert.equal(calculateFlexiblePrice(1791, 10), 2559);
  assert.equal(calculateFlexiblePrice(1791, 15), 3838);
});

// Test des seuils critiques
test('calculateFlexiblePrice threshold logic at 1250€ and 1400€', () => {
  // À 1250€ (Mid ratio 0.143184) -> 1250 + (3 * 178.98) = 1786.94 -> 1787
  assert.equal(calculateFlexiblePrice(1250, 10), 1787);
  
  // À 1400€ (Mid ratio 0.143184) -> 1400 + (3 * 200.45) = 2001.37 -> 2001
  assert.equal(calculateFlexiblePrice(1400, 10), 2001);
});