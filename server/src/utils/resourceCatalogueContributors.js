/**
 * The resource-card contributors of the live plugins (specs/options-resources-ux.md rule 19), in the
 * order the plugins are registered. A plugin that is not live adds nothing.
 */

const registry = require('../plugins/sdk/registry');

function resourceCatalogueContributors() {
  return registry.all()
    .filter((record) => record.resourceCatalogueLines && registry.isLive(record.id))
    .map((record) => record.resourceCatalogueLines);
}

module.exports = { resourceCatalogueContributors };
