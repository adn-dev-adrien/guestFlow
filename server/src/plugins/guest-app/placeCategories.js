/** The closed set of « Pratique » categories (specs/guest-app/guest-app-local-amenities.md rule 10). No dependency: the booklet's button target reads it too. */

// Rule 10 — the closed set, in this order. Each label is the chip's (plural) and the sheet's (`one`).
const CATEGORIES = Object.freeze([
  { key: 'dechets', fr: 'Déchets', en: 'Waste', oneFr: 'Déchets', oneEn: 'Waste' },
  { key: 'boulangerie', fr: 'Boulangeries', en: 'Bakeries', oneFr: 'Boulangerie', oneEn: 'Bakery' },
  { key: 'pharmacie', fr: 'Pharmacie', en: 'Pharmacy', oneFr: 'Pharmacie', oneEn: 'Pharmacy' },
  { key: 'boucherie', fr: 'Boucheries', en: 'Butchers', oneFr: 'Boucherie', oneEn: 'Butcher' },
  { key: 'epicerie', fr: 'Épiceries', en: 'Grocery shops', oneFr: 'Épicerie', oneEn: 'Grocery shop' },
  { key: 'tabac', fr: 'Tabac-presse', en: 'Tobacconist', oneFr: 'Tabac-presse', oneEn: 'Tobacconist' },
  { key: 'poste', fr: 'La Poste', en: 'Post office', oneFr: 'La Poste', oneEn: 'Post office' },
  { key: 'distributeur', fr: 'Distributeur de billets', en: 'Cash machine', oneFr: 'Distributeur de billets', oneEn: 'Cash machine' },
  { key: 'carburant', fr: 'Carburant et recharge', en: 'Fuel and charging', oneFr: 'Carburant et recharge', oneEn: 'Fuel and charging' },
]);
const CATEGORY_KEYS = Object.freeze(CATEGORIES.map((c) => c.key));

module.exports = { CATEGORIES, CATEGORY_KEYS };
