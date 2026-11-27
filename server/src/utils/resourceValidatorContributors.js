/**
 * The resource-field validators of the live plugins (week-weekend-and-print spec rule 28), in the order the plugins are registered.
 * A plugin that is not live checks nothing.
 */

const registry = require('../plugins/sdk/registry');

function resourceValidators() {
  return registry.all()
    .filter((record) => record.resourceValidator && registry.isLive(record.id))
    .map((record) => record.resourceValidator);
}

module.exports = { resourceValidators };
