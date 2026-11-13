// Shared fixtures of the article-family suites (specs/pricing-components.md §3 rules 47, 57): catalogue rows, a stay
// context and a one-call pricing helper. Not a test file.
const { makeArticle } = require('../utils/pricing/articles');

const STAY = { persons: 4, nights: 3, maxGuests: 6, isDirectBooking: true, cancellationInsuranceBase: 500 };

const optionRow = (over = {}) => ({
  id: 7, title: 'Petit déjeuner', titleEn: 'Breakfast', price: 6.5, priceType: 'per_stay', freeUnits: 0, ...over,
});
const resourceRow = (over = {}) => ({
  id: 3, name: 'Bain nordique', nameEn: 'Nordic bath', price: 30, priceType: 'per_hour', freeMinutes: 60, showsPlanningCard: 1, ...over,
});

const article = (row = optionRow(), kind = 'option') => makeArticle(row, { kind });

// What a family returns for `request`, with the article's own config.
const priceWith = (family, row, request = {}, ctx = STAY, kind = 'option') => {
  const instance = article(row, kind);
  return family.price(instance.config, { ref: instance.ref, quantity: 1, ...request }, ctx);
};

const NO_VAT_KEYS = ['rate', 'vatRate', 'vatCents', 'netCents', 'vat'];
const taggedShape = (amount) => Object.keys(amount).sort().join();

module.exports = {
  STAY, optionRow, resourceRow, article, priceWith, NO_VAT_KEYS, taggedShape,
};
