/**
 * The one activity suggestion of the home (specs/guest-app.md rule 15bis). Soliomap's `GET /api/activities` is
 * read over outbound HTTPS through the core's public-only fetch (the URL is a setting), kept an hour, given 5 s;
 * any failure is « no suggestion », remembered a few minutes so a Soliomap that is down does not slow every home.
 * The choice itself is pure: the feed, the session and the instant come in, one card or null goes out.
 */

const sdk = require('../sdk');

const CACHE_MS = 60 * 60 * 1000;
const FAILURE_CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 5000;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
// From 14 h the rest of today is too short to plan an outing: the suggestion counts from tomorrow.
const CUT_OFF_HOUR = 14;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCALE = Object.freeze({ fr: 'fr-FR', en: 'en-GB' });

const parisParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

function parisDay(at) {
  const parts = Object.fromEntries(parisParts.formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function addDays(ymd, days) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** « sam. 7 nov. » / « Sat 7 Nov ». */
function dayLabel(ymd, lang) {
  return new Intl.DateTimeFormat(LOCALE[lang], { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(`${ymd}T12:00:00Z`));
}

function dateLabel(event, lang) {
  if (event.startsOn === event.endsOn) return dayLabel(event.startsOn, lang);
  return lang === 'en' ? `until ${dayLabel(event.endsOn, lang)}` : `jusqu’au ${dayLabel(event.endsOn, lang)}`;
}

/** « 8 min en voiture », « 1 h 05 en voiture » — Soliomap's own estimate. */
function driveLabel(minutes, lang) {
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  const n = Math.round(minutes);
  const time = n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${String(n % 60).padStart(2, '0')}` : ''}`;
  return lang === 'en' ? `${time} drive` : `${time} en voiture`;
}

const isEvent = (a) => a && typeof a === 'object' && typeof a.id === 'string' && a.id && typeof a.name === 'string'
  && ISO_DAY.test(String(a.startsOn)) && ISO_DAY.test(String(a.endsOn)) && a.startsOn <= a.endsOn;

const driveOf = (a) => (Number.isFinite(a.driveMinutes) ? a.driveMinutes : Infinity);

/**
 * Rule 15bis — the days still to come during the stay: from today (from tomorrow once 14 h is past; from the
 * arrival day for a pre-arrival session) to the eve of the departure day. → { from, to } or null.
 */
function stayDays({ mode, stay, now }) {
  const today = parisDay(now);
  const from = mode === 'preArrival'
    ? stay.startDate
    : (today.hour >= CUT_OFF_HOUR ? addDays(today.date, 1) : today.date);
  const to = addDays(stay.endDate, -1);
  return from <= to ? { from, to, today: today.date } : null;
}

/**
 * The suggestion of a session, or null: a stay or pre-arrival session only; among the events overlapping the
 * days left whose `visibleFrom` is reached, the nearest by car, then the soonest.
 */
function pickSuggestion(activities, { mode, stay, now, lang = 'fr', soliomapUrl }) {
  if (!Array.isArray(activities) || !stay || !soliomapUrl || !['stay', 'preArrival'].includes(mode)) return null;
  const days = stayDays({ mode, stay, now });
  if (!days) return null;
  const candidates = activities.filter((a) => isEvent(a)
    && a.startsOn <= days.to && a.endsOn >= days.from
    && (!a.visibleFrom || String(a.visibleFrom) <= days.today));
  if (!candidates.length) return null;
  const [best] = candidates.sort((a, b) => driveOf(a) - driveOf(b)
    || a.startsOn.localeCompare(b.startsOn)
    || a.id.localeCompare(b.id));
  return {
    id: best.id,
    name: best.name,
    category: typeof best.category === 'string' ? best.category : null,
    dateLabel: dateLabel(best, lang),
    driveLabel: driveLabel(best.driveMinutes, lang),
    url: `${String(soliomapUrl).replace(/\/+$/, '')}/#${encodeURIComponent(best.id)}`,
  };
}

/** The production read: public addresses only, the body capped, JSON. */
async function fetchActivities(url, { signal }) {
  const { fetchPublic, readCapped } = sdk.coreModule('safeFeedFetch');
  const response = await fetchPublic(url, { signal });
  try {
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return JSON.parse(await readCapped(response, MAX_FEED_BYTES));
  } finally {
    await response.release();
  }
}

/** `fetchFeed(url, { signal })` resolves to Soliomap's payload; tests hand their own. */
function createSoliomapFeed({
  url, fetchFeed = fetchActivities, now = () => new Date(), timeoutMs = TIMEOUT_MS,
}) {
  let cached = null;
  let inFlight = null;

  async function load(feedUrl) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); });
    try {
      const body = await Promise.race([fetchFeed(`${feedUrl.replace(/\/+$/, '')}/api/activities`, { signal: controller.signal }), timeout]);
      return body && Array.isArray(body.activities) ? body.activities : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The feed's activities, or null when Soliomap could not be read. */
  async function activities() {
    const feedUrl = url();
    if (!feedUrl) return null;
    const at = now().getTime();
    if (cached && cached.url === feedUrl && at < cached.until) return cached.activities;
    if (!inFlight) {
      inFlight = load(feedUrl).then((list) => {
        cached = { url: feedUrl, activities: list, until: now().getTime() + (list ? CACHE_MS : FAILURE_CACHE_MS) };
        return list;
      }).finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  return { activities };
}

module.exports = {
  CACHE_MS, FAILURE_CACHE_MS, TIMEOUT_MS, createSoliomapFeed, pickSuggestion,
};
