/**
 * STEP platformGross — PLATFORM PRICE (specs/pricing-components.md §3 rule 52).
 *
 * The gross a platform pin fixes, the arrival-complement extras and the pre-arrival extras the brut back-solve
 * excludes.
 * `apply(ctx)` returns a new context and never mutates the one it receives.
 */

const { roundMoney } = require('../money');
const { isPlatformLine } = require('../platformPrice');

const step = {
  id: 'platformGross',
  requires: [
    'channel', 'finalOptionLines', 'midStayUnforced', 'optionsTotal', 'platformGrossAmountInput', 'resourceLines',
    'resourcesTotal',
  ],
  provides: ['platformGrossPin', 'preArrivalOptionsResources'],
  apply(ctx) {
    const {
      channel, finalOptionLines, midStayUnforced, optionsTotal, platformGrossAmountInput, resourceLines,
      resourcesTotal,
    } = ctx;

    // specs/platform-payment-entry.md — on a non-direct reservation a set `platformGrossAmount` PINS the
    // PLATFORM-PAID portion of the stay (the brut the guest paid the platform). It supersedes
    // `customPrice`/`discountPercent` (the brut is the single price lever for platforms). The accommodation
    // is back-solved so that `accommodation + extra-guest + the NON-complement options/resources = brut`.
    // Complement items (extras not declared `collectAt = 'platform'`, rule 17) are NOT part of the platform
    // payment, so they are excluded from the back-solve and END UP ADDED ON TOP: finalPrice = brut +
    // complement. Clamped ≥ 0 so an inconsistent brut (< pre-arrival options) can't go negative.
    const platformGrossPin = channel.namedChannel
      && platformGrossAmountInput !== '' && platformGrossAmountInput != null && Number.isFinite(Number(platformGrossAmountInput))
      ? roundMoney(Number(platformGrossAmountInput))
      : null;
    const complementOptionsResourcesTotal = roundMoney(
      finalOptionLines.reduce((s, l) => s + (isPlatformLine(l) ? 0 : Number(l.totalPrice || 0)), 0)
      + resourceLines.reduce((s, l) => s + (isPlatformLine(l) ? 0 : Number(l.totalPrice || 0)), 0),
    );
    // Extras sold mid-stay are collected by US at check-out, never by the platform: like the complement
    // items, they are excluded from the brut back-solve (`midStayForced` is already out via
    // `complementOptionsResourcesTotal`).
    const preArrivalOptionsResources = roundMoney(
      optionsTotal + resourcesTotal - complementOptionsResourcesTotal - midStayUnforced,
    );

    return { ...ctx, platformGrossPin, preArrivalOptionsResources };
  },
};

module.exports = step;
