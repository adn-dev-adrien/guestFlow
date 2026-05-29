const test = require('node:test');
const assert = require('node:assert/strict');

const { generateDevisPdf } = require('../utils/devisPdf');

function sampleDevis() {
  return {
    devisNumber: '2026-05-001', status: 'draft',
    startDate: '2099-06-01', endDate: '2099-06-03', checkInTime: '15:00', checkOutTime: '10:00',
    adults: 2, children: 1, teens: 0, babies: 0, platform: 'direct',
    totalPrice: 200, customPrice: null, discountPercent: 0, finalPrice: 305,
    touristTaxRate: 1, touristTaxTotal: 6,
    depositAmount: 93, depositDueDate: '2099-05-02', balanceAmount: 218, balanceDueDate: '2099-05-25',
    cautionAmount: 500, notes: 'Merci',
    property: {
      id: 1, name: 'Villa A', checkInTime: '15:00', checkOutTime: '10:00',
      depositPercent: 30, depositDaysBefore: 30, balanceDaysBefore: 7,
    },
    client: { id: 1, firstName: 'Jean', lastName: 'Dupont', phone: '0612345678', address: '12 Rue X', email: 'a@b.fr', city: 'Paris', postalCode: '75001' },
    options: [
      { optionId: 1, title: 'Ménage', priceType: 'per_stay', quantity: 1, billedUnits: 1, unitPrice: 80, totalPrice: 80, originalTotalPrice: 80, offered: 0, isCustom: 0 },
      { optionId: 2, title: 'Petit-déjeuner', priceType: 'per_person', quantity: 2, billedUnits: 2, unitPrice: 10, totalPrice: 0, originalTotalPrice: 20, offered: 1, isCustom: 0 },
      { customOptionId: 1, title: 'Extra', description: 'Extra', priceType: 'per_stay', quantity: 1, billedUnits: 1, unitPrice: 25, totalPrice: 25, originalTotalPrice: 25, offered: 0, isCustom: 1 },
    ],
    resources: [
      { resourceId: 1, name: 'Spa', priceType: 'per_hour', quantity: 1, billedUnits: 1, unitPrice: 30, totalPrice: 30, originalTotalPrice: 30, offered: 0 },
    ],
    nights: [
      { date: '2099-06-01', seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 },
      { date: '2099-06-02', seasonLabel: 'Standard', pricingMode: 'fixed', price: 100 },
    ],
  };
}

const settings = {
  companyName: 'My Co', companyEmail: 'co@x.fr', companyPhone: '0102030405', companyAddress: '1 Rue Co',
  companyIban: 'FR7612345678901234567890123', companyBic: 'ABCDEFGH', companyBankName: 'Banque', quoteValidityDays: 30,
  vatRateAccommodation: 10, vatRateStandard: 20,
};

test('generateDevisPdf returns a non-empty PDF buffer (offered/custom/per-hour branches do not throw)', async () => {
  const buf = await generateDevisPdf(sampleDevis(), settings);
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length > 500);
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('generateDevisPdf works with a manual price and no bank details', async () => {
  const devis = sampleDevis();
  devis.customPrice = 180; // manual accommodation price
  const buf = await generateDevisPdf(devis, { companyName: 'My Co' });
  assert.ok(Buffer.isBuffer(buf) && buf.length > 500);
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});
