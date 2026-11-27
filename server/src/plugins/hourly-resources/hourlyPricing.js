/**
 * Time-banded hourly pricing for scheduled resources (specs/resources/resource-hourly-scheduling.md §3.3/§3.5).
 *
 * A resource booked by the hour is priced from a two-band grid: a day rate before an evening switch
 * time, an evening rate from that switch to the close. Bookings are made in slot steps (30 min) with a
 * mandatory first whole hour. The same code prices guest sessions (on a reservation) and external
 * standalone bookings — only the rate pair differs (passed in by the caller).
 *
 * Pure module: no DB, no Date.now(). All money rounded to 2 decimals, never negative.
 */

function toMinutes(time) {
  const [h, m] = String(time || '').split(':').map((n) => Number(n));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

const sdk = require('../sdk');
const { roundMoneyOrZero: round2 } = sdk.coreModule('money');

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// The French public holidays of a year, from the SDK's own calendar (`sdk.calendar.frenchPublicHolidays`), kept per year; the eve of one is the day before it, across the year's end.
const holidayYears = new Map();
function holidaysOf(year) {
  if (!holidayYears.has(year)) holidayYears.set(year, new Set(sdk.calendar.frenchPublicHolidays(year).map((holiday) => holiday.date)));
  return holidayYears.get(year);
}
const isPublicHoliday = (date) => ISO_DATE.test(String(date || '')) && holidaysOf(Number(String(date).slice(0, 4))).has(date);
function isEveOfPublicHoliday(date) {
  const match = ISO_DATE.exec(String(date || ''));
  if (!match) return false;
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1)).toISOString().slice(0, 10);
  return isPublicHoliday(next);
}

/**
 * The period of a slice (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 6): `weekend` on Friday from the evening switch, all Saturday, all Sunday,
 * all of a public holiday, and the evening of the day before a public holiday; `week` otherwise. `start` and `eveningStart` are clock times (`HH:MM`) or minutes;
 * a resource with no evening switch has no Friday or eve-of-holiday weekend. An unreadable date is `week`.
 */
function periodOf(date, start, eveningStart) {
  const match = ISO_DATE.exec(String(date || ''));
  if (!match) return 'week';
  const asMinutes = (value) => (typeof value === 'number' ? value : toMinutes(value));
  const weekday = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  if (weekday === 0 || weekday === 6 || isPublicHoliday(date)) return 'weekend';
  const hasEvening = eveningStart !== null && eveningStart !== undefined && eveningStart !== '' && Number.isFinite(asMinutes(eveningStart));
  const evening = hasEvening && asMinutes(start) >= asMinutes(eveningStart);
  return evening && (weekday === 5 || isEveOfPublicHoliday(date)) ? 'weekend' : 'week';
}

// specs/resources/hourly-extra-hour-rates.md rule 1 — a following-hours rate left empty is « same as the first hour »; 0 is a real value (free).
const nextRateOf = (value, fallback) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? fallback : Math.max(0, Number(value)));

/**
 * cfg: { dayRate, eveningRate, dayNextRate, eveningNextRate, eveningStart ('HH:MM' | null), slotMinutes = 30, rankOffsetMinutes = 0 }.
 * The evening rate falls back to the day rate when ≤ 0 or when eveningStart is empty. `dayNextRate` / `eveningNextRate` are the
 * rates of the hours after the first (specs/resources/hourly-extra-hour-rates.md rule 1): empty → the first-hour rate of the band.
 * `rankOffsetMinutes` shifts the rank for time added after minutes already covered.
 */
function normalizeConfig(cfg = {}) {
  const dayRate = Math.max(0, Number(cfg.dayRate) || 0);
  const eveningRateRaw = Number(cfg.eveningRate) || 0;
  // The outside grid never falls back from the evening to the day rate: a band with no price is refused by the caller before it gets here (a guest grid keeps the fallback).
  const outside = Boolean(cfg.weekend || cfg.outside);
  const hasEvening = Boolean(cfg.eveningStart) && (outside || eveningRateRaw > 0);
  const dayNextRate = nextRateOf(cfg.dayNextRate, dayRate);
  const eveningRate = hasEvening ? eveningRateRaw : dayRate;
  const base = {
    dayRate,
    dayNextRate,
    eveningRate,
    eveningNextRate: hasEvening ? nextRateOf(cfg.eveningNextRate, eveningRate) : dayNextRate,
    eveningStart: hasEvening ? toMinutes(cfg.eveningStart) : Infinity,
    slotMinutes: Math.max(1, Number(cfg.slotMinutes) || 30),
    rankOffsetMinutes: Math.max(0, Number(cfg.rankOffsetMinutes) || 0),
    anyStart: Boolean(cfg.anyStart),
  };
  if (!cfg.weekend) return base;
  // The weekend grid (an outside customer only): same clock, its own four rates; `forcePeriod` is a dateless quote's explicit period (rule 8).
  return {
    ...base,
    eveningClock: cfg.eveningStart ? toMinutes(cfg.eveningStart) : null,
    forcePeriod: cfg.period === 'weekend' || cfg.period === 'week' ? cfg.period : null,
    weekend: normalizeConfig({
      ...cfg.weekend, outside: true, eveningStart: cfg.eveningStart, slotMinutes: cfg.slotMinutes, rankOffsetMinutes: cfg.rankOffsetMinutes,
    }),
  };
}

// The grid the slice starting at `t` of `date` is priced on: the weekend one for an outside customer on a weekend slice, the week one otherwise.
function gridAt(t, normCfg, date) {
  if (!normCfg.weekend) return { grid: normCfg, period: 'week' };
  const period = normCfg.forcePeriod || periodOf(date, t, normCfg.eveningClock);
  return { grid: period === 'weekend' ? normCfg.weekend : normCfg, period };
}

// The rate of the slice starting at `t`: the band comes from its start time, the rate from its rank (rule 2). The rank counts from
// `paidFrom` — the session's start, moved forward by the free minutes (rule 3) — and a slice before it is priced at rank 1.
function rateAt(t, normCfg, paidFrom, date) {
  const { grid } = gridAt(t, normCfg, date);
  const rank = t < paidFrom ? 1 : Math.floor((t - paidFrom + normCfg.rankOffsetMinutes) / 60) + 1;
  if (t < grid.eveningStart) return rank === 1 ? grid.dayRate : grid.dayNextRate;
  return rank === 1 ? grid.eveningRate : grid.eveningNextRate;
}

// The slices a range is priced in. A range that starts and ends on the slot grid is walked as the engine walks it: one slice per slot step from its start, each priced as a whole in
// the band, the period and the rank of its start. Only a session that starts or ends off the grid (`anyStart`, a planning booking of an outside customer) is cut where its price can
// change instead: at the evening switch (the band, and the period of a Friday or an eve of holiday), and at every whole hour from the first paid minute (the rank).
function slicesOf(fromMin, toMin, normCfg, paidFrom) {
  const out = [];
  if (!normCfg.anyStart || (fromMin % normCfg.slotMinutes === 0 && toMin % normCfg.slotMinutes === 0)) {
    for (let t = fromMin; t < toMin; t += normCfg.slotMinutes) out.push([t, Math.min(t + normCfg.slotMinutes, toMin)]);
    return out;
  }
  const edges = new Set([fromMin, toMin]);
  [normCfg.eveningStart, normCfg.eveningClock, paidFrom].forEach((edge) => {
    if (Number.isFinite(edge) && edge > fromMin && edge < toMin) edges.add(edge);
  });
  for (let t = paidFrom - normCfg.rankOffsetMinutes + 60; t < toMin; t += 60) {
    if (t > fromMin && t > paidFrom - normCfg.rankOffsetMinutes) edges.add(t);
  }
  const sorted = [...edges].sort((a, b) => a - b);
  for (let i = 0; i + 1 < sorted.length; i += 1) out.push([sorted[i], sorted[i + 1]]);
  return out;
}

/**
 * The slices `priceSessions` prices a range in, with the band and the period each is priced on — the one walk a caller that judges a price (an outside band with no price) must use,
 * never a walk of its own. `date` gives each slice its own period; none → `cfg.period`, or the week.
 */
function pricedSlices(fromMin, toMin, cfg = {}, date = null) {
  const norm = normalizeConfig(cfg);
  return slicesOf(fromMin, toMin, norm, fromMin).map(([from, to]) => ({
    from, to, band: from < norm.eveningStart ? 'day' : 'evening', period: gridAt(from, norm, date).period,
  }));
}

// Price the minutes [fromMin, toMin) over the banded grid, walking in slices so a slice that crosses the evening switch is
// billed at each side's band. Ranks count from `paidFrom` (default: `fromMin`).
function priceMinutes(fromMin, toMin, normCfg, paidFrom = fromMin, date = null) {
  if (toMin <= fromMin) return 0;
  return slicesOf(fromMin, toMin, normCfg, paidFrom).reduce((total, [t, end]) => total + (rateAt(t, normCfg, paidFrom, date) * (end - t)) / 60, 0);
}

// The same slice walk as `priceMinutes`, kept per band and per rate: consecutive slices of one band at one rate merge into one entry,
// so a screen can show « jour 30 € · soir 40 € » and the first hour apart from the following ones. `rate` is the effective hourly rate.
function bandsOf(fromMin, toMin, normCfg, paidFrom = fromMin, date = null) {
  const out = [];
  if (toMin <= fromMin) return out;
  const { eveningStart } = normCfg;
  for (const [t, end] of slicesOf(fromMin, toMin, normCfg, paidFrom)) {
    const band = t < eveningStart ? 'day' : 'evening';
    const rate = rateAt(t, normCfg, paidFrom, date);
    const { period } = gridAt(t, normCfg, date);
    const last = out[out.length - 1];
    if (last && last.band === band && last.period === period && last.rate === rate && last.toMin === t) {
      last.toMin = end;
      last.raw += (rate * (end - t)) / 60;
    } else {
      out.push({
        band, period, fromMin: t, toMin: end, rate, raw: (rate * (end - t)) / 60,
      });
    }
  }
  return out;
}

// Each band is rounded to the cent, the last one takes the remainder: the bands always add up to the
// gross total the screen shows next to them.
function roundedBands(raw, grossTotal) {
  let spent = 0;
  return raw.map((b, i) => {
    const amount = i === raw.length - 1 ? round2(grossTotal - spent) : round2(b.raw);
    spent = round2(spent + amount);
    return {
      band: b.band, from: formatTime(b.fromMin), to: formatTime(b.toMin),
      minutes: b.toMin - b.fromMin, rate: round2(b.rate), amount,
    };
  });
}

const formatTime = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Gross price of one session's [start, end) range (no free-hour deduction). */
function priceRange(start, end, cfg = {}) {
  return round2(priceMinutes(toMinutes(start), toMinutes(end), normalizeConfig(cfg)));
}

/**
 * What a booking does not charge (specs/pricing/pricing-components.md §3 rules 24, 37-diff 4): the lodging's free minutes are worth the DAY
 * first-hour rate — the same value a stay's free hour has on its quantity path — and the offered minutes right after them are worth the band
 * they fall in. `start`/`end` are minutes of the day, `freeApplied`/`offeredApplied` already capped to the duration.
 * The free minutes are not a rank (specs/resources/hourly-extra-hour-rates.md rule 3): the offered minutes are the first paid ones, at the first-hour rate.
 * `freeAtDayRate: false` is a booking stored before this rule (rule 74: its price is not re-priced): its free minutes are valued on the band
 * they fall in.
 */
function bookingDeductions({ start, freeApplied, offeredApplied, freeAtDayRate = true, date = null }, cfg = {}) {
  const norm = normalizeConfig(cfg);
  const offeredFrom = start + freeApplied;
  let freeValue = 0;
  if (freeApplied > 0) freeValue = freeAtDayRate ? (norm.dayRate * freeApplied) / 60 : priceMinutes(start, offeredFrom, norm, offeredFrom, date);
  const offeredValue = offeredApplied > 0 ? priceMinutes(offeredFrom, offeredFrom + offeredApplied, norm, offeredFrom, date) : 0;
  return { freeValue: round2(freeValue), offeredValue: round2(offeredValue) };
}

/** The gross price of one slot of the grid (the free-slots picker and the SAS preview print it). */
function slotPrice(start, end, cfg = {}) {
  return priceRange(start, end, cfg);
}

/**
 * Validate a session against the resource window/granularity.
 * cfg adds: openTime, closeTime ('HH:MM'), minMinutes. Returns true when billable.
 */
function isValidSession(session, cfg = {}) {
  if (!session) return false;
  const s = toMinutes(session.start);
  const e = toMinutes(session.end);
  if (!(e > s)) return false;
  const slot = Math.max(1, Number(cfg.slotMinutes) || 30);
  if (!cfg.anyStart && (s % slot !== 0 || e % slot !== 0)) return false;
  if (cfg.openTime && s < toMinutes(cfg.openTime)) return false;
  if (cfg.closeTime && e > toMinutes(cfg.closeTime)) return false;
  const min = Math.max(0, Number(cfg.minMinutes) || 0);
  if (min > 0 && (e - s) < min) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(session.date || ''))) return false;
  return true;
}

/**
 * Price a set of sessions for one reservation-resource (or a single standalone booking).
 *  - cfg: { dayRate, eveningRate, dayNextRate, eveningNextRate, eveningStart, slotMinutes, openTime, closeTime, minMinutes }
 *  - freeMinutes: free allowance applied ONCE, to the earliest valid session's first minutes.
 * Returns { totalPrice, grossPrice, totalHours, billedHours, unitPrice, validSessions,
 * freeMinutesApplied, billedMinutes, freeValue, freeSupplement, bands } — the last five let a screen show the offered
 * minutes and the per-band detail exactly as priced here.
 *
 * `totalHours` are the hours the guest actually gets (what the SAS has to place);
 * `billedHours` are what is charged, i.e. `totalHours` minus the free allowance
 * (specs/resources/hourly-resource-quantity-and-sas-scheduling.md §3.1 rule 7).
 */
function priceSessions(sessions, cfg = {}, freeMinutes = 0) {
  const norm = normalizeConfig(cfg);
  const valid = (Array.isArray(sessions) ? sessions : [])
    .filter((s) => isValidSession(s, cfg))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || (toMinutes(a.start) - toMinutes(b.start)));

  if (valid.length === 0) {
    return {
      totalPrice: 0, grossPrice: 0, totalHours: 0, billedHours: 0, unitPrice: 0, validSessions: [],
      freeMinutesApplied: 0, billedMinutes: 0, freeValue: 0, freeSupplement: 0, bands: [],
    };
  }

  const totalMinutes = valid.reduce((sum, s) => sum + (toMinutes(s.end) - toMinutes(s.start)), 0);

  // Free allowance: applied once, to the earliest session's first `freeMinutes` (capped to its length). It is not a rank
  // (specs/resources/hourly-extra-hour-rates.md rule 3): the first session's ranks start at its first paid minute.
  const free = Math.max(0, Number(freeMinutes) || 0);
  const first = valid[0];
  const firstStart = toMinutes(first.start);
  const freeApplied = Math.min(free, toMinutes(first.end) - firstStart);
  const paidFromOf = (s) => (s === first ? firstStart + freeApplied : toMinutes(s.start));
  const gross = valid.reduce((sum, s) => sum + priceMinutes(toMinutes(s.start), toMinutes(s.end), norm, paidFromOf(s), s.date), 0);
  // Rule 37 — the free minutes are worth the DAY first-hour rate wherever they fall: an offered hour placed in the evening owes the evening supplement, as the arrival
  // SAS bills it. `freeSupplement` is what the offered minutes would cost above the day rate (the evening supplement of the free window).
  const freeValue = (norm.dayRate * freeApplied) / 60;
  const freeSupplement = freeApplied > 0 ? Math.max(0, priceMinutes(firstStart, firstStart + freeApplied, norm, firstStart + freeApplied, first.date) - freeValue) : 0;

  const billedMinutes = Math.max(0, totalMinutes - freeApplied);
  const billedHours = round2(billedMinutes / 60);
  const totalPrice = Math.max(0, round2(gross - freeValue));
  // An offered evening hour bills no hour yet owes its supplement: that amount is the line's one unit, so a stored line replays to the same total.
  const unitPrice = billedHours > 0 ? round2(totalPrice / billedHours) : totalPrice;

  return {
    totalPrice,
    grossPrice: round2(gross),
    totalHours: round2(totalMinutes / 60),
    billedHours,
    unitPrice,
    validSessions: valid,
    freeMinutesApplied: freeApplied,
    billedMinutes,
    freeValue: round2(freeValue),
    freeSupplement: round2(freeSupplement),
    bands: roundedBands(valid.flatMap((s) => bandsOf(toMinutes(s.start), toMinutes(s.end), norm, paidFromOf(s), s.date)), round2(gross)),
  };
}

/**
 * Evening supplement of a set of placed blocks (specs/resources/hourly-resource-quantity-and-sas-scheduling.md
 * §3.4 rule 22). The hours were SOLD at the day rate; placing one in the evening band owes the
 * difference, which the arrival SAS adds to the arrival complement instead of re-playing the quote.
 *
 * Computed as « banded price − day-only price » so it stays consistent with `priceSessions` by
 * construction (same slot walk, same band boundary). Clamped per block, so a block configured cheaper
 * in the evening yields 0 rather than discounting another block.
 */
function eveningSupplement(blocks, cfg = {}) {
  const banded = normalizeConfig(cfg);
  const dayOnly = {
    ...banded, eveningRate: banded.dayRate, eveningNextRate: banded.dayNextRate, eveningStart: Infinity,
  };
  const total = (Array.isArray(blocks) ? blocks : []).reduce((sum, block) => {
    const start = toMinutes(block?.start);
    const end = toMinutes(block?.end);
    if (!(end > start)) return sum;
    return sum + Math.max(0, priceMinutes(start, end, banded) - priceMinutes(start, end, dayOnly));
  }, 0);
  return round2(total);
}

module.exports = {
  toMinutes, periodOf, pricedSlices, isPublicHoliday, isEveOfPublicHoliday, priceRange, slotPrice, bookingDeductions, priceSessions, isValidSession, normalizeConfig, eveningSupplement,
};
