/**
 * Standalone sales controller — HTTP face of `utils/standaloneSale.js` (specs/pricing-components.md §4.3, rules 53, 74).
 *
 *   POST /api/standalone-sales/quote   { lines, customer?, saleId?, payment? }                      priced, nothing written
 *   POST /api/standalone-sales         { lines, customer?, payment?, acceptedTotalCents? }          the sale; 409 PRICE_CHANGED when the price moved
 * `lines[i]` is `{ articleRef: 'option:<id>' | 'resource:<id>', quantity, offered? }`; `customer` is `{ name?, email?, registerAsClient? }`;
 * `payment` is `{ tenders, shortfall: { kind: 'due' } | null, paidAt? }` or absent (the reste stays to collect). Thin: parse, call the service, answer.
 */
const standaloneSale = require('../utils/standaloneSale');

const answer = (res, result) => (result.status === 200 ? res.json((({ status, ...rest }) => rest)(result)) : res.status(result.status).json(result.body));

module.exports = {
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
