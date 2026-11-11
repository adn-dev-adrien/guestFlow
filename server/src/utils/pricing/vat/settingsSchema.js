/**
 * VAT settings (specs/pricing-components.md §3 rules 50, 51, 61): `regime` and one rate per (vatClass, customerContext),
 * read through SettingsProvider.for('vat', scope). A rate left `null` follows the regime's rate (PR A: every `hosted` rate
 * is the regime's, an `external` rate has no value until PR B moves the hourly resources' standalone rate here).
 */
const VAT_CLASSES = ['accommodation', 'options', 'resources', 'outOfScope'];
const CUSTOMER_CONTEXTS = ['hosted', 'external'];

const rateKey = (vatClass, customerContext) => `vat.rate.${vatClass}.${customerContext}`;

const validRate = (value) => (value === null || (Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) < 100)
  ? null
  : 'Un taux entre 0 et 100 est attendu.');

const settingsSchema = [
  {
    key: 'regime', type: 'string', default: 'subject', scope: 'global',
    validate: (value) => (['subject', 'not_subject'].includes(value) ? null : 'Choix invalide.'),
  },
  ...VAT_CLASSES.flatMap((vatClass) => CUSTOMER_CONTEXTS.map((customerContext) => ({
    key: rateKey(vatClass, customerContext), type: 'number', default: null, scope: 'article', validate: validRate,
  }))),
];

module.exports = { settingsSchema, rateKey, VAT_CLASSES, CUSTOMER_CONTEXTS };
