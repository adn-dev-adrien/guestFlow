// specs/plugins-phase-p-productisation.md rule 45 (review of PR #803) — the tourist-tax mode is the
// platform's own setting: on a channel counted as direct in mode « owner » the engine collects the tax
// on arrival, exactly as the accounting export and the arrival SAS recap read it (any named channel
// whose platform does not charge the guest).
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateReservationQuote, isPlatformCollectingTouristTax } = require('../utils/pricing');
const { setDirectChannels } = require('../utils/platformNameFormat');
const { isNamedChannel } = require('../utils/saleChannel');
const { pricingAuditDb, STAY } = require('./pricingAuditFixture');

test.beforeEach(() => setDirectChannels(['lodgify']));
test.after(() => setDirectChannels([]));

// The readers' rule (accountingModel `collectedOnArrival`, reservationsModel `touristTaxInComplementAmount`).
const readersSayOnArrival = (db, platform, tax) => isNamedChannel(platform) && tax > 0
  && !isPlatformCollectingTouristTax(db, 1, platform);

for (const [mode, label] of [[{ collects: 0, remits: 0 }, 'owner'], [{ collects: 1, remits: 0 }, 'platform reverses'], [{ collects: 1, remits: 1 }, 'platform handles']]) {
  test(`Lodgify counted as direct, mode ${label}: engine, export and SAS agree`, () => {
    const db = pricingAuditDb({ touristTax: 1, platforms: [{ name: 'Lodgify', countsAsDirect: 1, ...mode }] });
    const q = calculateReservationQuote({ ...STAY, db, platform: 'Lodgify' });
    assert.equal(q.touristTaxCollectedOnArrival, readersSayOnArrival(db, 'Lodgify', q.touristTaxTotal));
    if (label === 'owner') {
      assert.equal(q.touristTaxCollectedOnArrival, true);
      assert.equal(q.complementAmount, q.touristTaxTotal, 'the tax is in the arrival complement, as the SAS lists it');
    }
  });
}
