/**
 * The name a platform reads as on a calendar (specs/ui-review-2026-10-19-operations.md rule 15):
 * « Gîtes de France », « GreenGo », « Abracadaroom » — never the stored key « GitesDeFrance » nor a
 * drifted lowercase spelling. Served with the reservation list so the client prints it as is.
 */
const { platformDisplayName } = require('./attributionChannel');
const { formatPlatformName } = require('./platformNameFormat');

function platformDisplay(platform) {
  const raw = String(platform || '').trim();
  if (!raw) return '';
  if (raw.toLowerCase() === 'direct') return 'Direct';
  return platformDisplayName(formatPlatformName(raw));
}

module.exports = { platformDisplay };
