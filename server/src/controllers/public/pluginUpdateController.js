/**
 * Update manifest for the `guestflow-booking` WordPress plugin
 * (specs/wordpress-plugin-self-update.md §4.1).
 *
 * WordPress asks the site's own GuestFlow where the newest plugin build is, then installs it with
 * its native updater. The alternative — letting the GuestFlow process reach the Docker socket to
 * copy files into the WordPress container — would mean handing the application root on the host,
 * which is exactly the power the self-update work is removing.
 *
 * Everything served here comes from the hourly release check that already ran: no extra call to
 * GitHub, and no way for this endpoint to point WordPress anywhere but a GitHub release asset.
 */

const updateStateModel = require('../../models/updateStateModel');
const { isAllowedDownloadUrl } = require('../../utils/releaseClient');

const SLUG = 'guestflow-booking';
// Kept in sync with the plugin header (integrations/wordpress/guestflow-booking/guestflow-booking.php).
const REQUIRES_WP = '6.4';
const REQUIRES_PHP = '8.0';
const TESTED_WP = '6.7';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Release notes (already parsed into sections) → the small HTML block WordPress shows. */
function notesToHtml(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return '';
  return notes
    .map((section) => {
      const items = section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
      const title = section.title ? `<h4>${escapeHtml(section.title)}</h4>` : '';
      return `${title}<ul>${items}</ul>`;
    })
    .join('');
}

function buildManifest(state) {
  const plugin = state.latestPlugin;
  // No published plugin asset, or one hosted somewhere unexpected → advertise nothing at all.
  if (!plugin || !plugin.version || !isAllowedDownloadUrl(plugin.url)) return null;
  return {
    slug: SLUG,
    version: plugin.version,
    download_url: plugin.url,
    requires: REQUIRES_WP,
    requires_php: REQUIRES_PHP,
    tested: TESTED_WP,
    last_updated: state.latestPublishedAt || null,
    sections: {
      changelog: notesToHtml(state.latestNotes),
    },
  };
}

function getPluginUpdate(req, res) {
  const manifest = buildManifest(updateStateModel.readState());
  if (!manifest) {
    return res.status(404).json({
      error: { code: 'NO_PLUGIN_RELEASE', message: "Aucune version publiée du plugin n'est connue." },
    });
  }
  return res.json(manifest);
}

module.exports = { getPluginUpdate, __test: { buildManifest, notesToHtml, SLUG } };
