/**
 * Read-only client for the project's GitHub Releases (specs/self-update-and-releases.md §3.B).
 *
 * The repository is public, so the calls are unauthenticated: 60 requests/hour/IP is far more than
 * the hourly poll needs. Everything here is data-shaping — no filesystem, no process, no state — so
 * the whole module is unit-testable with an injected `fetchImpl`.
 *
 * Security note (§3.D rule 22): the repository, the API origin and the set of hosts an asset may be
 * downloaded from are constants of this module. A release payload can therefore never redirect the
 * updater somewhere else, whatever it contains.
 */

const { isValidVersion, stripLeadingV, compareVersions } = require('./semver');

const GITHUB_REPO = 'adn-dev-adrien/guestFlow';
const GITHUB_API_ORIGIN = 'https://api.github.com';

// One page of releases rather than `/releases/latest`: the offer has to cover the versions the
// operator skipped (specs/self-update-and-releases.md rules 12b, 20d), and that is the same single
// HTTP call — one page instead of one object.
const RELEASES_PER_PAGE = 30;
const RELEASES_URL = `${GITHUB_API_ORIGIN}/repos/${GITHUB_REPO}/releases?per_page=${RELEASES_PER_PAGE}`;

// Hosts an update artefact may legitimately come from: the API itself, the release page host, and
// the two storage hosts GitHub redirects asset downloads to.
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

const ARCHIVE_ASSET_RE = /^guestflow-(\d+\.\d+\.\d+)\.tar\.gz$/;
const CHECKSUMS_ASSET_NAME = 'SHA256SUMS';
const PLUGIN_ASSET_RE = /^guestflow-booking-(\d+\.\d+\.\d+)\.zip$/;

// CHANGELOG headings (Keep a Changelog + our `Migration` addition) → the French titles the UI shows.
const SECTION_TITLES_FR = {
  // The operator digest a release must carry (specs/self-update-and-releases.md §6.2 rule 20c). It
  // is what the update dialog shows; every other section sits behind « Tout le changelog ».
  summary: 'En bref',
  added: 'Ajouts',
  changed: 'Modifications',
  fixed: 'Corrections',
  removed: 'Suppressions',
  migration: 'Migration',
  security: 'Sécurité',
};

/** True when `url` is an absolute https URL on an allowed host. */
function isAllowedDownloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname);
}

/** Drop the markdown decorations a plain-text list cannot render. */
function stripMarkdown(text) {
  return String(text)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/**
 * A release body (the CHANGELOG section for that version) → `[{ key, title, items[] }]`.
 *
 * `key` is the canonical heading (`summary`, `added`, `fixed`…) when the heading is one we know,
 * `null` for anything else — so a consumer can find the digest without matching a French label.
 *
 * Bullets that wrap over several lines are re-joined. Text sitting before any `###` heading lands in
 * an untitled leading group rather than being dropped.
 */
function parseReleaseNotes(body) {
  const sections = [];
  let current = null;
  const openSection = (title, key = null) => {
    current = { key, title, items: [] };
    sections.push(current);
  };

  for (const rawLine of String(body || '').split('\n')) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
    if (heading) {
      const key = heading[1].trim().toLowerCase();
      openSection(SECTION_TITLES_FR[key] || stripMarkdown(heading[1]), SECTION_TITLES_FR[key] ? key : null);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!current) openSection(null);
      current.items.push(stripMarkdown(bullet[1]));
      continue;
    }
    if (current && current.items.length && line.trim()) {
      // Continuation of the previous wrapped bullet.
      current.items[current.items.length - 1] += ` ${stripMarkdown(line)}`;
    }
  }

  return sections.filter((section) => section.items.length > 0);
}

/**
 * Parsed sections → `{ summary, details }` (specs/self-update-and-releases.md §6.2 rule 20c).
 *
 * The update dialog asks one question — « what does this change for me? » — and a fourteen-line
 * paragraph does not answer it. The release therefore carries a `### Summary` block of short lines,
 * and that block alone is what the operator is shown; the detail waits behind « Tout le changelog ».
 *
 * A release published before the convention existed has no such block: `summary` comes back empty
 * and the caller falls back to showing everything, which is what those releases always did.
 */
function splitSummary(sections) {
  const list = Array.isArray(sections) ? sections : [];
  const digest = list.find((section) => section && section.key === 'summary');
  return {
    summary: digest ? [...digest.items] : [],
    details: list.filter((section) => section !== digest),
  };
}

/**
 * `SHA256SUMS` (the `sha256sum` output format: `<hash>␣␣<filename>`) → `{ filename: hash }`.
 */
function parseSha256Sums(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (match) out[match[2].trim()] = match[1].toLowerCase();
  }
  return out;
}

function pickAsset(assets, matcher) {
  return (Array.isArray(assets) ? assets : []).find(matcher) || null;
}

function toAsset(raw) {
  if (!raw || !isAllowedDownloadUrl(raw.browser_download_url)) return null;
  return {
    name: String(raw.name),
    url: String(raw.browser_download_url),
    size: Number(raw.size) || 0,
  };
}

/**
 * Shape a raw GitHub release payload into what the updater needs, or null when it is unusable
 * (bad version, missing archive, missing checksums, asset hosted somewhere unexpected).
 */
function normaliseRelease(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const version = stripLeadingV(String(raw.tag_name || ''));
  if (!isValidVersion(version)) return null;

  const archiveRaw = pickAsset(raw.assets, (a) => {
    const match = String(a?.name || '').match(ARCHIVE_ASSET_RE);
    return Boolean(match) && match[1] === version;
  });
  const checksumsRaw = pickAsset(raw.assets, (a) => String(a?.name || '') === CHECKSUMS_ASSET_NAME);
  const pluginRaw = pickAsset(raw.assets, (a) => PLUGIN_ASSET_RE.test(String(a?.name || '')));

  const archive = toAsset(archiveRaw);
  const checksums = toAsset(checksumsRaw);
  if (!archive || !checksums) return null;

  const plugin = toAsset(pluginRaw);
  const pluginVersion = plugin ? plugin.name.match(PLUGIN_ASSET_RE)[1] : null;

  return {
    version,
    publishedAt: raw.published_at || null,
    releaseUrl: typeof raw.html_url === 'string' ? raw.html_url : null,
    notes: parseReleaseNotes(raw.body),
    archive,
    checksums,
    plugin: plugin ? { ...plugin, version: pluginVersion } : null,
  };
}

/**
 * A raw release → `{ version, publishedAt, notes }`, or null when the tag is not a GuestFlow
 * version. Assets are deliberately not looked at: this is what a version *says it changed*, and a
 * broken publish two releases back must not cost that version its changelog (rule 12b).
 */
function toNotesEntry(raw) {
  const version = stripLeadingV(String(raw?.tag_name || ''));
  if (!isValidVersion(version)) return null;
  return {
    version,
    publishedAt: raw.published_at || null,
    notes: parseReleaseNotes(raw.body),
  };
}

/**
 * One page of published releases → what the updater needs (specs/self-update-and-releases.md
 * rules 12b, 20d):
 *
 * - `release` — the target, normalised exactly as `/releases/latest` used to be: the newest
 *   published version, and only if it carries its archive *and* its `SHA256SUMS`. A newest release
 *   with broken assets yields null here, so the updater offers nothing rather than falling back to
 *   advertising an older version.
 * - `releases` — every published version in the window, newest first, notes only. This is the span
 *   the dialog reads: what changed between the version the operator runs and the one on offer.
 * - `truncated` — the page came back full, so releases older than the window exist and are not
 *   carried. The dialog admits the gap rather than presenting a partial list as complete.
 *
 * Returns null on any failure — an unreachable GitHub, a rate limit or a malformed payload must
 * leave the caller on its last known state, never throw at it.
 */
async function fetchReleaseFeed({ fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let payload;
  try {
    const res = await fetchImpl(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'guestflow-updater' },
      signal: controller.signal,
    });
    if (!res || !res.ok) return null;
    payload = await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!Array.isArray(payload)) return null;

  // Drafts and pre-releases are not offers: `/releases/latest` never returned one, and neither does
  // the span behind it.
  const published = payload.filter((raw) => raw && !raw.draft && !raw.prerelease);
  const releases = published
    .map(toNotesEntry)
    .filter(Boolean)
    .sort((a, b) => compareVersions(b.version, a.version) || 0);

  const newest = releases.length
    ? published.find((raw) => stripLeadingV(String(raw.tag_name || '')) === releases[0].version)
    : null;

  return {
    release: normaliseRelease(newest),
    releases,
    truncated: payload.length >= RELEASES_PER_PAGE,
  };
}

module.exports = {
  GITHUB_REPO,
  RELEASES_URL,
  RELEASES_PER_PAGE,
  ALLOWED_DOWNLOAD_HOSTS,
  CHECKSUMS_ASSET_NAME,
  isAllowedDownloadUrl,
  parseReleaseNotes,
  splitSummary,
  parseSha256Sums,
  normaliseRelease,
  fetchReleaseFeed,
  __test: { stripMarkdown, ARCHIVE_ASSET_RE, PLUGIN_ASSET_RE },
};
