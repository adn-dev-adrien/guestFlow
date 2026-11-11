/**
 * Price-line contributors (specs/plugins-phase-3c-hourly-resources.md rules 1–4, 18). A plugin
 * declares one with `ctx.priceLineContributor`. The Articles head reaches it through the plugin's `hourly`
 * family (specs/pricing-components.md §3 rule 47), inside the safety of `articles/pluginFamily.js`, and keeps doing
 * everything else itself: the locked snapshot, « offert », the contributions. This module only says which price
 * types a live plugin owns (`offered`).
 *
 * Contributor contract:
 *   id
 *   priceTypes          → the resource price types it prices (['per_hour'])
 *   priceLine(input)    → { quantity, unitPrice?, billedUnits?, totalPrice?, extra? } | null
 *                         synchronous, no I/O. Without amounts, the engine prices `quantity` as a
 *                         plain quantity. `null` = price the line as if no plugin were there.
 *
 * `extra` is closed: the head copies `sessions`, `scheduledHours` and `detail`, nothing else.
 */

const registry = require('../plugins/sdk/registry');

// The contributor of a live plugin for this price type, or null.
function contributorFor(priceType) {
  const record = registry.all().find((r) => r.priceLineContributor
    && r.priceLineContributor.priceTypes.includes(priceType)
    && registry.isLive(r.id));
  return record ? record.priceLineContributor : null;
}

// Rule 18 — a price type a plugin owns is offered only while that plugin is live. A type no plugin
// declares is the core's and always offered.
const PLUGIN_PRICE_TYPES = Object.freeze({ per_hour: 'hourly-resources' });

function offered(priceType) {
  const owner = PLUGIN_PRICE_TYPES[priceType];
  return !owner || Boolean(contributorFor(priceType));
}

module.exports = { contributorFor, offered, PLUGIN_PRICE_TYPES };
