/**
 * Social links of the guest emails (specs/settings-input-guards.md §3.7): an ordered list of
 * `{ network, url }`, validated per entry, kept in sync with the legacy `instagramUrl` so a rollback
 * renders the same J+1 e-mail.
 */

const { validatePublicUrl } = require('./settingsValidation');

const MAX_SOCIAL_LINKS = 8;

const SOCIAL_NETWORKS = [
  { value: 'instagram', label: 'Instagram', hosts: ['instagram.com'] },
  { value: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.com', 'fb.me'] },
  { value: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'] },
  { value: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  { value: 'pinterest', label: 'Pinterest', hosts: ['pinterest.com', 'pinterest.fr', 'pin.it'] },
  { value: 'linkedin', label: 'LinkedIn', hosts: ['linkedin.com'] },
  { value: 'x', label: 'X', hosts: ['x.com', 'twitter.com'] },
];

const networkOf = (value) => SOCIAL_NETWORKS.find((n) => n.value === value);

/** The catalogue as the settings form needs it (the hosts stay server-side). */
const publicNetworks = () => SOCIAL_NETWORKS.map(({ value, label }) => ({ value, label }));

const hostMatches = (hostname, hosts) => hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));

/** A stored list, tolerant of an absent or malformed column. */
function parseSocialLinks(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((e) => e && typeof e.network === 'string' && typeof e.url === 'string' && e.url.trim())
    .map((e) => ({ network: e.network, url: e.url.trim() }));
}

/** The refusal a URL deserves for its network, or '' (rule 37; the legacy `instagramUrl` input shares it, rule 43). */
function validateSocialUrl(url, network) {
  if (/\s/.test(url)) return 'URL invalide.';
  const urlError = validatePublicUrl(url);
  if (urlError) return urlError;
  return hostMatches(new URL(url).hostname.toLowerCase(), network.hosts) ? '' : 'Lien d\'un autre réseau.';
}

/**
 * @returns {{ links: Array<{network, url}>, errors: Object<string,string> }}
 * Errors are keyed `socialLinks.<index>.<field>` on the SUBMITTED index, so the form can put each
 * message under its own row. An entry whose URL is empty is dropped, not refused (rule 37).
 */
function validateSocialLinks(input) {
  const errors = {};
  const links = [];
  if (!Array.isArray(input)) return { links, errors: { socialLinks: 'Liste invalide.' } };
  if (input.length > MAX_SOCIAL_LINKS) errors.socialLinks = `${MAX_SOCIAL_LINKS} liens au plus.`;
  const seen = new Set();
  input.forEach((entry, index) => {
    const network = entry && typeof entry === 'object' ? networkOf(entry.network) : null;
    const url = entry && typeof entry === 'object' ? String(entry.url == null ? '' : entry.url).trim() : '';
    if (!network) {
      errors[`socialLinks.${index}.network`] = 'Réseau inconnu.';
      return;
    }
    if (!url) return;
    const urlError = validateSocialUrl(url, network);
    if (urlError) {
      errors[`socialLinks.${index}.url`] = urlError;
      return;
    }
    if (seen.has(network.value)) {
      errors[`socialLinks.${index}.network`] = 'Déjà dans la liste.';
      return;
    }
    seen.add(network.value);
    links.push({ network: network.value, url });
  });
  return { links, errors };
}

/** What the legacy `instagramUrl` column holds for a list (rule 42). */
function instagramUrlOf(links) {
  const entry = links.find((l) => l.network === 'instagram');
  return entry ? entry.url : '';
}

/** An older client sending `emails.instagramUrl` replaces the Instagram entry and keeps the others (rule 43). */
function mergeLegacyInstagram(links, url) {
  const value = String(url == null ? '' : url).trim();
  const others = links.filter((l) => l.network !== 'instagram');
  if (!value) return others;
  const index = links.findIndex((l) => l.network === 'instagram');
  if (index === -1) return [...others, { network: 'instagram', url: value }];
  return links.map((l) => (l.network === 'instagram' ? { network: 'instagram', url: value } : l));
}

/**
 * The links the e-mail lists: the saved list, else the legacy Instagram URL (an instance whose list
 * was never written, e.g. a minimal schema).
 */
function effectiveSocialLinks(settings = {}) {
  const links = parseSocialLinks(settings.socialLinks);
  if (links.length) return links;
  const legacy = String(settings.instagramUrl == null ? '' : settings.instagramUrl).trim();
  return legacy ? [{ network: 'instagram', url: legacy }] : [];
}

/**
 * The `{{link}}` of the J+1 paragraph (rule 39): one link is that URL, exactly what `instagramUrl`
 * produced; several expand to one « Network : url » line each, in the operator's order, starting on a new line so
 * the sentence « Pour suivre nos nouvelles : » never runs into the first label.
 */
function renderSocialLinks(links, lang = 'fr') {
  if (!links.length) return '';
  if (links.length === 1) return links[0].url;
  const colon = lang === 'en' ? ':' : ' :';
  return `\n${links.map((l) => `${networkOf(l.network)?.label || l.network}${colon} ${l.url}`).join('\n')}`;
}

module.exports = {
  MAX_SOCIAL_LINKS, SOCIAL_NETWORKS, publicNetworks, parseSocialLinks, validateSocialLinks, validateSocialUrl,
  instagramUrlOf, mergeLegacyInstagram, effectiveSocialLinks, renderSocialLinks, networkOf,
};
