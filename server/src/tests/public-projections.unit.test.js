const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toPublicProperty, toPublicPropertyDetail, toPublicOption, toPublicResource,
  toPublicAvailability, toPublicQuote, collapseToRanges,
} = require('../utils/publicProjections');

// A property row as the DB returns it, padded with fields that must NEVER leak.
const PROPERTY_ROW = {
  id: 1, name: 'Le Nid', nameArticle: 'le',
  maxAdults: 4, maxChildren: 2, maxBabies: 1, singleBeds: 1, doubleBeds: 2,
  basePriceIncludedGuests: 2, extraGuestPrice: 25, defaultCheckIn: '15:00', defaultCheckOut: '10:00',
  // sensitive / internal — must be stripped:
  photo: '/uploads/properties/1/cover.jpg', depositPercent: 30, depositDaysBefore: 30,
  touristTaxPerDayPerPerson: 1.1, touristTaxMode: 'per_day_per_person',
};

test('toPublicProperty exposes only the whitelisted fields (no photo / tax / deposit)', () => {
  const p = toPublicProperty(PROPERTY_ROW);
  assert.deepEqual(Object.keys(p).sort(), [
    'basePriceIncludedGuests', 'defaultCheckIn', 'defaultCheckOut', 'doubleBeds',
    'id', 'maxAdults', 'maxBabies', 'maxChildren', 'name', 'nameArticle', 'singleBeds',
  ]);
  assert.equal('photo' in p, false);
  assert.equal('depositPercent' in p, false);
  assert.equal('touristTaxPerDayPerPerson' in p, false);
});

test('toPublicPropertyDetail computes fromPricePerNight and exposes no document/photo URLs', () => {
  const detail = toPublicPropertyDetail({
    ...PROPERTY_ROW,
    pricingRules: [{ pricePerNight: 180 }, { pricePerNight: 120 }, { pricePerNight: 0 }],
    documents: [{ url: '/uploads/properties/1/reglement.pdf' }],
  });
  assert.equal(detail.fromPricePerNight, 120);
  assert.equal(detail.extraGuestPrice, 25);
  assert.equal('documents' in detail, false);
  assert.equal('photo' in detail, false);
  assert.equal('pricingRules' in detail, false);
});

test('toPublicPropertyDetail yields null fromPricePerNight when no positive rule', () => {
  const detail = toPublicPropertyDetail({ ...PROPERTY_ROW, pricingRules: [] });
  assert.equal(detail.fromPricePerNight, null);
});

test('toPublicOption strips linen/towel internals; tiers only for progressive', () => {
  const o = toPublicOption({
    id: 7, title: 'Petit-déjeuner', titleEn: 'Breakfast', description: 'Servi 8h-10h',
    priceType: 'per_person_per_night', price: 12,
    countsAsBedLinen: 1, linenIncludesSingle: 1, towelLargePerPerson: 2, autoOptionType: null,
    optionProgressiveTiers: [{ participantNumber: 1, unitPrice: 10 }],
  });
  assert.deepEqual(Object.keys(o).sort(), ['description', 'id', 'price', 'priceType', 'priceUnitLabel', 'quantityLabel', 'showsPlanningCard', 'title', 'titleEn']);
  assert.equal(o.showsPlanningCard, false); // not set on this option
  // Backend-owned labels (source of truth) — non-planning per_person_per_night.
  assert.equal(o.priceUnitLabel, 'par personne et par nuit');
  assert.equal(o.quantityLabel, null);
  assert.equal('countsAsBedLinen' in o, false);
  assert.equal('towelLargePerPerson' in o, false);
  assert.equal('progressiveTiers' in o, false); // not a progressive priceType

  // Planning-card option: billed by séance on the site → séance-based labels from the backend.
  const planning = toPublicOption({ id: 6, title: 'Petit déjeuner', priceType: 'per_person_per_night', price: 8, showsPlanningCard: 1 });
  assert.equal(planning.priceUnitLabel, 'par personne et par séance');
  assert.equal(planning.quantityLabel, 'Nombre de séances');

  const perStay = toPublicOption({ id: 3, title: 'Ménage', priceType: 'per_stay', price: 80 });
  assert.equal(perStay.priceUnitLabel, 'au séjour');

  const prog = toPublicOption({
    id: 9, title: 'Lit suppl.', priceType: 'per_participant_progressive', price: 0,
    optionProgressiveTiers: [{ participantNumber: 1, unitPrice: 10 }],
  });
  assert.deepEqual(prog.progressiveTiers, [{ participantNumber: 1, unitPrice: 10 }]);
  assert.equal(prog.priceUnitLabel, 'par participant');

  const auto = toPublicOption({ id: 5, title: 'Arrivée anticipée', priceType: 'per_hour', price: 15, autoOptionType: 'early_check_in' });
  assert.equal(auto.autoOptionType, 'early_check_in');
});

test('collapseToRanges merges contiguous dates and splits gaps', () => {
  assert.deepEqual(
    collapseToRanges(['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-20']),
    [{ start: '2026-07-10', end: '2026-07-12' }, { start: '2026-07-20', end: '2026-07-20' }],
  );
});

test('toPublicAvailability dedupes, sorts, and adds ranges', () => {
  const a = toPublicAvailability({
    propertyId: 1, from: '2026-07-01', to: '2026-08-01',
    blockedDates: ['2026-07-12', '2026-07-10', '2026-07-11', '2026-07-10'],
  });
  assert.deepEqual(a.blockedDates, ['2026-07-10', '2026-07-11', '2026-07-12']);
  assert.deepEqual(a.blockedRanges, [{ start: '2026-07-10', end: '2026-07-12' }]);
});

test('toPublicResource keeps id/name/price/priceType; strips stock & slot internals', () => {
  const r = toPublicResource({
    id: 3, name: 'Bain nordique', note: 'Détente sous les étoiles', priceType: 'per_hour', price: 55,
    // internals that must NOT leak:
    quantity: 2, isComplex: 1, freeMinutes: 90, openDays: '[1,2,3]', slotDuration: 60, basePrice: 50,
  });
  assert.deepEqual(r, { id: 3, name: 'Bain nordique', description: 'Détente sous les étoiles', priceType: 'per_hour', price: 55 });
});

test('toPublicQuote maps engine output and leaks no VAT/accounting internals', () => {
  const engineQuote = {
    property: { id: 1 },
    nights: 7, persons: 3, requiredMinNights: 3, minNightsBreached: false,
    nightlyBreakdown: [{ date: '2026-07-20', price: 120, seasonLabel: 'Été', pricingMode: 'fixed' }],
    totalPrice: 840, extraGuestSurcharge: 25,
    optionLines: [{ optionId: 7, title: 'Petit-déjeuner', quantity: 2, unitPrice: 12, totalPrice: 168, offered: false, acompteContribTtc: 50 }],
    optionsTotal: 168,
    resourceLines: [{ resourceId: 3, name: 'Bain nordique', quantity: 1, unitPrice: 55, totalPrice: 55, offered: false, soldeContribTtc: 20 }],
    resourcesTotal: 55,
    touristTaxTotal: 33, touristTaxLabel: 'Taxe', touristTaxCollectedOnArrival: false,
    finalPrice: 1033, totalStayPrice: 1066, depositAmount: 309.9, depositDueDate: '2026-06-20',
    balanceAmount: 723.1, balanceDueDate: '2026-07-13', complementAmount: 0,
    // internals that must NOT leak:
    vatPercentageAccommodation: 10, accommodationNetPrice: 763.6, totalVatAmount: 93.9, engineFinalPrice: 1033,
  };
  // Default (full mode): no Acompte/Solde blocks — the site charges the whole stay at once.
  const q = toPublicQuote(engineQuote, { available: true, startDate: '2026-07-20', endDate: '2026-07-27' });
  assert.equal(q.propertyId, 1);
  assert.equal(q.startDate, '2026-07-20');
  assert.equal(q.endDate, '2026-07-27');
  assert.equal(q.available, true);
  assert.equal(q.finalPrice, 1033);
  // Headline total INCLUDES the tourist tax (1033 + 33), unlike the tax-exclusive finalPrice.
  assert.equal(q.totalStayPrice, 1066);
  assert.equal(q.payment.mode, 'full');
  assert.equal('deposit' in q, false, 'full mode omits the deposit block');
  assert.equal('balance' in q, false, 'full mode omits the balance block');
  assert.equal(q.touristTax.total, 33);
  assert.equal(q.options[0].total, 168);
  // The projected option line must not carry the accounting bucket.
  assert.equal('acompteContribTtc' in q.options[0], false);
  // Resources are projected too, without accounting buckets.
  assert.equal(q.resourcesTotal, 55);
  assert.equal(q.resources[0].resourceId, 3);
  assert.equal(q.resources[0].total, 55);
  assert.equal('soldeContribTtc' in q.resources[0], false);
  // No VAT / engine-internal fields anywhere on the quote.
  const keys = Object.keys(q);
  assert.equal(keys.includes('vatPercentageAccommodation'), false);
  assert.equal(keys.includes('accommodationNetPrice'), false);
  assert.equal(keys.includes('totalVatAmount'), false);
  assert.equal(keys.includes('engineFinalPrice'), false);

  // Deposit mode: the Acompte/Solde blocks ARE included (specs/public-online-deposit.md).
  const qDep = toPublicQuote(engineQuote, { available: true, startDate: '2026-07-20', endDate: '2026-07-27', paymentMode: 'deposit' });
  assert.equal(qDep.payment.mode, 'deposit');
  assert.equal(qDep.deposit.amount, 309.9);
  assert.equal(qDep.deposit.dueDate, '2026-06-20');
  assert.equal(qDep.balance.amount, 723.1);
  assert.equal(qDep.balance.dueDate, '2026-07-13');
});
