/**
 * The head's call of a plugin-owned family (specs/pricing-components.md §3 rules 5, 47; specs/plugins-phase-3c-hourly-resources.md
 * rules 1-4, 18) — the safety the engine always applied to what a plugin answers: pricing never fails because of a plugin.
 *
 * `contributionOf(family, config, request, stay, logger)` asks the family for the line and returns
 * `{ quantity, unitPrice?, billedUnits?, totalPrice?, extra }`, or null when the family has no contribution:
 *   - a family that throws, or answers nothing, is logged and treated as no contribution;
 *   - an answer without a finite, non-negative quantity is logged and treated as no contribution;
 *   - the amounts are kept only when `unitPrice`, `billedUnits` and `totalPrice` are all finite, else the answer is a plain quantity;
 *   - `extra` is closed: only `sessions`, `scheduledHours` and `detail` pass.
 *
 * Internal to `articles/`.
 */
const EXTRA_KEYS = ['sessions', 'scheduledHours', 'detail'];

function closedExtra(extra) {
  const out = {};
  for (const key of EXTRA_KEYS) {
    if (extra && extra[key] !== undefined) out[key] = extra[key];
  }
  return out;
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function contributionOf(family, config, request, stay, logger = console) {
  let answer;
  try {
    answer = family.price(config, request, stay);
  } catch (err) {
    logger.error(`[articles] family ${family.id} threw on ${request.ref}:`, err && err.message);
    return null;
  }
  if (!answer) return null;
  if (!finite(answer.quantity)) {
    logger.warn(`[articles] family ${family.id} answered no quantity for ${request.ref}`);
    return null;
  }
  const priced = finite(answer.unitPrice) && finite(answer.billedUnits) && finite(answer.totalPrice);
  return {
    quantity: answer.quantity,
    ...(priced ? { unitPrice: answer.unitPrice, billedUnits: answer.billedUnits, totalPrice: answer.totalPrice } : {}),
    extra: closedExtra(answer.extra),
  };
}

module.exports = { contributionOf };
