/**
 * Where a website booking request came from (specs/site-traffic-analytics.md §3.C).
 *
 * Pure. The plugin only records raw facts (external referrer host, UTM parameters, landing path);
 * turning them into a channel is a business rule, so it lives here and nowhere in the browser.
 */

const CHANNEL_LABELS = {
  campaign: 'Campagne',
  ai: 'Assistant IA',
  search: 'Recherche',
  social: 'Réseaux sociaux',
  referral: 'Autre site',
  direct: 'Accès direct',
};
const UNKNOWN_LABEL = 'Origine inconnue';

const AI_HOSTS = [
  ['chatgpt.com', 'ChatGPT'],
  ['chat.openai.com', 'ChatGPT'],
  ['perplexity.ai', 'Perplexity'],
  ['claude.ai', 'Claude'],
  ['gemini.google.com', 'Gemini'],
  ['copilot.microsoft.com', 'Copilot'],
];

// `google.fr`, `www.google.co.uk`, `news.google.com`… — any subdomain, any country suffix.
const SEARCH_HOSTS = [
  [/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/, 'Google'],
  [/(^|\.)bing\.com$/, 'Bing'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)qwant\.com$/, 'Qwant'],
  [/(^|\.)ecosia\.org$/, 'Ecosia'],
  [/(^|\.)yahoo\.[a-z]{2,3}(\.[a-z]{2})?$/, 'Yahoo'],
];

const SOCIAL_HOSTS = [
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)facebook\.com$/, 'Facebook'],
  [/(^|\.)pinterest\.[a-z]{2,3}(\.[a-z]{2})?$/, 'Pinterest'],
  [/(^|\.)linkedin\.com$/, 'LinkedIn'],
  [/^t\.co$/, 'X'],
  [/(^|\.)x\.com$/, 'X'],
  [/(^|\.)twitter\.com$/, 'X'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)youtube\.com$/, 'YouTube'],
];

const UTM_KEYS = ['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm'];

function matchHost(host, table) {
  for (const [re, label] of table) if (re.test(host)) return label;
  return null;
}

// `utm_source=instagram` reads « Instagram », `utm_source=newsletter` stays « newsletter ».
function sourceLabel(source) {
  const s = String(source).toLowerCase();
  return matchHost(s, SOCIAL_HOSTS) || matchHost(`${s}.com`, SOCIAL_HOSTS)
    || matchHost(s, SEARCH_HOSTS) || matchHost(`${s}.com`, SEARCH_HOSTS)
    || source;
}

/**
 * Classify a validated attribution record (spec rule 16). The first matching rule wins.
 *
 * @param {object|null} rec  output of `validateAttribution`
 * @returns {{ channel: string|null, label: string|null }}
 *   `channel: null` means no attribution was sent at all — shown as « Origine inconnue ».
 */
function classifyAttribution(rec) {
  if (!rec) return { channel: null, label: null };
  if (UTM_KEYS.some((k) => rec[k])) {
    return { channel: 'campaign', label: rec.utmCampaign || sourceLabel(rec.utmSource || rec.utmMedium || '') || null };
  }
  const host = rec.referrer ? String(rec.referrer).toLowerCase() : '';
  if (host) {
    const ai = AI_HOSTS.find(([h]) => host === h || host.endsWith(`.${h}`));
    if (ai) return { channel: 'ai', label: ai[1] };
    const search = matchHost(host, SEARCH_HOSTS);
    if (search) return { channel: 'search', label: search };
    const social = matchHost(host, SOCIAL_HOSTS);
    if (social) return { channel: 'social', label: social };
    return { channel: 'referral', label: host.replace(/^www\./, '') };
  }
  return { channel: 'direct', label: null };
}

function channelTitle(channel) {
  return CHANNEL_LABELS[channel] || UNKNOWN_LABEL;
}

/**
 * Ready-to-render origin of a website request (spec rule 19), or nulls for anything that is not
 * one. `originDetail` is the tooltip: landing page, UTM parameters, referrer, capture time.
 */
function originDisplay(row) {
  if (!row || row.requestOrigin !== 'public') return { originLabel: null, originDetail: null };
  const title = channelTitle(row.attributionChannel);
  const originLabel = row.attributionChannel && row.attributionLabel ? `${title} · ${row.attributionLabel}` : title;

  let raw = null;
  try { raw = row.attribution ? JSON.parse(row.attribution) : null; } catch { raw = null; }
  if (!raw) return { originLabel, originDetail: null };
  const parts = [];
  if (raw.landingPath) parts.push(`Arrivé sur ${raw.landingPath}`);
  for (const k of UTM_KEYS) {
    if (raw[k]) parts.push(`utm_${k.slice(3).toLowerCase()}=${raw[k]}`);
  }
  if (raw.referrer) parts.push(`depuis ${raw.referrer}`);
  return { originLabel, originDetail: parts.length ? parts.join(' · ') : null };
}

// Stored platform names are canonical UpperCamelCase (utils/platformNameFormat.js); a few read badly.
const PLATFORM_DISPLAY = { gitesdefrance: 'Gîtes de France', gitedefrance: 'Gîtes de France', greengo: 'GreenGo' };

function platformDisplayName(platform) {
  const name = String(platform || '').trim();
  return PLATFORM_DISPLAY[name.toLowerCase().replace(/[^a-z]/g, '')] || name || 'Autre';
}

/**
 * The row of the « Canaux de réservation » card a reservation belongs to (spec rule 21). A website
 * request is a website row whatever its `platform`; « direct » is decided by `isDirectChannel`,
 * never by `platform === 'direct'` (most direct bookings carry `Lodgify`).
 */
function bookingChannelOf(row, isDirectChannel) {
  if (row.requestOrigin === 'public') {
    const channel = CHANNEL_LABELS[row.attributionChannel] ? row.attributionChannel : 'unknown';
    return { key: `site:${channel}`, group: 'site', channel, label: channelTitle(row.attributionChannel) };
  }
  if (isDirectChannel(row.platform)) return { key: 'direct', group: 'direct', channel: null, label: 'Direct (saisie)' };
  const label = platformDisplayName(row.platform);
  return { key: `platform:${label.toLowerCase()}`, group: 'platform', channel: null, label };
}

module.exports = {
  CHANNEL_LABELS, UNKNOWN_LABEL, classifyAttribution, channelTitle, originDisplay, platformDisplayName, bookingChannelOf,
};
