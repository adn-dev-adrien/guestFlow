/**
 * The public API the WordPress site calls (specs/public-api.md; specs/plugins-phase-2-hosts.md rule
 * 23). Five prefixes under `/public/v1`, outside the `/api` session guard; `/public/v1/gate` is not
 * one of them (gate-access mounts it with its own key and signature).
 *
 * The paths are an external contract with the WordPress plugin
 * (integrations/wordpress/guestflow-booking/includes/class-gf-rest-proxy.php): they never change.
 */

const express = require('express');
const sdk = require('../../sdk');
const requirePublicApiKey = require('../requirePublicApiKey');
const visitorContext = require('../visitorContext');

const PUBLIC_MOUNTS = [
  ['/public/v1/properties', () => require('./properties')],
  ['/public/v1/terms', () => require('./terms')],
  ['/public/v1/quote', () => require('./quote')],
  ['/public/v1/booking-requests', () => require('./bookingRequests')],
  ['/public/v1/plugin-update', () => require('./pluginUpdate')],
];

// Key first, then the visitor the proxy relays, then the limiter that counts per visitor
// (specs/terms-acceptance-record.md rule 24): the relayed address is only honoured once the caller is
// known to be the proxy, and an unauthenticated call is refused before it is counted. A request
// matches one prefix only, so the shared limiter counts it once.
function withPublicChain(subRouter) {
  const router = express.Router();
  router.use(requirePublicApiKey, visitorContext, sdk.middleware.publicApiLimiter, subRouter);
  return router;
}

/** [{ path, router }] — one per prefix, each behind the same chain. */
function buildPublicMounts() {
  return PUBLIC_MOUNTS.map(([path, load]) => ({ path, router: withPublicChain(load()) }));
}

module.exports = { buildPublicMounts, PUBLIC_PREFIXES: Object.freeze(PUBLIC_MOUNTS.map(([path]) => path)) };
