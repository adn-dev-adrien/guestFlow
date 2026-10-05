/**
 * Price-line contributors (specs/plugins-phase-3c-hourly-resources.md rules 1–4, 18). A plugin
 * declares one with `ctx.priceLineContributor`; the engine asks it, line by line, inside its resource
 * loop, and keeps doing everything else itself: the locked snapshot, « offert », the contributions.
 *
 * Contributor contract:
 *   id
 *   priceTypes          → the resource price types it prices (['per_hour'])
 *   priceLine(input)    → { quantity, unitPrice?, billedUnits?, totalPrice?, extra? } | null
 *                         synchronous, no I/O. Without amounts, the engine prices `quantity` as a
 *                         plain quantity. `null` = price the line as if no plugin were there.
 *
 * `extra` is closed: the engine copies `sessions`, `scheduledHours` and `detail`, nothing else.
 */

const registry = require('../plugins/sdk/registry');

const EXTRA_KEYS = ['sessions', 'scheduledHours', 'detail'];

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

function closedExtra(extra) {
  const out = {};
  for (const key of EXTRA_KEYS) {
    if (extra && extra[key] !== undefined) out[key] = extra[key];
  }
  return out;
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The contributed line for `resource`, or null when no live contributor prices it. A throwing
 * contributor, or an answer without a finite quantity, is logged and treated as no contribution:
 * pricing never fails because of a plugin (rule 1).
 */
function priceLine(resource, input, logger = console) {
  const contributor = contributorFor(resource && resource.priceType);
  if (!contributor) return null;
  let answer;
  try {
    answer = contributor.priceLine({ ...input, resource });
  } catch (err) {
    logger.error(`[priceLineContributors] ${contributor.id} threw on resource ${resource.id}:`, err && err.message);
    return null;
  }
  if (!answer) return null;
  if (!finite(answer.quantity)) {
    logger.warn(`[priceLineContributors] ${contributor.id} answered no quantity for resource ${resource.id}`);
    return null;
  }
  const priced = finite(answer.unitPrice) && finite(answer.billedUnits) && finite(answer.totalPrice);
  return {
    quantity: answer.quantity,
    ...(priced ? { unitPrice: answer.unitPrice, billedUnits: answer.billedUnits, totalPrice: answer.totalPrice } : {}),
    extra: closedExtra(answer.extra),
  };
}

module.exports = { contributorFor, offered, priceLine, PLUGIN_PRICE_TYPES };
