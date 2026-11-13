/**
 * Standalone sales controller — HTTP face of `utils/standaloneSale.js` (specs/pricing-components.md §4.3, rules 53, 74).
 *
 *   POST /api/standalone-sales/quote   { lines, customer?, saleId?, payment? }                      priced, nothing written
 *   GET  /api/standalone-sales/vat-rates                                                              { classes: [{ vatClass, externalRate | null }] }
 *   POST /api/standalone-sales         { lines, customer?, payment?, acceptedTotalCents? }          the sale; 409 PRICE_CHANGED when the price moved
 * `lines[i]` is `{ articleRef: 'option:<id>' | 'resource:<id>', quantity, offered? }`; `customer` is `{ name?, email?, registerAsClient? }`;
 * `payment` is `{ tenders, shortfall: { kind: 'due' } | null, paidAt? }` or absent (the reste stays to collect). Thin: parse, call the service, answer.
 */
const standaloneSale = require('../utils/standaloneSale');

const answer = (res, result) => (result.status === 200 ? res.json((({ status, ...rest }) => rest)(result)) : res.status(result.status).json(result.body));

module.exports = {
  // The external VAT rate of each class the catalogue offers (owner Q-C11): what the article form shows beside « Vendable hors séjour ».
  vatRates(req, res) {
    const rates = require('../models/ports/settingsProvider').create(require('../database')).for('vat', {});
    const { ARTICLE_VAT_CLASSES } = require('../utils/pricing/vat/settingsSchema');
    return res.json({ classes: ARTICLE_VAT_CLASSES.map((vatClass) => ({ vatClass, externalRate: Number.isFinite(rates[`vat.rate.${vatClass}.external`]) ? rates[`vat.rate.${vatClass}.external`] : null })) });
  },

  quote(req, res) {
    const body = req.body || {};
    return answer(res, standaloneSale.quote({
      lines: body.lines, customer: body.customer, saleId: body.saleId,
    }));
  },

  sell(req, res) {
    const body = req.body || {};
    return answer(res, standaloneSale.sell({
      lines: body.lines,
      customer: body.customer,
      payment: body.payment,
      acceptedTotalCents: body.acceptedTotalCents,
      saleId: body.saleId,
      version: body.version,
    }, { actor: req.user ? req.user.email || String(req.user.id) : null }));
  },
};
