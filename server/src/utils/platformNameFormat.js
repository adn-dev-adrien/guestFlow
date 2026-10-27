/**
 * Platform name canonical form — `formatPlatformName(input)`.
 *
 * Reduces a free-form platform string to a single canonical UpperCamelCase shape so the
 * `platforms` UNIQUE(name) constraint deduplicates case-different inputs (`gitedefrance` and
 * `Gitedefrance` both → `Gitedefrance`). Applied at every write site that lands a value in
 * `ical_sources.platformLabel`, `reservations.platform`, or `platforms.name`.
 *
 * Algorithm (spec: specs/normalize-platform-names.md §3.1):
 *   1. `null` / `undefined` → `null` (= "no platform on this write, leave the column alone").
 *   2. The `direct` enum value (case-insensitive) is preserved as lowercase `'direct'` — strict
 *      equality checks against `'direct'` in the codebase (accountingExport, accountingModel,
 *      SQL filters) keep working.
 *   3. NFD-strip diacritics (`Gîtes` → `Gites`).
 *   4. Split on every non-alphanumeric character (whitespace, hyphen, underscore, punctuation).
 *      Drop empty segments.
 *   5. Each segment: first letter uppercase, remaining letters lowercase.
 *   6. Concatenate without separator.
 *   7. Empty result → `''` (caller decides whether to ignore or 400).
 *
 * The formatter is a mechanical case-normalizer, NOT a spell-checker — typos like `logify`
 * survive as `Logify`. Operator cleans these up manually from the dedicated config page.
 */

function formatPlatformName(input) {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return '';
  // `direct` is enum-like — preserve lowercase so the codebase's strict equality checks against
  // 'direct' (accountingExport.js, accountingModel.js, SQL filters in database.js) keep working.
  if (raw.toLowerCase() === 'direct') return 'direct';
  // NFD-strip diacritics: `Gîtes` → `Gites`, `Hôtel` → `Hotel`.
  const stripped = raw.normalize('NFD').replace(/\p{M}/gu, '');
  // Split on:
  //   - every non-alphanumeric character (whitespace, hyphen, underscore, punctuation), AND
  //   - every camelCase boundary (lowercase/digit → Uppercase), so the formatter is idempotent
  //     on its own output: `GitesDeFrance` re-splits back into `[Gites, De, France]`. Without
  //     this, the second pass would collapse to `Gitesdefrance` (word-boundary info lost).
  const withBoundaries = stripped.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const segments = withBoundaries.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (segments.length === 0) return '';
  return segments
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase())
    .join('');
}

/**
 * Own-channel platforms — `isDirectChannel(platform)`.
 *
 * A booking is « direct » in the commercial sense when the guest relationship is the operator's own,
 * with no OTA in between: `direct` (created by hand in GuestFlow), plus every platform the operator
 * marked « Compté comme vente directe » — the booking engine of the operator's own website, whose fee
 * is not a marketplace commission (specs/plugins-phase-p-productisation.md rule 19).
 *
 * Used by the welcome pack (specs/tariff-recipes/spec.md §3.9 rule 53) and every read that tells a
 * direct booking from a platform one. Never compare a platform to `'direct'` by hand.
 */
let directChannels = new Set(['direct']);

const channelKey = (platform) => String(platform ?? 'direct').trim().toLowerCase() || 'direct';

function isDirectChannel(platform) {
  return directChannels.has(channelKey(platform));
}

/** `direct` always, plus the platforms named here (specs/plugins-phase-p-productisation.md rule 19). */
function setDirectChannels(names = []) {
  directChannels = new Set(['direct', ...names.map(channelKey)]);
}

/** Re-reads `platforms.countsAsDirect`: at boot and after every platform save. */
function refreshDirectChannels(database) {
  let names = [];
  try {
    names = database.prepare('SELECT name FROM platforms WHERE countsAsDirect = 1').all().map((r) => r.name);
  } catch {
    names = [];
  }
  setDirectChannels(names);
}

/**
 * `is_direct_channel(platform)` for the SQL reads that filter on it, so they follow the same set as
 * `isDirectChannel` instead of a list frozen when the module loaded. Idempotent per connection.
 */
function registerDirectChannelSql(database) {
  if (!database || typeof database.function !== 'function' || database.__directChannelSql) return;
  database.function('is_direct_channel', { deterministic: false }, (platform) => (isDirectChannel(platform) ? 1 : 0));
  Object.defineProperty(database, '__directChannelSql', { value: true });
}

/**
 * Channels that forbid checkout chores — `isChoreFreeChannel(platform)`.
 *
 * Some platforms forbid asking their guests for any checkout chore (dishes, trash, « leave it as you
 * found it ») and billing an undone one: Airbnb does. The operator ticks « Sans corvées de départ » on
 * such a platform (`platforms.forbidsGuestChores`); the SAS and the guest e-mails then read this set
 * instead of a platform name (specs/airbnb-no-checkout-chores.md rule 8).
 */
let choreFreeChannels = new Set();

function isChoreFreeChannel(platform) {
  return choreFreeChannels.has(channelKey(platform));
}

function setChoreFreeChannels(names = []) {
  choreFreeChannels = new Set(names.map(channelKey));
}

/**
 * Re-reads `platforms.forbidsGuestChores`: at boot and after every platform save. An own channel never
 * counts, whatever it stored: the settings page shows it no switch to untick.
 */
function refreshChoreFreeChannels(database) {
  let names = [];
  try {
    names = database.prepare('SELECT name FROM platforms WHERE forbidsGuestChores = 1').all()
      .map((r) => r.name).filter((name) => !isDirectChannel(name));
  } catch {
    names = [];
  }
  setChoreFreeChannels(names);
}

/**
 * Channels that relay the guest's e-mail — `isRelayChannel(platform)`.
 *
 * Some platforms hand out a relay address instead of the guest's own: nothing sent there after the
 * stay reaches anyone who asked for it. The operator ticks « Adresse e-mail relais » on such a platform
 * (`platforms.relaysGuestEmail`) and the guest e-mail sequence reads this set instead of a platform
 * name (specs/platform-settings-relay-and-review.md rules 1-2).
 */
let relayChannels = new Set();

function isRelayChannel(platform) {
  return relayChannels.has(channelKey(platform));
}

function setRelayChannels(names = []) {
  relayChannels = new Set(names.map(channelKey));
}

/**
 * Where a platform's guests leave a review — `platformReviewWhere(platform, lang)`, as the J+1 e-mail
 * words it (`platforms.reviewWhereFr` / `reviewWhereEn`, specs/platform-settings-relay-and-review.md
 * rules 3-4). '' when the operator wrote nothing; an empty English answers the French.
 */
let reviewWhere = new Map();

function platformReviewWhere(platform, lang = 'fr') {
  const entry = reviewWhere.get(channelKey(platform));
  if (!entry) return '';
  return (lang === 'en' && entry.en) ? entry.en : entry.fr;
}

/** `{ [platformName]: { fr, en } }`. */
function setPlatformReviewWhere(map = {}) {
  reviewWhere = new Map(Object.entries(map)
    .map(([name, v]) => [channelKey(name), { fr: String((v && v.fr) || '').trim(), en: String((v && v.en) || '').trim() }])
    .filter(([, v]) => v.fr || v.en)
    .map(([key, v]) => [key, { fr: v.fr || v.en, en: v.en }]));
}

/**
 * Re-reads both guest-contact settings: at boot and after every platform save. An own channel never
 * counts, whatever it stored: the settings page shows it neither the switch nor the wording.
 */
function refreshGuestContactChannels(database) {
  let rows = [];
  try {
    rows = database.prepare('SELECT name, relaysGuestEmail, reviewWhereFr, reviewWhereEn FROM platforms').all()
      .filter((r) => !isDirectChannel(r.name));
  } catch {
    rows = [];
  }
  setRelayChannels(rows.filter((r) => Number(r.relaysGuestEmail) === 1).map((r) => r.name));
  setPlatformReviewWhere(Object.fromEntries(rows.map((r) => [r.name, { fr: r.reviewWhereFr, en: r.reviewWhereEn }])));
}

module.exports = {
  formatPlatformName, isDirectChannel, setDirectChannels, refreshDirectChannels, registerDirectChannelSql,
  isChoreFreeChannel, setChoreFreeChannels, refreshChoreFreeChannels,
  isRelayChannel, setRelayChannels, platformReviewWhere, setPlatformReviewWhere, refreshGuestContactChannels,
};

