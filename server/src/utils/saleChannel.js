/**
 * What a reservation's channel means for its money — the single reading every money path shares
 * (specs/plugins-phase-p-productisation.md rules 19 and 45).
 *
 * A platform marked « Compté comme vente directe » (`platforms.countsAsDirect`) is a DIRECT SALE: the
 * guest relationship is the operator's own, so it is billed like `direct` — acompte and solde on the
 * property's schedule for a new stay (an existing one keeps its stored schedule), extras not routed to
 * the arrival complement by default. It still keeps what only a named channel has: a platform amount
 * (brut) can be entered, a commission can be booked, and its tourist-tax mode is read from its
 * `platforms` row (« owner »: collected on arrival).
 *
 *   ownChannel    `direct` or a counts-as-direct platform — the direct-sale rules apply.
 *   platformSale  the opposite: an OTA sale (single payout unless the platform takes an acompte,
 *                 extras default to the complement, a paid solde follows the platform statement).
 *   namedChannel  anything but `direct` itself: a brut and commissions may be entered.
 *
 * Never compare a platform to `'direct'` by hand in a money path: ask this helper.
 */
const { isDirectChannel } = require('./platformNameFormat');

function isNamedChannel(platform) {
  return (String(platform ?? 'direct').trim().toLowerCase() || 'direct') !== 'direct';
}

function saleChannel(platform) {
  const ownChannel = isDirectChannel(platform);
  return {
    ownChannel,
    platformSale: !ownChannel,
    namedChannel: isNamedChannel(platform),
  };
}

module.exports = { saleChannel, isNamedChannel };
