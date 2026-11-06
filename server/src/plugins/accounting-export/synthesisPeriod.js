/**
 * The period of the accounting synthesis (specs/accounting-synthesis.md rules 1-2) and its chart buckets
 * (rule 15). Pure: today, the exercise bounds and the core's refusals are passed in.
 *
 *   month    `YYYY-MM`            — a calendar month, one bucket a day
 *   quarter  `YYYY-Qn`            — a calendar quarter (the VAT return's), one bucket per ISO week
 *   fy       the exercise key     — the app's fiscal year, one bucket a month
 *   custom   `from` … `to`        — the Suivi financier's custom window, same refusals
 */

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const KINDS = new Set(['month', 'quarter', 'fy', 'custom']);
const UNKNOWN_PERIOD = 'Période inconnue.';
// The keys each kind reads (rule 1); every other known key is still judged (rule 54).
const OWN_KEYS = Object.freeze({ month: ['month'], quarter: ['quarter'], fy: ['fiscalYear'], custom: ['from', 'to'] });

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const pad2 = (n) => String(n).padStart(2, '0');
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso, n) => isoOf(toMs(iso) + n * 86400000);
const daysBetween = (from, to) => Math.round((toMs(to) - toMs(from)) / 86400000);
const lastDayOf = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const monthEnd = (ym) => `${ym}-${pad2(lastDayOf(Number(ym.slice(0, 4)), Number(ym.slice(5, 7))))}`;

/** Every `YYYY-MM` the window touches, in order. */
function monthsOf(from, to) {
  // Counted on numbers, never compared as text: after « 9999-12 » comes « 10000-01 », which sorts before it and
  // made an exercise ending in December 9999 loop forever (R2-2 review).
  const out = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  while (y * 12 + m <= end) {
    out.push(`${String(y).padStart(4, '0')}-${pad2(m)}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** True when the window is made of whole calendar months. */
function isWholeMonths(from, to) {
  return from.slice(8, 10) === '01' && to === monthEnd(to.slice(0, 7));
}

// Rule 15 — day for a month (or a custom window up to 62 days), ISO week for a quarter (up to 186 days),
// month beyond.
function granularityOf(kind, from, to) {
  if (kind === 'month') return 'day';
  if (kind === 'quarter') return 'week';
  if (kind === 'fy') return 'month';
  const width = daysBetween(from, to);
  if (width <= 62) return 'day';
  if (width <= 186) return 'week';
  return 'month';
}

function isoWeek(iso) {
  const d = new Date(toMs(iso));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
}

/** The window's buckets `{ key, label, from, to }`, clipped to the window, in order. */
function bucketsOf(window) {
  const { from, to, granularity } = window;
  const out = [];
  if (granularity === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      out.push({ key: d, label: `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`, from: d, to: d });
    }
    return out;
  }
  if (granularity === 'week') {
    for (let d = from; d <= to;) {
      const weekday = (new Date(toMs(d)).getUTCDay() + 6) % 7;
      const sunday = addDays(d, 6 - weekday);
      const end = sunday < to ? sunday : to;
      out.push({ key: d, label: `S${isoWeek(d)}`, from: d, to: end });
      d = addDays(end, 1);
    }
    return out;
  }
  const oneYear = from.slice(0, 4) === to.slice(0, 4);
  for (const ym of monthsOf(from, to)) {
    const short = MONTHS_SHORT_FR[Number(ym.slice(5, 7)) - 1];
    const start = `${ym}-01` > from ? `${ym}-01` : from;
    const end = monthEnd(ym) < to ? monthEnd(ym) : to;
    // Short enough for a half-width chart (R5-04): « oct. », or « oct. 25 » when the window spans two years.
    out.push({ key: ym, label: oneYear ? short : `${short} ${ym.slice(2, 4)}`, from: start, to: end });
  }
  return out;
}

const currentQuarter = (today) => `${today.slice(0, 4)}-Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`;

/**
 * @param {object} p
 * @param {object} p.query           `{ period, month, quarter, fiscalYear, from, to }` as received
 * @param {string} p.today           the server's day, YYYY-MM-DD
 * @param {number} p.fiscalEndMonth  the app's closing month
 * @param {object} p.fiscalYear      utils/fiscalYear (resolve, boundsForEndYear)
 * @param {Function} p.resolveCustom financeWindow.resolveWindow, for the custom window's refusals
 * @param {Function} p.dateWindowMessage stayDates.dateWindowMessage, the entered-date window
 * @returns {{ ok: true, window: object, exercise: object } | { ok: false, error: string }}
 */
function resolvePeriod({ query = {}, today, fiscalEndMonth, fiscalYear, resolveCustom, dateWindowMessage }) {
  const text = (v) => (typeof v === 'string' ? v.trim() : (v == null ? '' : null));
  const kindRaw = text(query.period);
  if (kindRaw === null) return { ok: false, error: UNKNOWN_PERIOD };
  const kind = kindRaw === '' ? 'month' : kindRaw;
  if (!KINDS.has(kind)) return { ok: false, error: UNKNOWN_PERIOD };
  // Rule 54 (D-HC16, V2R2-1) — a known key sent twice (or as anything but text) is refused whatever the kind, even
  // one this kind does not read: the kind's own keys keep their own refusal below, every other one is « Période inconnue. ».
  const own = OWN_KEYS[kind];
  if (Object.keys(OWN_KEYS).flatMap((k) => OWN_KEYS[k]).some((key) => !own.includes(key) && text(query[key]) === null)) {
    return { ok: false, error: UNKNOWN_PERIOD };
  }

  const exerciseOf = (iso) => fiscalYear.resolve(fiscalEndMonth, { today: iso });
  const finish = (win, exercise) => ({
    ok: true,
    window: { ...win, granularity: granularityOf(win.kind, win.from, win.to) },
    exercise,
  });

  if (kind === 'fy') {
    const key = text(query.fiscalYear);
    if (key === null) return { ok: false, error: UNKNOWN_PERIOD };
    // As the Suivi financier: an unusable key reads the current exercise (fiscal-year-and-nights-sold rule 24).
    const exercise = fiscalYear.resolve(fiscalEndMonth, { key: key === '' ? undefined : key, today });
    return finish({ kind: 'fy', from: exercise.from, to: exercise.to, label: `Exercice ${exercise.label}`, fiscalYear: exercise.key }, exercise);
  }

  if (kind === 'custom') {
    const exercise = exerciseOf(today);
    const resolved = resolveCustom({ exercise, kind: 'custom', from: query.from, to: query.to, today });
    if (!resolved.ok) return resolved;
    return finish({ kind: 'custom', from: resolved.window.from, to: resolved.window.to, label: resolved.window.label }, exerciseOf(resolved.window.from));
  }

  let from;
  let to;
  let label;
  let extra;
  if (kind === 'month') {
    const raw = text(query.month);
    const ym = raw === '' ? today.slice(0, 7) : raw;
    if (!ym || !MONTH_RE.test(ym)) return { ok: false, error: UNKNOWN_PERIOD };
    from = `${ym}-01`;
    to = monthEnd(ym);
    label = `${MONTHS_FR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
    extra = { month: ym };
  } else {
    const raw = text(query.quarter);
    const q = raw === '' ? currentQuarter(today) : raw;
    const m = q ? QUARTER_RE.exec(q) : null;
    if (!m) return { ok: false, error: UNKNOWN_PERIOD };
    const first = (Number(m[2]) - 1) * 3 + 1;
    from = `${m[1]}-${pad2(first)}-01`;
    to = monthEnd(`${m[1]}-${pad2(first + 2)}`);
    label = `T${m[2]} ${m[1]}`;
    extra = { quarter: q };
  }
  // Rule 2 — the entered-date window of every date the operator chooses, refused never clamped.
  const outside = dateWindowMessage(from, today) || dateWindowMessage(to, today);
  if (outside) return { ok: false, error: outside };
  return finish({ kind, from, to, label, ...extra }, exerciseOf(from));
}

/**
 * Rule 22 — what the period selector offers: every month and calendar quarter from `firstMonth` to
 * `lastMonth` (YYYY-MM), newest first, labelled, kept only when the server accepts it — its first day on or
 * after `floor` and its last day on or before `ceiling` (the entered-date window, rule 2). The selector never
 * builds a period itself, and never offers one the server would refuse (D-HC13).
 */
function periodOptions({ firstMonth, lastMonth, floor, ceiling }) {
  const accepted = (from, to) => (!floor || from >= floor) && (!ceiling || to <= ceiling);
  const lo = floor && `${firstMonth}-01` < floor ? floor.slice(0, 7) : firstMonth;
  const hi = ceiling && `${lastMonth}-01` > ceiling ? ceiling.slice(0, 7) : lastMonth;
  const months = lo <= hi ? monthsOf(`${lo}-01`, `${hi}-01`).reverse() : [];
  const quarters = [];
  const seen = new Set();
  for (const ym of months) {
    const year = ym.slice(0, 4);
    const q = Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1;
    const value = `${year}-Q${q}`;
    if (seen.has(value)) continue;
    seen.add(value);
    const qFrom = `${year}-${pad2((q - 1) * 3 + 1)}-01`;
    const qTo = monthEnd(`${year}-${pad2(q * 3)}`);
    if (accepted(qFrom, qTo)) quarters.push({ value, label: `T${q} ${year}` });
  }
  return {
    months: months
      .filter((ym) => accepted(`${ym}-01`, monthEnd(ym)))
      .map((ym) => ({ value: ym, label: `${MONTHS_FR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` })),
    quarters,
  };
}

module.exports = {
  periodOptions,
  resolvePeriod, bucketsOf, monthsOf, isWholeMonths, granularityOf, isoWeek, addDays, daysBetween, UNKNOWN_PERIOD,
};
