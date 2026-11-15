/**
 * The guest's « Domotique » page, ready to render (specs/guest-app-home-automation.md rules 18-20, 23). Pure: the
 * lodging's blocks, the catalogue, the readings and series the connector holds, the clock and the language in; every
 * figure rounded and formatted, every phrase written, the bars scaled out. The client computes nothing.
 */

const { rolesOf, equipmentsOf, LIST_KINDS } = require('./homeRoles');

const MINUTE = 60 * 1000;
const FRESH_MS = 5 * MINUTE;
const HIDE_MS = 6 * 60 * MINUTE;
const TREND_MS = 25 * MINUTE;
const TREND_FLAT = 0.3;
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
  },
  en: {
    live: (n) => `${n} min ago`,
    lastAt: (at) => `at ${at}`,
    on: 'On',
    off: 'Off',
    unknown: 'Unknown',
    rainToday: (v) => `${v} mm today`,
    noRainToday: 'No rain today',
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

const parisDay = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(date);

/** Rule 20 — fresh under 5 min, stale (muted, dated) up to 6 h, unavailable beyond. */
function freshness(reading, now) {
  if (!reading) return 'unavailable';
  const age = now.getTime() - Date.parse(reading.measuredAt);
  if (age <= FRESH_MS) return 'fresh';
  if (age <= HIDE_MS) return 'stale';
  return 'unavailable';
}

/** Rule 18 — up / down / flat against the latest sample at least 25 min older; null without one. */
function trendOf(reading) {
  if (!reading || !isNumber(reading.value)) return null;
  const nowMs = Date.parse(reading.measuredAt);
  const past = (reading.samples || []).filter((s) => nowMs - Date.parse(s.at) >= TREND_MS).pop();
  if (!past) return null;
  const diff = reading.value - past.value;
  if (Math.abs(diff) < TREND_FLAT) return 'flat';
  return diff > 0 ? 'up' : 'down';
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

function buildHomeView({ blocks, catalog, readings, series, now, lang = 'fr' }) {
  const w = wordsOf(lang);
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const present = (equipmentId) => Boolean(byId.get(equipmentId)) && !byId.get(equipmentId).goneAt;
  const readingOf = (equipmentId, alias) => readings.find((r) => r.equipmentId === equipmentId && r.alias === alias) || null;
  const seriesOf = (equipmentId, alias) => series.find((s) => s.equipmentId === equipmentId && s.alias === alias) || null;
  const roles = (kind, equipmentId) => rolesOf(kind, byId.get(equipmentId));

  const shown = [];
  const used = [];
  const read = (equipmentId, alias) => {
    const r = alias ? readingOf(equipmentId, alias) : null;
    if (r) used.push(r);
    return r;
  };
  const dated = (r) => {
    const state = freshness(r, now);
    return { state, ...(state === 'stale' ? { at: w.lastAt(parisTime(r.measuredAt, lang)) } : {}) };
  };
  const value = (r, format) => (r && isNumber(r.value) && freshness(r, now) !== 'unavailable' ? format(r.value) : null);

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
              trend: freshness(t, now) === 'unavailable' ? null : trendOf(t),
              humidity: value(h, (v) => `${number(v, 1, lang)} %`),
              ...dated(t),
            };
          }),
        });
      } else {
        shown.push({
          kind: 'lights',
          items: items.map(({ equipmentId, item }) => {
            const s = read(equipmentId, roles('lights', equipmentId).state);
            const usable = s && freshness(s, now) !== 'unavailable';
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
      const bars = hourly(seriesOf(block.equipmentId, r.hourly), now);
      const today = read(block.equipmentId, r.today);
      const last24 = read(block.equipmentId, r.last24h);
      const lastHour = read(block.equipmentId, r.lastHour);
      const todayParis = parisDay(now);
      const end = Math.floor(now.getTime() / HOUR) * HOUR;
      const todayFromBars = bars.values.reduce((sum, v, i) => (
        v !== null && parisDay(new Date(end - (23 - i) * HOUR)) === todayParis ? sum + v : sum), 0);
      const todayMm = today && isNumber(today.value) && freshness(today, now) !== 'unavailable' ? today.value : todayFromBars;
      const last24Mm = last24 && isNumber(last24.value) && freshness(last24, now) !== 'unavailable'
        ? last24.value : bars.values.reduce((sum, v) => sum + (v || 0), 0);
      shown.push({
        kind: 'rain',
        today: `${number(todayMm, 0.1, lang)} mm`,
        lastHour: value(lastHour, (v) => `${number(v, 0.1, lang)} mm`),
        last24h: `${number(last24Mm, 0.1, lang)} mm`,
        summary: todayMm > 0 ? w.rainToday(number(todayMm, 0.1, lang)) : w.noRainToday,
        bars: bars.scaled,
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
    }
  });

  // The hero's rain sentence comes from the rain block when both are shown.
  const outdoor = shown.find((b) => b.kind === 'outdoor');
  const rain = shown.find((b) => b.kind === 'rain');
  if (outdoor && rain) outdoor.rain = rain.summary;

  const freshest = used.reduce((latest, r) => (Date.parse(r.measuredAt) > latest ? Date.parse(r.measuredAt) : latest), 0);
  const age = freshest ? now.getTime() - freshest : Infinity;
  const live = age <= FRESH_MS;
  return {
    live,
    updated: freshest
      ? (live ? w.live(Math.max(1, Math.round(age / MINUTE))) : w.lastAt(parisTime(new Date(freshest).toISOString(), lang)))
      : null,
    blocks: shown,
  };
}

module.exports = { buildHomeView, number, power, freshness, trendOf, hourly, FRESH_MS, HIDE_MS };
