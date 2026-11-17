/**
 * The shapes the house may send on `/public/v1/home` (specs/guest-app-home-automation.md §4.3), checked field by
 * field. Pure: a payload in, `{ ok: true, value }` or `{ ok: false, field, message }` out. A single bad field refuses
 * the whole call — nothing is half-stored.
 */

const LIGHT_TYPES = Object.freeze(['light_onoff', 'light_dimmable', 'light_color', 'switch']);
const CATALOG_TYPES = Object.freeze(['sensor', 'thermostat', 'weather', 'energy_meter', 'main_energy_meter', ...LIGHT_TYPES]);
const MAX_EQUIPMENTS = 500;
const MAX_READINGS = 2000;
const MAX_BUCKETS = 24;

const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const ALIAS_RE = /^[A-Za-z0-9_.-]{1,60}$/;

const fail = (field, message) => ({ ok: false, field, message });
const isText = (v, max, { empty = false } = {}) => typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0);
const isIso = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const isValue = (v) => v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || isText(v, 40, { empty: true });

function parseCatalog(body) {
  const list = body && body.equipments;
  if (!Array.isArray(list) || list.length > MAX_EQUIPMENTS) return fail('equipments', `Une liste de ${MAX_EQUIPMENTS} équipements au plus est attendue.`);
  const seen = new Set();
  for (let i = 0; i < list.length; i += 1) {
    const e = list[i];
    const at = `equipments.${i}`;
    if (!e || typeof e !== 'object') return fail(at, 'Équipement invalide.');
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) return fail(`${at}.id`, 'Identifiant invalide.');
    if (seen.has(e.id)) return fail(`${at}.id`, 'Identifiant en double.');
    seen.add(e.id);
    if (!isText(e.name, 120)) return fail(`${at}.name`, 'Nom invalide.');
    if (!isText(e.zonePath, 200, { empty: true })) return fail(`${at}.zonePath`, 'Zone invalide.');
    if (!CATALOG_TYPES.includes(e.type)) return fail(`${at}.type`, 'Type non décrit.');
    if (e.guestSwitchable !== undefined && typeof e.guestSwitchable !== 'boolean') return fail(`${at}.guestSwitchable`, 'Booléen attendu.');
    if (e.guestSwitchable && !LIGHT_TYPES.includes(e.type)) return fail(`${at}.guestSwitchable`, 'Seule une lumière peut être confiée aux voyageurs.');
    if (!Array.isArray(e.readings) || e.readings.length > 40) return fail(`${at}.readings`, 'Liste de mesures invalide.');
    for (let j = 0; j < e.readings.length; j += 1) {
      const r = e.readings[j];
      const rAt = `${at}.readings.${j}`;
      if (!r || typeof r.alias !== 'string' || !ALIAS_RE.test(r.alias)) return fail(`${rAt}.alias`, 'Alias invalide.');
      if (!isText(r.category, 60)) return fail(`${rAt}.category`, 'Catégorie invalide.');
      if (r.unit != null && !isText(r.unit, 16, { empty: true })) return fail(`${rAt}.unit`, 'Unité invalide.');
    }
  }
  return {
    ok: true,
    value: list.map((e) => ({
      id: e.id,
      name: e.name.trim(),
      zonePath: e.zonePath.trim(),
      type: e.type,
      guestSwitchable: Boolean(e.guestSwitchable),
      readings: e.readings.map((r) => ({ alias: r.alias, category: r.category, unit: r.unit == null ? null : r.unit })),
    })),
  };
}

function parseReadings(body) {
  const list = body && body.readings;
  if (!Array.isArray(list) || list.length > MAX_READINGS) return fail('readings', 'Liste de mesures invalide.');
  for (let i = 0; i < list.length; i += 1) {
    const r = list[i];
    const at = `readings.${i}`;
    if (!r || typeof r.equipmentId !== 'string' || !ID_RE.test(r.equipmentId)) return fail(`${at}.equipmentId`, 'Identifiant invalide.');
    if (typeof r.alias !== 'string' || !ALIAS_RE.test(r.alias)) return fail(`${at}.alias`, 'Alias invalide.');
    if (!isValue(r.value)) return fail(`${at}.value`, 'Valeur invalide.');
    if (r.unit != null && !isText(r.unit, 16, { empty: true })) return fail(`${at}.unit`, 'Unité invalide.');
    if (!isIso(r.measuredAt)) return fail(`${at}.measuredAt`, 'Date invalide.');
  }
  return {
    ok: true,
    value: list.map((r) => ({
      equipmentId: r.equipmentId,
      alias: r.alias,
      value: r.value,
      unit: r.unit == null ? null : r.unit,
      measuredAt: new Date(r.measuredAt).toISOString(),
    })),
  };
}

function parseSeries(body) {
  const list = body && body.series;
  if (!Array.isArray(list) || list.length > 200) return fail('series', 'Liste de séries invalide.');
  for (let i = 0; i < list.length; i += 1) {
    const s = list[i];
    const at = `series.${i}`;
    if (!s || typeof s.equipmentId !== 'string' || !ID_RE.test(s.equipmentId)) return fail(`${at}.equipmentId`, 'Identifiant invalide.');
    if (typeof s.alias !== 'string' || !ALIAS_RE.test(s.alias)) return fail(`${at}.alias`, 'Alias invalide.');
    if (!Array.isArray(s.buckets) || s.buckets.length > MAX_BUCKETS) return fail(`${at}.buckets`, `${MAX_BUCKETS} tranches au plus.`);
    for (let j = 0; j < s.buckets.length; j += 1) {
      const b = s.buckets[j];
      if (!b || !isIso(b.time)) return fail(`${at}.buckets.${j}.time`, 'Date invalide.');
      if (typeof b.value !== 'number' || !Number.isFinite(b.value) || b.value < 0) return fail(`${at}.buckets.${j}.value`, 'Valeur positive attendue.');
    }
  }
  return {
    ok: true,
    value: list.map((s) => ({
      equipmentId: s.equipmentId,
      alias: s.alias,
      buckets: s.buckets
        .map((b) => ({ time: new Date(b.time).toISOString(), value: b.value }))
        .sort((a, b) => a.time.localeCompare(b.time)),
    })),
  };
}

const REASON_RE = /^[a-z_]{1,40}$/;

function parseResults(body) {
  const list = body && body.results;
  if (!Array.isArray(list) || list.length > 200) return fail('results', 'Liste de résultats invalide.');
  for (let i = 0; i < list.length; i += 1) {
    const r = list[i];
    const at = `results.${i}`;
    if (!r || !Number.isInteger(r.id) || r.id <= 0) return fail(`${at}.id`, 'Identifiant invalide.');
    if (typeof r.ok !== 'boolean') return fail(`${at}.ok`, 'Booléen attendu.');
    if (r.reason != null && (typeof r.reason !== 'string' || !REASON_RE.test(r.reason))) return fail(`${at}.reason`, 'Raison invalide.');
  }
  return { ok: true, value: list.map((r) => ({ id: r.id, ok: r.ok, reason: r.reason || null })) };
}

module.exports = { parseCatalog, parseReadings, parseSeries, parseResults, LIGHT_TYPES, CATALOG_TYPES };
