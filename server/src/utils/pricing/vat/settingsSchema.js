/**
 * VAT settings (specs/pricing-components.md §3 rules 50, 51, 61): one rate per (vatClass, customerContext), read through
 * SettingsProvider.for('vat', scope). A rate left `null` follows the regime's rate (PR A: every `hosted` rate is the
 * regime's; an `external` rate is the one set for its class in the catalogue (`vat_external_rates`), the resources' being the hourly
 * resources' standalone rate until the operator sets one). The regime
 * itself stays outside the provider: it belongs to the sale's period (`vatRegimeModel.forRow`).
 */
const VAT_CLASSES = ['accommodation', 'options', 'resources', 'drinks', 'catering', 'outOfScope'];
// The classes an article of the catalogue may carry (owner Q-C11); `accommodation` and `outOfScope` are the stay's own.
const ARTICLE_VAT_CLASSES = ['options', 'resources', 'drinks', 'catering'];
const CUSTOMER_CONTEXTS = ['hosted', 'external'];

const rateKey = (vatClass, customerContext) => `vat.rate.${vatClass}.${customerContext}`;

const validRate = (value) => (value === null || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) < 100)
  ? null
  : 'Un taux entre 0 et 100 est attendu.');

const settingsSchema = [
  ...VAT_CLASSES.flatMap((vatClass) => CUSTOMER_CONTEXTS.map((customerContext) => ({
    key: rateKey(vatClass, customerContext), type: 'number', default: null, scope: 'article', validate: validRate,
  }))),
];

module.exports = {
  settingsSchema, rateKey, VAT_CLASSES, ARTICLE_VAT_CLASSES, CUSTOMER_CONTEXTS,
};
