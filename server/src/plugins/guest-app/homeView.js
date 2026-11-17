/**
 * The guest's « Domotique » page, ready to render (specs/guest-app-home-automation.md rules 18, 19, 23, 25, 27-29).
 * Pure: the lodging's blocks, the catalogue, the readings and series the connector holds, the house's last poll, the
 * clock and the language in; every figure rounded and formatted, every phrase written, the bars scaled out. Every
 * number shown is a value Sowel holds (rule 25): nothing here derives one. The client computes nothing.
 */

const { rolesOf, equipmentsOf, LIST_KINDS } = require('./homeRoles');

const MINUTE = 60 * 1000;
const FRESH_MS = 5 * MINUTE;
const LIVE_MS = 2 * MINUTE;
const HIDE_MS = 6 * 60 * MINUTE;
const GRID_BALANCED_W = 5;
const HOUR = 60 * MINUTE;

const WORDS = Object.freeze({
  fr: {
    live: (n) => `il y a ${n} min`,
    lastAt: (at) => `à ${at}`,
    on: 'Allumé',
    off: 'Éteint',
    unknown: 'État inconnu',
    rainToday: (v) => `${v} mm aujourd’hui`,
    noRainToday: 'Pas de pluie aujourd’hui',
    grid: { export: 'Renvoyé au réseau', import: 'Consommé du réseau', balanced: 'Équilibre' },
  },
  en: {
    live: (n) => `${n} min ago`,
    lastAt: (at) => `at ${at}`,
    on: 'On',
    off: 'Off',
    unknown: 'Unknown',
    rainToday: (v) => `${v} mm today`,
    noRainToday: 'No rain today',
    grid: { export: 'Sent to the grid', import: 'Drawn from the grid', balanced: 'Balanced' },
  },
});

const wordsOf = (lang) => WORDS[lang] || WORDS.fr;
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** Rule 19 — `step` rounding and the language's decimal mark; a half-degree drops its « ,0 », a tenth keeps it. */
function number(value, step, lang) {
  const rounded = Math.round(value / step) * step;
  const whole = Number.isInteger(Number(rounded.toFixed(1)));
  const decimals = step >= 1 || (step === 0.5 && whole) ? 0 : 1;
  const text = rounded.toFixed(decimals);
  return lang === 'en' ? text : text.replace('.', ',');
}

function power(watts, lang) {
  if (Math.abs(watts) < 1000) return `${number(watts, 10, lang)} W`;
  return `${number(watts / 1000, 0.1, lang)} kW`;
}

function parisTime(iso, lang) {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso));
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = parts.find((p) => p.type === 'minute').value;
  return lang === 'en' ? `${h}:${m}` : `${h} h ${m}`;
}

/** Rule 27 — the house is live while it long-polled within 2 min: an unchanged value is not an old one. */
const houseLive = (lastPollAt, now) => Boolean(lastPollAt) && now.getTime() - Date.parse(lastPollAt) <= LIVE_MS;

/**
 * Rule 27 — a value Sowel last updated more than 6 h ago is unavailable; otherwise it is fresh while the house is live
 * and stale (muted) while it is silent.
 */
function freshness(reading, now, live = true) {
  if (!reading) return 'unavailable';
  if (now.getTime() - Date.parse(reading.measuredAt) > HIDE_MS) return 'unavailable';
  return live ? 'fresh' : 'stale';
}

const isOn = (value) => value === true || (typeof value === 'string' && /^on$/i.test(value)) || value === 1;
const isOff = (value) => value === false || (typeof value === 'string' && /^off$/i.test(value)) || value === 0;

/** The 24 hourly slots ending with the current hour, scaled 0-1 on their maximum; a missing hour is null. */
function hourly(series, now) {
  const end = Math.floor(now.getTime() / HOUR) * HOUR;
  const byTime = new Map((series ? series.buckets : []).map((b) => [Date.parse(b.time), b.value]));
  const values = Array.from({ length: 24 }, (_, i) => {
    const v = byTime.get(end - (23 - i) * HOUR);
    return isNumber(v) ? v : null;
  });
  const max = Math.max(0, ...values.filter(isNumber));
  return {
    values,
    scaled: values.map((v) => (v === null ? null : (max > 0 ? Number((v / max).toFixed(3)) : 0))),
  };
}

function buildHomeView({ blocks, catalog, readings, series, confirmed = [], lastPollAt = null, now, lang = 'fr' }) {
  const w = wordsOf(lang);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const present = (equipmentId) => Boolean(byId.get(equipmentId)) && !byId.get(equipmentId).goneAt;
  const readingOf = (equipmentId, alias) => readings.find((r) => r.equipmentId === equipmentId && r.alias === alias) || null;
  const seriesOf = (equipmentId, alias) => series.find((s) => s.equipmentId === equipmentId && s.alias === alias) || null;
  const roles = (kind, equipmentId) => rolesOf(kind, byId.get(equipmentId));

  const shown = [];
  const read = (equipmentId, alias) => (alias ? readingOf(equipmentId, alias) : null);
  const live = houseLive(lastPollAt, now);
  const fresh = (r) => freshness(r, now, live);
  const dated = (r) => {
    const state = fresh(r);
    return { state, ...(state === 'stale' && lastPollAt ? { at: w.lastAt(parisTime(lastPollAt, lang)) } : {}) };
  };
  const value = (r, format) => (r && isNumber(r.value) && fresh(r) !== 'unavailable' ? format(r.value) : null);

  blocks.filter((b) => b.on).forEach((block) => {
    if (LIST_KINDS.includes(block.kind)) {
      const items = equipmentsOf(block).filter(({ equipmentId }) => present(equipmentId));
      if (!items.length) return;
      if (block.kind === 'rooms') {
        shown.push({
          kind: 'rooms',
          items: items.map(({ equipmentId, item }) => {
            const r = roles('rooms', equipmentId);
            const t = read(equipmentId, r.temperature);
            const h = read(equipmentId, r.humidity);
            return {
              id: item.id,
              label: item.label,
              temperature: value(t, (v) => number(v, 0.1, lang)),
              min: value(read(equipmentId, r.min), (v) => number(v, 0.1, lang)),
              max: value(read(equipmentId, r.max), (v) => number(v, 0.1, lang)),
              humidity: value(h, (v) => `${number(v, 1, lang)} %`),
              ...dated(t),
            };
          }),
        });
      } else {
        shown.push({
          kind: 'lights',
          items: items.map(({ equipmentId, item }) => {
            // Rule 23 — a switch the house confirmed after its last state reading is the light's state until the
            // next reading: the page never shows the switch going back while the lamp is lit.
            const measured = read(equipmentId, roles('lights', equipmentId).state);
            const done = confirmed.find((c) => c.equipmentId === equipmentId);
            const s = done && (!measured || Date.parse(done.answeredAt) > Date.parse(measured.measuredAt))
              ? { equipmentId, value: done.value, measuredAt: done.answeredAt }
              : measured;
            const usable = s && fresh(s) !== 'unavailable';
            const on = usable && isOn(s.value) ? true : (usable && isOff(s.value) ? false : null);
            return {
              id: item.id,
              label: item.label,
              on,
              status: on === true ? w.on : (on === false ? w.off : w.unknown),
              pilotable: Boolean(item.pilotable) && Boolean(byId.get(equipmentId).guestSwitchable),
              ...dated(s),
            };
          }),
        });
      }
      return;
    }

    if (!present(block.equipmentId)) return;
    const r = roles(block.kind, block.equipmentId);
    if (block.kind === 'outdoor') {
      const t = read(block.equipmentId, r.temperature);
      shown.push({
        kind: 'outdoor',
        temperature: value(t, (v) => number(v, 0.5, lang)),
        min: value(read(block.equipmentId, r.min), (v) => number(v, 0.5, lang)),
        max: value(read(block.equipmentId, r.max), (v) => number(v, 0.5, lang)),
        humidity: value(read(block.equipmentId, r.humidity), (v) => `${number(v, 1, lang)} %`),
        wind: value(read(block.equipmentId, r.wind), (v) => `${number(v, 1, lang)} km/h`),
        ...dated(t),
      });
    } else if (block.kind === 'rain') {
      // Rule 25 — only Sowel's own cumuls: a missing one is omitted, never summed from the bars.
      const today = read(block.equipmentId, r.today);
      const lastHour = read(block.equipmentId, r.lastHour);
      const last24 = read(block.equipmentId, r.last24h);
      const todayMm = today && isNumber(today.value) && fresh(today) !== 'unavailable' ? today.value : null;
      const mm = (v) => `${number(v, 0.1, lang)} mm`;
      shown.push({
        kind: 'rain',
        today: todayMm === null ? null : mm(todayMm),
        lastHour: value(lastHour, mm),
        last24h: value(last24, mm),
        summary: todayMm === null ? null : (todayMm > 0 ? w.rainToday(number(todayMm, 0.1, lang)) : w.noRainToday),
        bars: hourly(seriesOf(block.equipmentId, r.hourly), now).scaled,
        ...dated(lastHour || today || last24),
      });
    } else if (block.kind === 'energy') {
      const p = read(block.equipmentId, r.power);
      const today = read(block.equipmentId, r.today);
      shown.push({
        kind: 'energy',
        power: value(p, (v) => power(v, lang)),
        today: value(today, (v) => `${number(v / 1000, 0.1, lang)} kWh`),
        curve: hourly(seriesOf(block.equipmentId, r.hourly), now).scaled,
        ...dated(p || today),
      });
    } else if (block.kind === 'grid') {
      // Rule 29 — Sowel signs it: negative is sent back to EDF, positive drawn from it. Shown without its sign.
      const p = read(block.equipmentId, r.power);
      const watts = p && isNumber(p.value) && fresh(p) !== 'unavailable' ? p.value : null;
      let direction = null;
      if (watts !== null) direction = Math.abs(watts) < GRID_BALANCED_W ? 'balanced' : (watts < 0 ? 'export' : 'import');
      shown.push({
        kind: 'grid',
        power: direction === null ? null : (direction === 'balanced' ? power(0, lang) : power(Math.abs(watts), lang)),
        direction,
        label: direction === null ? null : w.grid[direction],
        ...dated(p),
      });
    }
  });

  // The hero's rain sentence comes from the rain block when both are shown.
  const outdoor = shown.find((b) => b.kind === 'outdoor');
  const rain = shown.find((b) => b.kind === 'rain');
  if (outdoor && rain && rain.summary) outdoor.rain = rain.summary;

  const silentFor = lastPollAt ? now.getTime() - Date.parse(lastPollAt) : Infinity;
  let updated = null;
  if (live) updated = w.live(Math.max(1, Math.round(silentFor / MINUTE)));
  else if (lastPollAt) updated = w.lastAt(parisTime(lastPollAt, lang));
  return {
    live,
    updated,
    blocks: shown,
  };
}

module.exports = { buildHomeView, number, power, freshness, houseLive, hourly, FRESH_MS, LIVE_MS, HIDE_MS };
