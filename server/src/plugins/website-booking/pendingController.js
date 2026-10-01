/**
 * GET /api/dashboard/public-devis-pending — the website requests still waiting to be handled
 * (specs/site-booking-notifications.md §3 rule 5), feeding the « Demandes du site » alert. Moved
 * into the plugin by specs/plugins-phase-2-hosts.md rule 25 (gap 2): it answered while the plugin
 * was off.
 */

// listPendingPublicDevis: () => [{ … }] — the core reservations model's read.
function buildPendingController({ listPendingPublicDevis }) {
  return {
    list(req, res) {
      return res.json({ alerts: listPendingPublicDevis() });
    },
  };
}

module.exports = { buildPendingController };
