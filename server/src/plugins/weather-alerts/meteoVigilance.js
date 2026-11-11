/**
 * Météo-France Vigilance integration (specs/checkin-weather-alerts.md §4.1).
 *
 * Turns the domain address into a French département, fetches the current DPVigilance "carte"
 * for that département, and shapes the qualifying alerts (Orange/Red overlapping the stay) into
 * ready-to-render French objects. All the display/business logic lives here (fat backend): the
 * client only renders the returned array.
 *
 * Pure helpers (unit-tested): extractDepartmentFromCitycode, normalizeVigilance,
 * filterAlertsForStay, buildAlertDisplay, frTimingLabel.
 * I/O helpers: geocodeDepartment (IGN Géoplateforme), fetchVigilanceRaw (Météo-France),
 * getVigilanceForDepartment (cache-aware orchestration).
 */

const labels = require('./meteoVigilanceLabels');

// Orange is the lowest qualifying level (rule 5a). Red = 4.
const VIGILANCE_ORANGE = 3;
// Cache freshness window — well under the ~twice-daily vigilance update cadence (rule 9 / §9).
const VIGILANCE_TTL_MINUTES = 30;

const GEOCODE_URL = 'https://data.geopf.fr/geocodage/search';
const VIGILANCE_CARTE_URL = 'https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours';
const FETCH_TIMEOUT_MS = 8000;

// In-memory geocode cache (address string → département code). Cheap to rebuild on restart; the
// address rarely changes, so this avoids re-hitting the geocoder on every check-in open.
const geocodeCache = new Map();

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * INSEE citycode → département code. Metropolitan = first 2 chars ("83004" → "83"); Corsica keeps
 * its "2A"/"2B" prefix ("2A004" → "2A"); overseas départements are 3 digits ("97411" → "974").
 */
function extractDepartmentFromCitycode(citycode) {
  const code = String(citycode || '').trim();
  if (!code) return null;
  if (/^2[AB]/i.test(code)) return code.slice(0, 2).toUpperCase();
  if (/^9[78]/.test(code)) return code.slice(0, 3);
  if (code.length >= 2) return code.slice(0, 2);
  return null;
}

/**
 * Flatten the DPVigilance "carte" payload into a flat list of {phenomenonId, colorLevel, startsAt,
 * endsAt} slices for a single département. Defensive against missing keys (partial payloads).
 * Structure: product.periods[].timelaps.domain_ids[]{domain_id, phenomenon_items[]{phenomenon_id,
 * timelaps_items[]{begin_time, end_time, color_id}}}.
 */
function normalizeVigilance(raw, departmentCode) {
  const dept = String(departmentCode || '').trim().toUpperCase();
  const periods = raw && raw.product && Array.isArray(raw.product.periods) ? raw.product.periods : [];
  const out = [];
  for (const period of periods) {
    const domains = period && period.timelaps && Array.isArray(period.timelaps.domain_ids)
      ? period.timelaps.domain_ids : [];
    for (const domain of domains) {
      if (String(domain.domain_id || '').trim().toUpperCase() !== dept) continue;
      const items = Array.isArray(domain.phenomenon_items) ? domain.phenomenon_items : [];
      for (const ph of items) {
        const phenomenonId = Number(ph.phenomenon_id);
        const slices = Array.isArray(ph.timelaps_items) ? ph.timelaps_items : [];
        for (const s of slices) {
          const colorLevel = Number(s.color_id);
          if (!phenomenonId || !colorLevel || !s.begin_time || !s.end_time) continue;
          out.push({
            phenomenonId,
            colorLevel,
            startsAt: s.begin_time,
            endsAt: s.end_time,
          });
        }
      }
    }
  }
  return out;
}

// Overlap test between [aStart,aEnd] and [bStart,bEnd] on ISO timestamps.
function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart).getTime() <= new Date(bEnd).getTime()
    && new Date(aEnd).getTime() >= new Date(bStart).getTime();
}

/**
 * Keep only slices at/above the threshold colour whose window overlaps the stay, then collapse them
 * per phenomenon into one entry carrying the max colour and the window CLIPPED to the stay (so the
 * displayed timing is « the part of the alert that falls within the stay » — rules 5, 6).
 * @param stay { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
 */
function filterAlertsForStay(phenomena, { start, end, threshold = VIGILANCE_ORANGE } = {}) {
  const stayStart = `${String(start).slice(0, 10)}T00:00:00`;
  const stayEnd = `${String(end).slice(0, 10)}T23:59:59`;
  const stayStartMs = new Date(stayStart).getTime();
  const stayEndMs = new Date(stayEnd).getTime();

  const byPhenomenon = new Map();
  for (const item of phenomena || []) {
    if (Number(item.colorLevel) < threshold) continue;
    if (!overlaps(item.startsAt, item.endsAt, stayStart, stayEnd)) continue;

    // Clip the window to the stay.
    const clippedStart = Math.max(new Date(item.startsAt).getTime(), stayStartMs);
    const clippedEnd = Math.min(new Date(item.endsAt).getTime(), stayEndMs);

    const key = item.phenomenonId;
    const existing = byPhenomenon.get(key);
    if (!existing) {
      byPhenomenon.set(key, {
        phenomenonId: key,
        colorLevel: item.colorLevel,
        startMs: clippedStart,
        endMs: clippedEnd,
      });
    } else {
      existing.colorLevel = Math.max(existing.colorLevel, item.colorLevel);
      existing.startMs = Math.min(existing.startMs, clippedStart);
      existing.endMs = Math.max(existing.endMs, clippedEnd);
    }
  }

  return Array.from(byPhenomenon.values())
    // Red first, then earliest start.
    .sort((a, b) => (b.colorLevel - a.colorLevel) || (a.startMs - b.startMs))
    .map((x) => ({
      phenomenonId: x.phenomenonId,
      colorLevel: x.colorLevel,
      startsAt: new Date(x.startMs).toISOString(),
      endsAt: new Date(x.endMs).toISOString(),
    }));
}

const FR_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const FR_TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

// « du 2 juillet à 12:00 au 4 juillet à 22:00 » (Europe/Paris), or « le 2 juillet de 12:00 à 22:00 »
// when the alert starts and ends on the same day.
function frTimingLabel(startsAt, endsAt) {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
  const sDate = FR_DATE.format(s);
  const eDate = FR_DATE.format(e);
  const sTime = FR_TIME.format(s);
  const eTime = FR_TIME.format(e);
  if (sDate === eDate) return `le ${sDate} de ${sTime} à ${eTime}`;
  return `du ${sDate} à ${sTime} au ${eDate} à ${eTime}`;
}

/**
 * Turn a filtered {phenomenonId, colorLevel, startsAt, endsAt} entry into the display object the SAS
 * page renders. Synthesizes a French summary + appends the phenomenon-specific instructions; for
 * orages the exact timing is spelled out in an instruction line too (rule 7).
 */
function buildAlertDisplay(entry) {
  const phenomenon = labels.phenomenonLabel(entry.phenomenonId);
  const color = labels.colorLabel(entry.colorLevel);
  const timingLabel = frTimingLabel(entry.startsAt, entry.endsAt);
  const message = `Vigilance ${color.toLowerCase()} « ${phenomenon} » en cours pour votre secteur ${timingLabel}.`;

  const instructions = labels.staticInstructionsFor(entry.phenomenonId);
  if (Number(entry.phenomenonId) === 3 && timingLabel) {
    // Orages: lead with the explicit episode timing during the stay.
    instructions.unshift(`Épisode orageux prévu ${timingLabel}.`);
  }

  return {
    phenomenonId: entry.phenomenonId,
    phenomenon,
    colorLevel: entry.colorLevel,
    color,
    startsAt: entry.startsAt,
    endsAt: entry.endsAt,
    timingLabel,
    message,
    instructions,
  };
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`HTTP_${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Geocode a free-text address to a département code via the IGN Géoplateforme geocoder (the BAN
 * api-adresse endpoint was decommissioned end of Jan 2026). Returns null on empty address / no
 * match / network error. Memoized in-process by address string.
 */
async function geocodeDepartment(address) {
  const q = String(address || '').trim().replace(/\s+/g, ' ');
  if (!q) return null;
  if (geocodeCache.has(q)) return geocodeCache.get(q);

  try {
    const url = `${GEOCODE_URL}?q=${encodeURIComponent(q)}&limit=1&index=address`;
    const data = await fetchJson(url);
    const feature = data && Array.isArray(data.features) ? data.features[0] : null;
    const props = feature && feature.properties ? feature.properties : null;
    let dept = null;
    if (props) {
      dept = extractDepartmentFromCitycode(props.citycode);
      // Fallback: the `context` string starts with the département code ("83, Var, PACA").
      if (!dept && props.context) {
        const first = String(props.context).split(',')[0].trim();
        if (first) dept = first.toUpperCase();
      }
    }
    geocodeCache.set(q, dept);
    return dept;
  } catch (_) {
    return null;
  }
}

async function fetchVigilanceRaw(apiKey) {
  return fetchJson(VIGILANCE_CARTE_URL, { headers: { apikey: String(apiKey || '') } });
}

// Test seam: clear the in-memory geocode cache.
function _resetGeocodeCache() {
  geocodeCache.clear();
}

/**
 * Cache-aware vigilance fetch for one département. Returns the normalized phenomena slices.
 *   - Fresh cache (< TTL) → returned as-is (no network).
 *   - Stale/missing → fetch + normalize + upsert; on fetch failure, fall back to the stale cache
 *     (if any), else [].
 * @param cacheModel weatherCacheModel instance ({ readFresh, read, upsert })
 * @param nowMs current epoch ms (injectable for tests)
 */
async function getVigilanceForDepartment(departmentCode, apiKey, cacheModel, nowMs = Date.now()) {
  const dept = String(departmentCode || '').trim().toUpperCase();
  if (!dept || !apiKey) return [];

  const fresh = cacheModel.readFresh(dept, VIGILANCE_TTL_MINUTES, nowMs);
  if (fresh) return fresh.payload;

  try {
    const raw = await fetchVigilanceRaw(apiKey);
    const phenomena = normalizeVigilance(raw, dept);
    cacheModel.upsert(dept, phenomena, nowMs);
    return phenomena;
  } catch (_) {
    const stale = cacheModel.read(dept);
    return stale ? stale.payload : [];
  }
}

module.exports = {
  VIGILANCE_ORANGE,
  VIGILANCE_TTL_MINUTES,
  extractDepartmentFromCitycode,
  normalizeVigilance,
  filterAlertsForStay,
  frTimingLabel,
  buildAlertDisplay,
  geocodeDepartment,
  fetchVigilanceRaw,
  getVigilanceForDepartment,
  _resetGeocodeCache,
};
