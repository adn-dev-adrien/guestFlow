/**
 * Thin HTTP client for the data.education.gouv.fr "fr-en-calendrier-scolaire" dataset.
 *
 * Returns raw API records. Filtering happens server-side via the `where` clause.
 * Isolated from the sync engine so tests can stub fetch cleanly.
 *
 * Dataset: https://data.education.gouv.fr/explore/dataset/fr-en-calendrier-scolaire/
 */

const DATASET_URL = 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records';
const DEFAULT_TIMEOUT_MS = 30000;
const PAGE_LIMIT = 100;

function buildIsoEnd(horizonMonths, now = new Date()) {
  const d = new Date(now.getTime());
  d.setMonth(d.getMonth() + horizonMonths);
  return d.toISOString().slice(0, 10);
}

function buildUrl({ horizonMonths, now = new Date(), offset = 0 }) {
  const todayIso = now.toISOString().slice(0, 10);
  const endIso = buildIsoEnd(horizonMonths, now);
  // Overlap filter: any holiday whose interval intersects [today, today+horizon].
  const where = `population="Élèves" AND end_date >= date'${todayIso}' AND start_date <= date'${endIso}' AND (zones="Zone A" OR zones="Zone B" OR zones="Zone C")`;
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT), offset: String(offset), where });
  return `${DATASET_URL}?${params.toString()}`;
}

async function fetchOfficialHolidays({ horizonMonths, fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, now = new Date() }) {
  if (!Number.isInteger(horizonMonths) || horizonMonths < 1) {
    throw new Error('horizonMonths invalide');
  }

  const all = [];
  let offset = 0;
  // Loop in case the dataset returns more than PAGE_LIMIT records.
  while (true) {
    const url = buildUrl({ horizonMonths, now, offset });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let body;
    try {
      const response = await fetchFn(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} sur data.education.gouv.fr`);
      }
      body = await response.json();
    } finally {
      clearTimeout(timer);
    }
    const records = Array.isArray(body?.results) ? body.results : [];
    all.push(...records);
    if (records.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
    if (offset > 5000) break; // hard safety stop, never reached in practice
  }
  return all;
}

module.exports = { fetchOfficialHolidays, buildUrl, DATASET_URL };
