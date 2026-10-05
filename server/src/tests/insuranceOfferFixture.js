/**
 * Offers the cancellation insurance in a suite (specs/plugins-phase-3b-neat.md rule 5): a live `neat`
 * declaring an unready quote post-processor — the insurance is sold at its Options price, as with Neat
 * installed but not configured. A non-test module so no suite imports another.
 */

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');

function offerInsurance({ price = null } = {}) {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  const answer = price === null ? null : { cancellationInsurancePrice: price };
  createContext('neat', {}).quotePostProcessor({
    id: 'neat',
    isReady: () => price !== null,
    priceSync: () => answer,
    priceLive: async () => answer,
  });
}

function withdrawInsurance() {
  registry.reset();
}

module.exports = { offerInsurance, withdrawInsurance };
