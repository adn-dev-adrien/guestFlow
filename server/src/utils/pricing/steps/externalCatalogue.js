/**
 * STEP loadCatalogue — the catalogue side of an external sale (specs/pricing-components.md §3 rules 52, 53).
 *
 * The caller (`utils/standaloneSale.js`, with `models/standaloneSalesModel.js`) hands in what it read: the articles to price as instances
 * of rule 47 (`requests[i] = { article, quantity, offered?, ... }`), the document's frozen lines and allocations when the sale already
 * exists, the live families and the VAT regime and settings. This step checks the shape and lays the keys out for the steps after it;
 * it reads no database and no clock.
 */
const REQUEST_KEYS = ['article', 'quantity'];

const step = {
  id: 'loadCatalogue',
  requires: ['input'],
  provides: ['requests', 'stored', 'allocations', 'families', 'settings', 'vatRegime'],
  apply(ctx) {
    const { input } = ctx;
    for (const request of input.requests || []) {
      for (const key of REQUEST_KEYS) {
        if (request[key] === undefined) throw new Error(`EXTERNAL_SALE_INVALID_REQUEST: ${key}`);
      }
    }
    return {
      ...ctx,
      requests: input.requests || [],
      stored: input.stored || [],
      allocations: input.allocations || [],
      families: input.families,
      settings: input.settings || { vat: {} },
      vatRegime: input.vatRegime || null,
    };
  },
};

module.exports = step;
