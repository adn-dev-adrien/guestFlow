const { optionalPlugin } = require('../plugins/sdk/testing');
/**
 * Prices `per_hour` lines in a suite as the `hourly-resources` plugin does once live
 * (specs/plugins-phase-3c-hourly-resources.md rule 11): a live plugin declaring its price-line
 * contributor and its `hourly` family. A non-test module so no suite imports another.
 */

const registry = require('../plugins/sdk/registry');
const { createContext } = require('../plugins/sdk/createContext');
const { createHourlyContributor } = optionalPlugin(() => require('../plugins/hourly-resources/pricing'));
const { createHourlyFamily } = optionalPlugin(() => require('../plugins/hourly-resources/hourlyFamily'));

function liveHourlyResources() {
  registry.reset();
  registry.configure({ isActive: () => true, allows: () => true });
  if (createHourlyContributor) {
    const context = createContext('hourly-resources', {});
    const contributor = createHourlyContributor();
    context.priceLineContributor(contributor);
    context.articleFamily('hourly', createHourlyFamily(contributor));
  }
}

function withdrawHourlyResources() {
  registry.reset();
}

module.exports = { liveHourlyResources, withdrawHourlyResources };
