// specs/tariff-recipes/spec.md §3 rule 56 (audit 2026-10-27) — an option with free units (welcome
// pack) keeps its value over every save: its stored total is net of the free units, so the replay
// must not read « total ÷ units » as its unit price.
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote } = require('../utils/pricing');
const { pricingAuditDb, STAY, storedOptionLine } = require('./pricingAuditFixture');

function replay(db, args, optionId, saves) {
  let quote = calculateReservationQuote({ ...STAY, db, platform: 'direct', ...args });
  const totals = [quote.optionLines.find((l) => l.optionId === optionId).totalPrice];
  for (let i = 0; i < saves; i += 1) {
    const line = quote.optionLines.find((l) => l.optionId === optionId);
    quote = calculateReservationQuote({
      ...STAY, db, platform: 'direct', ...args,
      lockedOptionLines: [storedOptionLine(line)], lockedTariff: quote.tariffSnapshot,
    });
    totals.push(quote.optionLines.find((l) => l.optionId === optionId).totalPrice);
  }
  return { quote, totals };
}

test('« Jus 6 € × 3, 1 offert » stays 12 € over three saves (was 12 → 8 → 5,34 → 3,56)', () => {
  const db = pricingAuditDb({ included: 10 });
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (12, 'Jus de pomme 1L', 'per_stay', 6)").run();
  db.prepare('INSERT INTO property_options VALUES (1, 12)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 12, 6, 1)').run();
  const { quote, totals } = replay(db, { selectedOptions: [{ optionId: 12, quantity: 3 }] }, 12, 3);
  assert.deepEqual(totals, [12, 12, 12, 12]);
  const line = quote.optionLines.find((l) => l.optionId === 12);
  assert.deepEqual([line.unitPrice, line.billedUnits, line.freeUnits], [6, 3, 1]);
});

test('per person per night, 8 € with 2 free: 32 € stays 32 € (was 21,32 on the first save)', () => {
  const db = pricingAuditDb({ included: 10 });
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 11, 8, 2)').run();
  const args = { startDate: '2026-05-10', endDate: '2026-05-13', selectedOptions: [{ optionId: 11, quantity: 1 }] };
  const { totals } = replay(db, args, 11, 3);
  assert.deepEqual(totals, [32, 32, 32, 32]);
});

test('one more unit on a sold line is priced once, the free unit deducted once', () => {
  const db = pricingAuditDb({ included: 10 });
  db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (12, 'Jus de pomme 1L', 'per_stay', 6)").run();
  db.prepare('INSERT INTO property_options VALUES (1, 12)').run();
  db.prepare('INSERT INTO property_option_prices (propertyId, optionId, price, freeUnits) VALUES (1, 12, 6, 1)').run();
  const sold = calculateReservationQuote({ ...STAY, db, platform: 'direct', selectedOptions: [{ optionId: 12, quantity: 3 }] });
  const more = calculateReservationQuote({
    ...STAY, db, platform: 'direct', selectedOptions: [{ optionId: 12, quantity: 4 }],
    lockedOptionLines: [storedOptionLine(sold.optionLines.find((l) => l.optionId === 12))], lockedTariff: sold.tariffSnapshot,
  });
  assert.equal(more.optionLines.find((l) => l.optionId === 12).totalPrice, 18);
});
