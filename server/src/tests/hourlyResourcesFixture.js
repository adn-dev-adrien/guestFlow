/**
 * Prices `per_hour` lines in a suite as the `hourly-resources` plugin does once live
 * (specs/plugins-phase-3c-hourly-resources.md rule 11): a live plugin declaring its price-line
 * contributor. A non-test module so no suite imports another.
 */

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { createHourlyContributor } = require('../plugins/hourly-resources/pricing');

function liveHourlyResources() {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  createContext('hourly-resources', {}).priceLineContributor(createHourlyContributor());
}

function withdrawHourlyResources() {
  registry.reset();
}

module.exports = { liveHourlyResources, withdrawHourlyResources };
