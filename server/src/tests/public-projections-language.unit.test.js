/**
 * specs/site-english-version.md §3 rules 4-9 — the public projections in English.
 *
 * The promise these tests defend is narrow and absolute: asking for `en` changes how a payload
 * READS and nothing else. Same rows, same prices, same availability — and no French word left in
 * anything a visitor can see.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  toPublicProperty,
  toPublicPropertyDetail,
  toPublicOption,
  toPublicResource,
  toPublicQuote,
  toPublicOptionLimits,
  toPublicCancellationInsurance,
} = require('../utils/publicProjections');

const OPTION = {
  id: 7,
  title: 'Petit déjeuner',
  titleEn: 'Breakfast',
  description: 'Servi en terrasse',
  priceType: 'per_person',
  price: 12,
  showsPlanningCard: 0,
};

const RESOURCE = {
  id: 3,
  name: 'Bain nordique',
  nameEn: 'Nordic bath',
  note: 'Détente sous les étoiles',
  priceType: 'per_hour',
  price: 55,
  freeMinutes: 90,
};

const PROPERTY = {
  id: 1, name: 'La Granja', nameArticle: 'à la', maxGuests: 10, maxBabies: 2,
  singleBeds: 2, doubleBeds: 4, basePriceIncludedGuests: 6,
  defaultCheckIn: '16:00', defaultCheckOut: '10:00',
};

// ── Rule 4 — option titles ───────────────────────────────────────────────────

test('an option title arrives already resolved, so the site renders one field', () => {
  assert.equal(toPublicOption(OPTION, 'fr').title, 'Petit déjeuner');
  assert.equal(toPublicOption(OPTION, 'en').title, 'Breakfast');
});

test('an empty English title falls back to French, without any marker', () => {
  const untranslated = { ...OPTION, titleEn: '' };
  const out = toPublicOption(untranslated, 'en');
  assert.equal(out.title, 'Petit déjeuner');
  assert.equal(out.titleEn, null);
  // Rule 4: "visually ordinary — no asterisk, no badge, no apology".
  assert.equal(JSON.stringify(out).includes('*'), false);
});

test('titleEn keeps being emitted unchanged, so nothing reading it today breaks', () => {
  assert.equal(toPublicOption(OPTION, 'fr').titleEn, 'Breakfast');
  assert.equal(toPublicOption(OPTION, 'en').titleEn, 'Breakfast');
});

// ── Rule 7 — the description ─────────────────────────────────────────────────

test('the French description is dropped in English rather than shown in French', () => {
  assert.equal(toPublicOption(OPTION, 'fr').description, 'Servi en terrasse');
  assert.equal(toPublicOption(OPTION, 'en').description, null);
});

// ── Rule 3 — the labels the server owns ──────────────────────────────────────

test('price-unit labels follow the language', () => {
  assert.equal(toPublicOption(OPTION, 'fr').priceUnitLabel, 'par personne');
  assert.equal(toPublicOption(OPTION, 'en').priceUnitLabel, 'per person');
});

test('a planning-card portion option names its portions in the right language', () => {
  const breakfast = { ...OPTION, showsPlanningCard: 1, autoOptionType: 'breakfast' };
  assert.equal(toPublicOption(breakfast, 'fr').quantityLabel, 'Nombre de petits déjeuners');
  assert.equal(toPublicOption(breakfast, 'en').quantityLabel, 'Number of breakfasts');
});

test('a planning-card option billed by session says so in both languages', () => {
  const session = { ...OPTION, priceType: 'per_stay', showsPlanningCard: 1 };
  assert.equal(toPublicOption(session, 'fr').priceUnitLabel, 'par séance');
  assert.equal(toPublicOption(session, 'en').priceUnitLabel, 'per session');
});

// ── Rule 5 — resources ───────────────────────────────────────────────────────

test('a resource name resolves like an option title, and nameEn is exposed', () => {
  assert.equal(toPublicResource(RESOURCE, 'fr').name, 'Bain nordique');
  assert.equal(toPublicResource(RESOURCE, 'en').name, 'Nordic bath');
  assert.equal(toPublicResource(RESOURCE, 'en').nameEn, 'Nordic bath');
});

test('a resource without an English name keeps the French one', () => {
  assert.equal(toPublicResource({ ...RESOURCE, nameEn: null }, 'en').name, 'Bain nordique');
});

test('the free-allowance sentence is written in the visitor’s language', () => {
  assert.equal(toPublicResource(RESOURCE, 'fr').freeLabel, '1 h 30 offerte par séjour');
  assert.equal(toPublicResource(RESOURCE, 'en').freeLabel, '1 h 30 included per stay');
});

// ── Rule 9 — proper nouns and French grammar ─────────────────────────────────

test('a property name is never translated, but its French article is emptied', () => {
  assert.equal(toPublicProperty(PROPERTY, 'en').name, 'La Granja');
  assert.equal(toPublicProperty(PROPERTY, 'fr').nameArticle, 'à la');
  assert.equal(toPublicProperty(PROPERTY, 'en').nameArticle, '');
});

test('the detail projection carries the language down to the list projection', () => {
  const detail = toPublicPropertyDetail({ ...PROPERTY, extraGuestPrice: 20, pricingRules: [] }, 'en');
  assert.equal(detail.nameArticle, '');
  assert.equal(detail.extraGuestPrice, 20);
});

// ── Rule 2 — the language never changes the numbers ──────────────────────────

test('language changes how a payload reads, never what it says', () => {
  const fr = toPublicOption(OPTION, 'fr');
  const en = toPublicOption(OPTION, 'en');
  for (const key of ['id', 'price', 'priceType', 'showsPlanningCard']) {
    assert.deepEqual(fr[key], en[key], `${key} must not depend on the language`);
  }
});

test('a property payload keeps identical numbers in both languages', () => {
  const fr = toPublicProperty(PROPERTY, 'fr');
  const en = toPublicProperty(PROPERTY, 'en');
  for (const key of ['id', 'maxGuests', 'maxBabies', 'singleBeds', 'doubleBeds', 'basePriceIncludedGuests']) {
    assert.equal(fr[key], en[key], `${key} must not depend on the language`);
  }
});

// ── Rule 1 — a language token must never cost a booking ──────────────────────

test('an absent, unknown or malformed language behaves exactly like French', () => {
  const reference = JSON.stringify(toPublicOption(OPTION, 'fr'));
  for (const lang of [undefined, null, '', '   ', 'de', 'zz', 42, {}, []]) {
    assert.equal(JSON.stringify(toPublicOption(OPTION, lang)), reference, `failed for ${JSON.stringify(lang)}`);
  }
});

test('a projection passed straight to Array.map survives the index argument', () => {
  // `map` hands the index as the second argument, so an unguarded projection would be called with
  // lang = 0, 1, 2… This is the accident that this guard exists for.
  const rows = [OPTION, { ...OPTION, id: 8 }, { ...OPTION, id: 9 }];
  assert.doesNotThrow(() => rows.map(toPublicOption));
  assert.doesNotThrow(() => [RESOURCE].map(toPublicResource));
  assert.equal(rows.map(toPublicOption)[2].title, 'Petit déjeuner');
});

// ── Rule 6 — a quote in English has no French line ───────────────────────────

const QUOTE = {
  property: { id: 1 },
  nights: 3,
  persons: 4,
  totalPrice: 600,
  finalPrice: 660,
  totalStayPrice: 680,
  optionLines: [{ optionId: 7, title: 'Petit déjeuner', titleEn: 'Breakfast', quantity: 12, unitPrice: 12, totalPrice: 144 }],
  resourceLines: [{ resourceId: 3, name: 'Bain nordique', nameEn: 'Nordic bath', quantity: 3, billedUnits: 1.5, unitPrice: 55, totalPrice: 82.5 }],
};

test('quote option lines and resource lines are resolved too', () => {
  const en = toPublicQuote(QUOTE, { available: true, startDate: '2026-07-10', endDate: '2026-07-13', lang: 'en' });
  assert.equal(en.options[0].title, 'Breakfast');
  assert.equal(en.resources[0].name, 'Nordic bath');
  const fr = toPublicQuote(QUOTE, { available: true, startDate: '2026-07-10', endDate: '2026-07-13' });
  assert.equal(fr.options[0].title, 'Petit déjeuner');
  assert.equal(fr.resources[0].name, 'Bain nordique');
});

test('the offered-hours note on a quote line follows the language', () => {
  const fr = toPublicQuote(QUOTE, { available: true, startDate: 'a', endDate: 'b' });
  const en = toPublicQuote(QUOTE, { available: true, startDate: 'a', endDate: 'b', lang: 'en' });
  assert.equal(fr.resources[0].offeredNote, '1 h 30 offerte');
  assert.equal(en.resources[0].offeredNote, '1 h 30 included');
});

test('an English quote keeps every amount identical to the French one', () => {
  const fr = toPublicQuote(QUOTE, { available: true, startDate: 'a', endDate: 'b' });
  const en = toPublicQuote(QUOTE, { available: true, startDate: 'a', endDate: 'b', lang: 'en' });
  assert.equal(fr.accommodationTotal, en.accommodationTotal);
  assert.equal(fr.finalPrice, en.finalPrice);
  assert.equal(fr.totalStayPrice, en.totalStayPrice);
  assert.equal(fr.options[0].total, en.options[0].total);
  assert.equal(fr.resources[0].total, en.resources[0].total);
});

// ── Portion limits and the insurance block ───────────────────────────────────

test('the portion hint is written in the visitor’s language', () => {
  const options = [{ ...OPTION, showsPlanningCard: 1, autoOptionType: 'breakfast', isCancellationInsurance: 0 }];
  const args = { options, persons: 2, nights: 3, property: PROPERTY };
  assert.match(toPublicOptionLimits({ ...args }).at(0).hint, /^Jusqu'à 6 —/);
  assert.match(toPublicOptionLimits({ ...args, lang: 'en' }).at(0).hint, /^Up to 6 —/);
});

test('the cancellation-insurance block is translated, percentages included', () => {
  const insurance = { id: 9, title: 'Assurance annulation', titleEn: 'Cancellation insurance', priceType: 'percent_of_stay', price: 4 };
  const fr = toPublicCancellationInsurance(insurance, {});
  const en = toPublicCancellationInsurance(insurance, { lang: 'en' });
  assert.equal(fr.priceLabel, '4 % du montant du séjour');
  assert.equal(en.priceLabel, '4 % of the stay total');
  assert.equal(en.title, 'Cancellation insurance');
  assert.equal(fr.percent, en.percent);
});

test('a Neat-priced insurance announces itself in the right language', () => {
  const insurance = { id: 9, title: 'Assurance annulation', titleEn: 'Cancellation insurance', priceType: 'per_stay', price: 0 };
  const fr = toPublicCancellationInsurance(insurance, { neatPricingActive: true });
  const en = toPublicCancellationInsurance(insurance, { neatPricingActive: true, lang: 'en' });
  assert.equal(fr.priceLabel, 'Tarif calculé pour vos dates de séjour');
  assert.equal(en.priceLabel, 'Price calculated for your dates');
});

// ── Rule 10 — one money format across the PDF, the e-mail and the site ───────

test('specs/site-english-version.md rule 10 — English keeps the French decimal comma', () => {
  // The property is in the euro zone and the quote PDF attached to the e-mail already writes
  // « 1 234,56 € » to English guests (specs/email-language-fr-en.md §3 rule 4). One convention
  // across the three surfaces is worth more than local elegance on one of them.
  const insurance = { id: 9, title: 'Assurance', titleEn: 'Insurance', priceType: 'per_stay', price: 12.5 };
  const en = toPublicCancellationInsurance(insurance, { lang: 'en' });
  const fr = toPublicCancellationInsurance(insurance, {});
  assert.match(en.priceLabel, /12,5 €/, 'the decimal separator must not become a point in English');
  assert.match(fr.priceLabel, /12,5 €/);
  assert.equal(en.priceLabel, '12,5 € per stay');
  assert.equal(fr.priceLabel, '12,5 € au séjour');
});

test('specs/site-english-version.md rule 10 — a percentage reads the same way in both languages', () => {
  const insurance = { id: 9, title: 'Assurance', titleEn: 'Insurance', priceType: 'percent_of_stay', price: 4.5 };
  assert.equal(toPublicCancellationInsurance(insurance, {}).priceLabel, '4,5 % du montant du séjour');
  assert.equal(toPublicCancellationInsurance(insurance, { lang: 'en' }).priceLabel, '4,5 % of the stay total');
});
