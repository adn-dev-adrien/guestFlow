/**
 * The « Réservation en ligne » card of Paramètres › Conditions générales
 * (specs/plugins-phase-2-hosts.md rule 25; specs/terms-acceptance-record.md rules 10, 17-18).
 *
 *   GET /api/terms/online-booking   the card and its two alerts, verdicts computed here
 *   PUT /api/terms/enforcement      the emergency switch; answers the same view
 *
 * The CGV themselves stay core: this only reads whether a version is published.
 */

// First plugin release that sends the acceptance (specs/terms-acceptance-record.md §3.3).
const MIN_PLUGIN_VERSION = '1.8.0';

function isVersionBelow(version, minimum) {
  const a = String(version || '').split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== b[i]) return (a[i] || 0) < b[i];
  }
  return false;
}

// settings: ./settings ({ termsSettings, setRequireTermsAcceptance }); currentTerms: () => version | null.
function buildEnforcementController({ settings, currentTerms }) {
  function view() {
    const { requireTermsAcceptance, lastSeenPluginVersion } = settings.termsSettings();
    const pluginOutdated = Boolean(lastSeenPluginVersion) && isVersionBelow(lastSeenPluginVersion, MIN_PLUGIN_VERSION);
    return {
      requireTermsAcceptance,
      lastSeenPluginVersion,
      minPluginVersion: MIN_PLUGIN_VERSION,
      pluginOutdated,
      // Both alerts only matter while the enforcement refuses the requests they describe.
      bookingClosed: requireTermsAcceptance && !currentTerms(),
      outdatedPluginBlocks: requireTermsAcceptance && pluginOutdated,
    };
  }

  return {
    view,
    get(req, res) {
      return res.json(view());
    },
    update(req, res) {
      const value = req.body?.requireTermsAcceptance;
      if (typeof value !== 'boolean') return res.status(400).json({ error: 'requireTermsAcceptance doit être un booléen.' });
      settings.setRequireTermsAcceptance(value);
      return res.json(view());
    },
  };
}

module.exports = { buildEnforcementController, isVersionBelow, MIN_PLUGIN_VERSION };
