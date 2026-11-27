// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 2, 29, 30 (K3, K4, K9, D21) — the generative invariant harness of the hourly booking pricing (round 3, M0).
// The booking-pricing area produced a new defect at every round, each next to the previous narrow fix; this suite is seeded, deterministic and bounded, and judges every priced
// session by properties instead of examples. The pure half runs thousands of random resources and sessions, the stored half runs random bookings through every reader of the one figure.
//   I-a  an outside on-grid session costs on the planning exactly what the engine charges, and both refuse the same sessions;
//   I-b  one figure per booking: preview == stored total == visit session line == invoiceBasis total, before and after any save that does not move it;
//   I-c  a session touching an unsold band or period is refused on the preview AND the save, never priced 0 € for any slice it prices;
//   I-d  stay guests (a booking's price AND a stay's own sessions through the price-line contributor) and lodging bookings equal origin/master's figures (the frozen oracles);
//   I-e  a booking sold on a document keeps the document's session total: the offered hour is never charged, a notes-only save never rewrites it;
//   I-f  the free and the offered minutes are valued on the gross's own slices: total = gross - (free + offered minutes at the rate of the slice they fall in), and an on-grid week-day session
//        costs what origin/master charged for it, whatever the slot and wherever the evening switch falls (round 4, A).
// Each invariant has a negative control: the same check run against a copy that breaks the property must find a violation.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePlugins } = require('../plugins/sdk/testing');

if (!requirePlugins(['hourly-resources', 'gift-vouchers'])) return;

const sdk = require('../plugins/sdk');
const head = require('../plugins/hourly-resources/bookingPricing');
const { periodOf } = require('../plugins/hourly-resources/hourlyPricing');
const { quoteSession } = require('../plugins/hourly-resources/sessionQuote');
const masterPricing = require('../plugins/hourly-resources/tests/masterBookingPricing.oracle');
const masterHourly = require('../plugins/hourly-resources/tests/masterHourlyPricing.oracle');
const { createHourlyContributor } = require('../plugins/hourly-resources/pricing');
const { FAR_YEAR } = require('./farYearFixture');

// ---------------------------------------------------------------------------------------------------------------- seeded randomness
function generator(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(next() * list.length)];
  const chance = (p) => next() < p;
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  return { next, pick, chance, int };
}

const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const cents = (euros) => Math.round(Number(euros) * 100);

// ---------------------------------------------------------------------------------------------------------------- calendar: computed from the year, never a literal
const dayAt = (year, month, day) => new Date(Date.UTC(year, month - 1, day, 12)).toISOString().slice(0, 10);
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const addDay = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

function calendarOf(year) {
  const holidays = sdk.calendar.frenchPublicHolidays(year).map((h) => h.date);
  const isHoliday = (date) => holidays.includes(date);
  const plain = (date) => !isHoliday(date) && !isHoliday(addDay(date, 1)) && !isHoliday(addDay(date, -1));
  const first = (weekday, from = dayAt(year, 2, 1)) => { for (let i = 0; i < 14; i += 1) { const d = addDay(from, i); if (weekdayOf(d) === weekday && plain(d)) return d; } return null; };
  const holidayOnWeekday = holidays.find((d) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5);
  const eveOnWeekday = holidays.map((d) => addDay(d, -1)).find((d) => weekdayOf(d) >= 1 && weekdayOf(d) <= 4 && !isHoliday(d));
  const eveOnWeekend = holidays.map((d) => addDay(d, -1)).find((d) => (weekdayOf(d) === 6 || weekdayOf(d) === 0) && !isHoliday(d));
  return {
    week: first(2), thursday: first(4), friday: first(5), saturday: first(6), sunday: first(0), holiday: holidayOnWeekday, eveWeekday: eveOnWeekday, eveWeekend: eveOnWeekend,
  };
}
const CALENDAR = calendarOf(FAR_YEAR);
const DATES = Object.values(CALENDAR).filter(Boolean);

// ---------------------------------------------------------------------------------------------------------------- a random hourly resource (a row of `resources`)
const SLOTS = [5, 10, 15, 30, 60, 120];

function randomResource(rnd) {
  const slot = rnd.pick(SLOTS);
  const open = rnd.pick([480, 540, 600, 660].filter((m) => m % slot === 0));
  const close = rnd.pick([1260, 1320, 1380].filter((m) => m % slot === 0));
  // The evening switch: none, on the slot grid, or off it.
  const evening = rnd.pick(['none', 'grid', 'grid', 'off', 'off']);
  let eveningStart = null;
  if (evening === 'grid') eveningStart = clock(rnd.pick([1020, 1080, 1140, 1200].filter((m) => m % slot === 0)));
  if (evening === 'off') eveningStart = clock(rnd.pick([1050, 1095, 1170, 1155, 1141].filter((m) => m % slot !== 0)));
  const sold = (value) => (rnd.chance(0.12) ? rnd.pick([0, null]) : value);
  const rate = () => rnd.pick([30, 40, 45, 50, 55, 63, 70, 80, 90]);
  const next = (first) => (rnd.chance(0.4) ? null : rnd.pick([first, first - 5, first + 10, 0]));
  const dayWeek = rate();
  const dayWeekend = rate();
  const eveWeek = rate();
  const eveWeekend = rate();
  return {
    id: 1,
    name: 'Bain',
    priceType: 'per_hour',
    showsPlanningCard: 1,
    sellableExternally: 1,
    slotDuration: slot,
    openTime: clock(open),
    closeTime: clock(close),
    minimumUsageMinutes: slot,
    hourlyEveningStart: eveningStart,
    price: rate(),
    hourlyEveningRate: rnd.pick([0, 45, 60]),
    hourlyNextDayRate: next(30),
    hourlyNextEveningRate: next(50),
    hourlyExternalDayRate: sold(dayWeek),
    hourlyExternalEveningRate: sold(eveWeek),
    hourlyExternalNextDayRate: next(dayWeek),
    hourlyExternalNextEveningRate: next(eveWeek),
    hourlyExternalWeekendDayRate: sold(dayWeekend),
    hourlyExternalWeekendEveningRate: sold(eveWeekend),
    hourlyExternalWeekendNextDayRate: next(dayWeekend),
    hourlyExternalWeekendNextEveningRate: next(eveWeekend),
  };
}

// A session of the resource: on the slot grid, or off it (a start or an end that is not a multiple of the slot).
function randomSession(rnd, resource, { onGrid }) {
  const slot = resource.slotDuration;
  const open = Number(resource.openTime.slice(0, 2)) * 60 + Number(resource.openTime.slice(3));
  const close = Number(resource.closeTime.slice(0, 2)) * 60 + Number(resource.closeTime.slice(3));
  const date = rnd.pick(DATES);
  const slots = Math.floor((close - open) / slot);
  const length = Math.min(slots, rnd.pick([1, 1, 2, 2, 3, 4, Math.ceil(120 / slot), Math.ceil(180 / slot)]));
  const startSlot = rnd.int(0, slots - length);
  const start = open + startSlot * slot;
  if (onGrid) return { date, start, end: start + length * slot };
  const shift = rnd.pick([15, 30, 45, 10, 5, 20].filter((s) => s % slot !== 0 || slot < s));
  const off = start + shift;
  const end = Math.min(close, off + Math.max(15, length * slot - (rnd.chance(0.5) ? 0 : 15)));
  return { date, start: off, end: Math.max(end, off + 15) };
}

const periodGrid = (resource, period) => (period === 'weekend'
  ? { day: resource.hourlyExternalWeekendDayRate, evening: resource.hourlyExternalWeekendEveningRate }
  : { day: resource.hourlyExternalDayRate, evening: resource.hourlyExternalEveningRate });

// ---------------------------------------------------------------------------------------------------------------- the invariants, as checks over a pricer
// `pricer` is what the planning calls; the harness never reads its internals.
const planningPrice = (resource, session, over = {}) => head.priceBookingLines({
  resource, startTime: clock(session.start), endTime: clock(session.end), external: true, date: session.date, lodging: false, engineRated: true, judgeBands: true, ...over,
});

const engineConfig = (resource) => ({ resource, id: resource.id, label: resource.name, vatClass: 'resources' });
const engineSession = (resource, session) => quoteSession(engineConfig(resource), {
  band: 'day', start: clock(session.start), minutes: session.end - session.start, date: session.date,
});

/** I-a: on a session on the grid, planning and engine agree on the figure and on the refusal. */
function checkEngineParity(pricer, rnd, rounds) {
  const violations = [];
  let compared = 0;
  for (let i = 0; i < rounds; i += 1) {
    const resource = randomResource(rnd);
    const session = randomSession(rnd, resource, { onGrid: true });
    const engine = engineSession(resource, session);
    if (engine.refusal && engine.refusal.code !== 'SESSION_BAND_NOT_SOLD') continue;
    const planning = pricer(resource, session);
    compared += 1;
    const engineRefused = Boolean(engine.refusal);
    const planningRefused = Boolean(planning.refusal);
    if (engineRefused !== planningRefused) violations.push(`I-a refusal differs: ${JSON.stringify({ session, slot: resource.slotDuration, evening: resource.hourlyEveningStart })} engine ${engineRefused} planning ${planningRefused}`);
    else if (!engineRefused && cents(planning.total) !== engine.line.totalCents) {
      violations.push(`I-a figure differs: ${session.date} ${clock(session.start)}-${clock(session.end)} slot ${resource.slotDuration} evening ${resource.hourlyEveningStart}: planning ${cents(planning.total)} engine ${engine.line.totalCents}`);
    }
  }
  return { violations, compared };
}

// Independent of the judge: what the pricer prices with no judgement is a list of bands, each priced at the rate of its own band and period; one at a first-hour rate of 0 is unsold.
function touchesUnsoldSlice(resource, session) {
  const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return planningPrice(resource, session, { judgeBands: false }).bands.some((band) => {
    const grid = periodGrid(resource, periodOf(session.date, band.from, resource.hourlyEveningStart));
    const evening = resource.hourlyEveningStart && minutes(band.from) >= minutes(resource.hourlyEveningStart);
    return !(Number(evening ? grid.evening : grid.day) > 0);
  });
}

/** I-c: whatever the session (on the grid or off it), one priced slice in an unsold band or period is a refusal, and a priced session has no slice in one. */
function checkUnsold(pricer, rnd, rounds) {
  const violations = [];
  let refused = 0;
  let priced = 0;
  for (let i = 0; i < rounds; i += 1) {
    const resource = randomResource(rnd);
    const session = randomSession(rnd, resource, { onGrid: rnd.chance(0.5) });
    const judged = pricer(resource, session);
    const touchesUnsold = touchesUnsoldSlice(resource, session);
    if (touchesUnsold) {
      refused += 1;
      if (!judged.refusal) violations.push(`I-c priced although a slice is unsold: ${session.date} ${clock(session.start)}-${clock(session.end)} slot ${resource.slotDuration} evening ${resource.hourlyEveningStart} -> ${judged.total} €`);
    } else {
      priced += 1;
      if (judged.refusal) violations.push(`I-c refused although every slice is sold: ${session.date} ${clock(session.start)}-${clock(session.end)} slot ${resource.slotDuration} evening ${resource.hourlyEveningStart}`);
    }
  }
  return { violations, refused, priced };
}

/** I-d: a lodging booking (with or without a stay) and a stay guest are priced to the cent as origin/master priced them. */
function checkAsMaster(pricer, rnd, rounds) {
  const violations = [];
  for (let i = 0; i < rounds; i += 1) {
    const resource = randomResource(rnd);
    const session = randomSession(rnd, resource, { onGrid: rnd.chance(0.6) });
    const party = rnd.pick([
      { name: 'stay with a lodging', reservationId: 25, free: rnd.pick([0, 30, 60]) },
      { name: 'stay with no lodging', reservationId: 25, free: null },
      { name: 'lodging with no stay', reservationId: null, free: rnd.pick([0, 30, 60]) },
    ]);
    const offered = rnd.pick([0, 0, 15, 30]);
    if (party.free === null && offered) continue;
    const override = party.free === null ? null : { price: null, freeMinutes: party.free };
    const wanted = masterPricing.priceBookingLines({
      resource, startTime: clock(session.start), endTime: clock(session.end), override, external: !party.reservationId, offeredMinutes: offered, freeHourAtDayRate: true,
    });
    const got = pricer(resource, session, {
      override, external: !party.reservationId, offeredMinutes: offered, freeHourAtDayRate: true, lodging: party.free !== null || Boolean(party.reservationId), date: party.free !== null || party.reservationId ? null : session.date,
    });
    if (cents(wanted.total) !== cents(got.total)) violations.push(`I-d ${party.name} ${session.date} ${clock(session.start)}-${clock(session.end)} offered ${offered} slot ${resource.slotDuration}: master ${wanted.total}, now ${got.refusal || got.total}`);
  }
  return { violations };
}

/**
 * I-f: the deductions are valued on the gross's slices. `bands` of the gross (same call without offered time) say which rate each minute is priced at; the offered minutes — the first paid ones,
 * right after the lodging's free minutes — are worth that rate, and the free minutes the guests' day rate. An on-grid week-day outside session is also what origin/master charged.
 */
function checkDeductions(pricer, rnd, rounds) {
  const violations = [];
  let compared = 0;
  let againstMaster = 0;
  const minutesOf = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  for (let i = 0; i < rounds; i += 1) {
    const resource = randomResource(rnd);
    const onGrid = rnd.chance(0.6);
    const session = randomSession(rnd, resource, { onGrid });
    if (rnd.chance(0.4)) session.date = CALENDAR.week;
    // A lodging's deductions are origin/master's (D6, I-d): its free minutes are a slot multiple here, where master's walk from where the offered minutes start is the gross's own.
    const kind = onGrid ? rnd.pick(['outside', 'outside', 'lodging']) : 'outside';
    const free = kind === 'lodging' ? rnd.pick([0, 30, 60].filter((m) => m % resource.slotDuration === 0)) : 0;
    const asked = rnd.pick([15, 30, 45, 60, 90]);
    const common = kind === 'lodging'
      ? { override: { price: null, freeMinutes: free }, external: false, lodging: true, date: null }
      : {};
    const gross = pricer(resource, session, { ...common, offeredMinutes: 0 });
    const got = pricer(resource, session, { ...common, offeredMinutes: asked });
    if (gross.refusal || got.refusal || got.offeredMinutesApplied === 0) continue;
    compared += 1;
    const duration = session.end - session.start;
    const freeApplied = Math.min(duration, free);
    const offeredFrom = session.start + freeApplied;
    const offered = got.offeredMinutesApplied;
    const worth = (from, to) => gross.bands.reduce((sum, band) => sum + (band.rate * Math.max(0, Math.min(to, minutesOf(band.to)) - Math.max(from, minutesOf(band.from)))) / 60, 0);
    const freeValue = (resource.price * freeApplied) / 60;
    const expected = Math.max(0, Math.round(gross.grossTotal * 100) - Math.round(freeValue * 100) - Math.round(worth(offeredFrom, offeredFrom + offered) * 100));
    if (Math.abs(cents(got.total) - expected) > 1) {
      violations.push(`I-f ${kind} ${session.date} ${clock(session.start)}-${clock(session.end)} slot ${resource.slotDuration} evening ${resource.hourlyEveningStart} free ${free} offered ${offered}: ${cents(got.total)} vs the gross's own rates ${expected}`);
    }
    if (kind === 'outside' && session.date === CALENDAR.week && onGrid) {
      const sold = Number(resource.hourlyExternalDayRate) > 0 && (!resource.hourlyEveningStart || Number(resource.hourlyExternalEveningRate) > 0);
      if (sold) {
        againstMaster += 1;
        const wanted = masterPricing.priceBookingLines({
          resource, startTime: clock(session.start), endTime: clock(session.end), override: null, external: true, offeredMinutes: offered, freeHourAtDayRate: true,
        });
        if (cents(wanted.total) !== cents(got.total)) violations.push(`I-f master ${session.date} ${clock(session.start)}-${clock(session.end)} slot ${resource.slotDuration} evening ${resource.hourlyEveningStart} offered ${offered}: master ${wanted.total}, now ${got.total}`);
      }
    }
  }
  return { violations, compared, againstMaster };
}

/**
 * I-d on a stay's own sessions: the price-line contributor the stay's quote runs through prices a guest's sessions (one to three, any day, the weekend included: a stay guest has no period) exactly as
 * origin/master's pricing did. `pricer(resource, sessions, free)` → `{ totalPrice, billedUnits }`.
 */
function checkStaySessions(pricer, rnd, rounds) {
  const violations = [];
  for (let i = 0; i < rounds; i += 1) {
    const resource = randomResource(rnd);
    const sessions = [];
    for (let n = rnd.int(1, 3); n > 0; n -= 1) {
      const one = randomSession(rnd, resource, { onGrid: true });
      if (!sessions.some((s) => s.date === one.date)) sessions.push({ date: one.date, start: clock(one.start), end: clock(one.end) });
    }
    const free = rnd.pick([0, 0, 30, 60]);
    const wantedCfg = {
      dayRate: resource.price, eveningRate: resource.hourlyEveningRate, dayNextRate: resource.hourlyNextDayRate, eveningNextRate: resource.hourlyNextEveningRate, eveningStart: resource.hourlyEveningStart,
      slotMinutes: resource.slotDuration, openTime: resource.openTime, closeTime: resource.closeTime, minMinutes: resource.minimumUsageMinutes,
    };
    const priced = masterHourly.priceSessions(sessions, wantedCfg, free);
    const wanted = { totalPrice: Math.max(0, Math.round((priced.totalPrice - priced.freeSupplement) * 100) / 100), billedUnits: priced.billedHours };
    const got = pricer(resource, sessions, free);
    if (cents(got.totalPrice) !== cents(wanted.totalPrice) || Number(got.billedUnits) !== Number(wanted.billedUnits)) {
      violations.push(`I-d stay ${JSON.stringify(sessions)} free ${free} slot ${resource.slotDuration} evening ${resource.hourlyEveningStart}: master ${wanted.totalPrice} (${wanted.billedUnits} h), now ${got.totalPrice} (${got.billedUnits} h)`);
    }
  }
  return { violations };
}

const contributor = createHourlyContributor();
const realStay = (resource, sessions, free) => contributor.priceLine({ resource: { ...resource, freeMinutes: free }, selected: { sessions }, sold: false });

const real = (resource, session, over) => planningPrice(resource, session, over);
const ROUNDS = 1500;

test('I-a — an outside on-grid session costs on the planning what the engine charges (and both refuse the same sessions)', () => {
  const { violations, compared } = checkEngineParity(real, generator(20261127), ROUNDS);
  assert.ok(compared > ROUNDS / 2, `compared ${compared}`);
  assert.deepEqual(violations.slice(0, 5), []);
});

test('I-a negative control — a planning that cuts every whole hour (the former anyStart walk) is caught', () => {
  const cutAtHours = (resource, session) => real({ ...resource, slotDuration: 60 }, session);
  const { violations } = checkEngineParity(cutAtHours, generator(20261127), ROUNDS);
  assert.ok(violations.length > 0);
});

test('I-c — an outside session touching an unsold band or period is refused, one that does not is priced, on and off the grid', () => {
  const { violations, refused, priced } = checkUnsold(real, generator(1127), ROUNDS);
  assert.ok(refused > 50 && priced > 50, `refused ${refused} priced ${priced}`);
  assert.deepEqual(violations.slice(0, 5), []);
});

test('I-c negative control — a pricer that judges only the slot grid from the start (and one that judges nothing) are caught', () => {
  const stepsFromStart = (resource, session) => {
    const step = resource.slotDuration;
    const period = (t) => periodOf(session.date, t, resource.hourlyEveningStart);
    const eveningAt = resource.hourlyEveningStart ? Number(resource.hourlyEveningStart.slice(0, 2)) * 60 + Number(resource.hourlyEveningStart.slice(3)) : Infinity;
    for (let t = session.start; t < session.end; t += step) {
      const grid = periodGrid(resource, period(t));
      if (!(Number(t >= eveningAt ? grid.evening : grid.day) > 0)) return { refusal: 'unsold' };
    }
    return planningPrice(resource, session, { judgeBands: false });
  };
  assert.ok(checkUnsold(stepsFromStart, generator(1127), ROUNDS).violations.length > 0);
  assert.ok(checkUnsold((resource, session) => planningPrice(resource, session, { judgeBands: false }), generator(1127), ROUNDS).violations.length > 0);
});

test('I-d — lodging bookings and stay guests are priced as origin/master prices them', () => {
  const { violations } = checkAsMaster(real, generator(42), ROUNDS);
  assert.deepEqual(violations.slice(0, 5), []);
});

test('I-d — a stay\'s own sessions, priced through the price-line contributor, cost what origin/master charged', () => {
  const { violations } = checkStaySessions(realStay, generator(43), ROUNDS);
  assert.deepEqual(violations.slice(0, 5), []);
});

test('I-d negative control — stay sessions walked on another slot grid, or priced on an outside weekend rate, are caught', () => {
  const otherSlot = (resource, sessions, free) => realStay({ ...resource, slotDuration: resource.slotDuration === 60 ? 30 : 60 }, sessions, free);
  assert.ok(checkStaySessions(otherSlot, generator(43), ROUNDS).violations.length > 0);
  const weekendGrid = (resource, sessions, free) => realStay({ ...resource, price: resource.hourlyExternalWeekendDayRate || resource.price + 10 }, sessions, free);
  assert.ok(checkStaySessions(weekendGrid, generator(43), ROUNDS).violations.length > 0);
});

test('I-d negative control — a lodging priced as an outside session on its date (the F4 regression) is caught', () => {
  const asAnOutsideSession = (resource, session, over) => real(resource, session, { ...over, lodging: false, date: session.date });
  assert.ok(checkAsMaster(asAnOutsideSession, generator(42), ROUNDS).violations.length > 0);
});

test('I-f — the free and the offered minutes are valued on the gross\'s own slices, and an on-grid week-day session costs what origin/master charged', () => {
  const { violations, compared, againstMaster } = checkDeductions(real, generator(2026), ROUNDS);
  assert.ok(compared > 400 && againstMaster > 100, `compared ${compared} against master ${againstMaster}`);
  assert.deepEqual(violations.slice(0, 5), []);
});

test('I-f negative control — the offered minutes valued as a range walked on its own (the round-3 behaviour) are caught', () => {
  const walkedAlone = (resource, session, over = {}) => {
    const out = real(resource, session, over);
    if (!over.offeredMinutes || out.refusal || !out.offeredMinutesApplied) return out;
    const offeredFrom = session.start + out.freeMinutesApplied;
    const alone = real(resource, { ...session, start: offeredFrom, end: offeredFrom + out.offeredMinutesApplied }, { ...over, offeredMinutes: 0, override: null, lodging: false, external: true });
    if (alone.refusal) return out;
    const total = Math.max(0, out.grossTotal - out.freeValue - alone.grossTotal);
    return { ...out, total };
  };
  assert.ok(checkDeductions(walkedAlone, generator(2026), ROUNDS).violations.length > 0);
});

// ---------------------------------------------------------------------------------------------------------------- the stored half: every reader of one booking
const f = require('../plugins/gift-vouchers/tests/periodFixtures');
const { createVisitModel } = require('../plugins/hourly-resources/visitModel');
const bookingsModule = require('../plugins/hourly-resources/bookingsModel');

const shop = f.setup();
const { db } = shop;
const bathId = shop.ids.bath;
const documentOf = (saleId) => require('../utils/standaloneSale').documentOf(saleId);
const RESOURCE_COLUMNS = ['slotDuration', 'openTime', 'closeTime', 'minimumUsageMinutes', 'hourlyEveningStart', 'price', 'hourlyEveningRate', 'hourlyNextDayRate', 'hourlyNextEveningRate',
  'hourlyExternalDayRate', 'hourlyExternalEveningRate', 'hourlyExternalNextDayRate', 'hourlyExternalNextEveningRate', 'hourlyExternalWeekendDayRate', 'hourlyExternalWeekendEveningRate',
  'hourlyExternalWeekendNextDayRate', 'hourlyExternalWeekendNextEveningRate'];
const propertyId = Number(db.prepare("INSERT INTO properties (name) VALUES ('Gîte')").run().lastInsertRowid);
db.prepare('UPDATE resources SET quantity = 6, turnoverMinutes = 0, bookingHorizonMonths = 120 WHERE id = ?').run(bathId);

let visits = null;
const model = bookingsModule.create(db, { standaloneVatRate: () => 20, visits: () => visits });
visits = createVisitModel({ db, bookings: () => model });

function configure(resource, { free = 0 } = {}) {
  db.prepare(`UPDATE resources SET ${RESOURCE_COLUMNS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...RESOURCE_COLUMNS.map((c) => resource[c] ?? (/^hourlyExternal(Weekend)?(Day|Evening)Rate$/.test(c) ? 0 : null)), bathId);
  db.prepare('DELETE FROM property_resource_prices WHERE resourceId = ?').run(bathId);
  db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (?, ?, NULL, ?)').run(propertyId, bathId, free);
  return { ...db.prepare('SELECT * FROM resources WHERE id = ?').get(bathId) };
}
const wipe = () => {
  db.prepare('DELETE FROM resource_bookings').run();
  db.prepare('DELETE FROM resource_booking_holds').run();
};
const rowOf = (id) => db.prepare('SELECT * FROM resource_bookings WHERE id = ?').get(id);
const bodyOf = (resource, session, extra = {}) => ({
  resourceId: bathId, date: session.date, startTime: clock(session.start), endTime: clock(session.end), clientName: 'Dehors', ...extra,
});

/** Every figure the readers give of one stored booking, in cents: `{ stored, preview, invoice, visit? }`, or the refusal text of one reader. */
function figuresOf(m, id, { visit }) {
  const row = rowOf(id);
  const preview = m.priceBooking({
    resourceId: bathId, bookingId: id, date: row.date, startTime: row.startTime, endTime: row.endTime, propertyId: row.propertyId, offeredMinutes: row.offeredMinutes,
  });
  const basis = m.invoiceBasis(id);
  const figures = { stored: cents(row.totalPrice), preview: preview.error ? `refused: ${preview.error}` : cents(preview.total), invoice: cents(basis.breakdown.total) };
  if (visit) {
    const saleId = row.saleRef ? Number(String(row.saleRef).split(':')[1]) : visits.ensureDocument(rowOf(id), { actor: 'user:1', stop: (refusal) => { throw new Error(JSON.stringify(refusal)); } });
    figures.visit = documentOf(saleId).lines.filter((line) => String(line.fulfilmentRef || '').startsWith(`hourly-slot:${id}`) && line.status !== 'cancelled').reduce((sum, line) => sum + line.totalCents, 0);
  }
  return figures;
}
const oneFigure = (figures) => Object.values(figures).every((value) => value === figures.stored);

/** I-b: one figure for every reader. */
function checkOneFigure(m, id, label, { visit }) {
  const figures = figuresOf(m, id, { visit });
  return oneFigure(figures) ? [] : [`I-b ${label}: ${JSON.stringify(figures)}`];
}

const MOVES = ['time', 'time off the grid', 'date', 'offered minutes', 'lodging on', 'lodging off'];
function moveBody(rnd, resource, row, move) {
  const slot = resource.slotDuration;
  const open = Number(resource.openTime.slice(0, 2)) * 60 + Number(resource.openTime.slice(3));
  const close = Number(resource.closeTime.slice(0, 2)) * 60 + Number(resource.closeTime.slice(3));
  const start = Number(row.startTime.slice(0, 2)) * 60 + Number(row.startTime.slice(3));
  const end = Number(row.endTime.slice(0, 2)) * 60 + Number(row.endTime.slice(3));
  const length = end - start;
  if (move === 'time') {
    const slots = Math.max(0, Math.floor((close - open - length) / slot));
    const at = open + rnd.int(0, slots) * slot;
    return { startTime: clock(at), endTime: clock(at + length) };
  }
  if (move === 'time off the grid') {
    const at = Math.min(close - length, start + (slot > 15 ? 15 : 5 * (rnd.int(1, 3)) + (slot === 5 ? 0 : 0)));
    return { startTime: clock(at), endTime: clock(at + length) };
  }
  if (move === 'date') return { date: rnd.pick(DATES) };
  if (move === 'offered minutes') return { offeredMinutes: rnd.pick([15, 30]) };
  if (move === 'lodging on') return { propertyId };
  return { propertyId: null };
}

/**
 * One random booking of `kind` ('outside' | 'lodging') through every operation, with I-b after each step and the refusals (I-c) judged on the way in.
 */
const STATS = { created: 0, refusedOnCreate: 0, moved: 0, refusedMove: 0, offered: 0 };
const HOOKS = { afterOffer: null };
function runBooking(m, rnd, resource, kind, violations) {
  const session = randomSession(rnd, resource, { onGrid: rnd.chance(0.5) });
  const label = (step) => `${kind} ${session.date} ${clock(session.start)}-${clock(session.end)} slot ${resource.slotDuration} evening ${resource.hourlyEveningStart} after ${step}`;
  const body = bodyOf(resource, session, kind === 'lodging' ? { propertyId } : {});
  const legacy = kind === 'outside of before';
  const draft = m.priceBooking({ ...body, resourceId: bathId });
  const created = m.createBooking(body);
  const unsold = (kind === 'outside' || legacy) && touchesUnsoldSlice(resource, session);
  if (draft.error || created.error) {
    // I-c on the stored half: the preview and the save refuse together, for the reason of an unsold slice, and nothing is written.
    if (Boolean(draft.error) !== Boolean(created.error) || (kind === 'outside' && !unsold && draft.code === 'BAND_NOT_SOLD')) violations.push(`I-c ${label('create')}: preview ${draft.error || 'ok'} / save ${created.error || 'ok'}`);
    STATS.refusedOnCreate += 1;
    return;
  }
  if (unsold) violations.push(`I-c ${label('create')}: an unsold slice was priced ${draft.total} €`);
  STATS.created += 1;
  const id = Number(created.id);
  if (legacy) {
    // Priced the way the release before priced it (the guests' flat rate off the grid), without the fact of the engine path.
    const before = head.priceBookingLines({ resource, startTime: body.startTime, endTime: body.endTime, external: true, engineRated: false, lodging: false, judgeBands: false });
    db.prepare('UPDATE resource_bookings SET engineRated = NULL, totalPrice = ? WHERE id = ?').run(before.total, id);
  } else if (cents(created.totalPrice) !== cents(draft.total)) violations.push(`I-b ${label('create')}: draft preview ${cents(draft.total)} vs created ${cents(created.totalPrice)}`);
  // First with no document (an outside booking that stays one, a lodging's), then with its visit document: both are real states of a booking.
  exercise(m, rnd, resource, id, label, { visit: false }, violations);
  exercise(m, rnd, resource, id, (step) => label(`${step} (with a document)`), { visit: true }, violations);
}

/**
 * The operations of a stored booking, I-b after each. `soldFigure` (cents) is the session total of the document the booking was sold on (I-e): every reader keeps returning it through every
 * save that does not move the booking.
 */
function exercise(m, rnd, resource, id, label, { visit, soldFigure = null }, violations) {
  const holds = (step, expected) => {
    const figures = figuresOf(m, id, { visit });
    if (!oneFigure(figures)) violations.push(`I-b ${label(step)}: ${JSON.stringify(figures)}`);
    else if (expected !== null && figures.stored !== expected) violations.push(`I-e ${label(step)}: the document says ${expected}, the booking reads ${JSON.stringify(figures)}`);
  };
  holds('create', soldFigure);
  const before = cents(rowOf(id).totalPrice);
  let saved = m.update(id, { notes: 'a note' });
  if (!saved.ok) violations.push(`${label('notes')}: refused ${saved.error}`);
  holds('notes-only save', soldFigure === null ? before : soldFigure);
  const row = rowOf(id);
  saved = m.update(id, {
    date: row.date, startTime: row.startTime, endTime: row.endTime, propertyId: row.propertyId, offeredMinutes: row.offeredMinutes, clientName: row.clientName, clientPhone: row.clientPhone, notes: row.notes,
    displayedTotal: row.totalPrice,
  });
  if (!saved.ok) violations.push(`${label('full resend')}: refused ${saved.error}`);
  holds('full resend', soldFigure === null ? before : soldFigure);
  // The operator offers the session at the visit (« Offrir »): the booking, the preview, the invoice and the document move together, and stay together through the moves below.
  if (visit && soldFigure === null && rnd.chance(0.4)) {
    const sessionLine = documentOf(Number(String(rowOf(id).saleRef).split(':')[1])).lines.find((line) => String(line.fulfilmentRef || '').startsWith(`hourly-slot:${id}`) && line.status !== 'cancelled');
    const wasStored = rowOf(id).totalPrice;
    if (sessionLine && visits.patchLine(rowOf(id), sessionLine.id, { offered: true }).ok) {
      STATS.offered += 1;
      if (HOOKS.afterOffer) HOOKS.afterOffer(id, wasStored);
      holds('offered at the visit', null);
    }
  }
  for (let step = 0; step < 2; step += 1) {
    const move = rnd.pick(MOVES);
    const was = rowOf(id);
    const wasFigures = figuresOf(m, id, { visit });
    const body = moveBody(rnd, resource, was, move);
    const stage = `move ${move}`;
    // What the screen shows for the move (the preview of the booking at its new place) is what the save then stores.
    const preview = m.priceBooking({
      resourceId: bathId, bookingId: id, date: body.date ?? was.date, startTime: body.startTime ?? was.startTime, endTime: body.endTime ?? was.endTime,
      propertyId: body.propertyId !== undefined ? body.propertyId : was.propertyId, offeredMinutes: body.offeredMinutes ?? was.offeredMinutes,
    });
    const moved = m.update(id, body);
    if (Boolean(preview.error) !== Boolean(moved.error) && !['BOOKING_PAID', 'BOOKING_INVOICED'].includes(moved.code)) violations.push(`I-b ${label(stage)}: the preview says ${preview.error || 'ok'} and the save ${moved.error || 'ok'}`);
    else if (!preview.error && !moved.error && cents(preview.total) !== cents(rowOf(id).totalPrice)) violations.push(`I-b ${label(stage)}: the preview of the move says ${cents(preview.total)}, the save stored ${cents(rowOf(id).totalPrice)}`);
    if (moved.error) {
      STATS.refusedMove += 1;
      const now = figuresOf(m, id, { visit });
      if (!oneFigure(now) || now.stored !== wasFigures.stored) violations.push(`I-b ${label(stage)}: a refused move changed a figure ${JSON.stringify(wasFigures)} -> ${JSON.stringify(now)}`);
    } else {
      STATS.moved += 1;
      holds(stage, null);
      const at = rowOf(id);
      const placed = { date: at.date, start: Number(at.startTime.slice(0, 2)) * 60 + Number(at.startTime.slice(3)), end: Number(at.endTime.slice(0, 2)) * 60 + Number(at.endTime.slice(3)) };
      if (!at.propertyId && !at.saleRef && touchesUnsoldSlice(resource, placed)) violations.push(`I-c ${label(stage)}: a move into an unsold slice was saved at ${at.totalPrice} €`);
    }
  }
}

function checkStored(m, rnd, scenarios) {
  const violations = [];
  for (let i = 0; i < scenarios; i += 1) {
    const resource = configure(randomResource(rnd), { free: rnd.pick([0, 30, 60]) });
    for (const kind of ['outside', 'outside', 'outside of before', 'lodging']) {
      try { runBooking(m, rnd, resource, kind, violations); } catch (err) { violations.push(`threw ${err.message}`); }
      wipe();
    }
  }
  return violations;
}

const campaigns = {};
for (const [slug, band] of [['jour', 'day'], ['soir', 'evening']]) {
  campaigns[slug] = shop.create({
    ...shop.hour, name: slug, slug, composition: { resourceId: bathId, band, minutes: 60, options: [] }, addOns: [`option:${shop.ids.drink}`], extraTimeMaxMinutes: 120, periods: ['week', 'weekend'],
  });
}
shop.settingsStore.set('leftoverDrinkArticleRef', `option:${shop.ids.drink}`);
const standardBath = (slot, evening = '19:00') => ({
  ...db.prepare('SELECT * FROM resources WHERE id = ?').get(bathId), slotDuration: slot, openTime: '10:00', closeTime: '22:00', minimumUsageMinutes: 60, hourlyEveningStart: evening, price: 25, hourlyEveningRate: 35,
  hourlyNextDayRate: null, hourlyNextEveningRate: null, hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70, hourlyExternalNextDayRate: 45, hourlyExternalNextEveningRate: 63,
  hourlyExternalWeekendDayRate: 70, hourlyExternalWeekendEveningRate: 90, hourlyExternalWeekendNextDayRate: 60, hourlyExternalWeekendNextEveningRate: 80,
});
const holidays2026 = sdk.calendar.frenchPublicHolidays(Number(f.TUESDAY.slice(0, 4))).map((h) => h.date).filter((d) => d > f.TUESDAY);
const VOUCHER_DATES = [f.TUESDAY, f.FRIDAY, f.SATURDAY, holidays2026[0], addDay(holidays2026[0], -1)];
const VOUCHER_STARTS = ['10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '18:00', '19:00', '20:00'];
// Sold on every slot and wherever the evening switch falls — on the slot grid or off it — as far as the engine can sell it (what it cannot sell is counted as skipped).
const SOLD_SLOTS = [30, 60, 120];
const SOLD_EVENINGS = ['19:00', '19:30', '19:15', '18:00'];
const sessionTotalOf = (id) => {
  const saleId = Number(String(rowOf(id).saleRef).split(':')[1]);
  return documentOf(saleId).lines.filter((line) => String(line.fulfilmentRef || '').startsWith(`hourly-slot:${id}`) && line.status !== 'cancelled').reduce((sum, line) => sum + line.totalCents, 0);
};
const SOLD = { voucher: 0, site: 0, skipped: 0, doubled: 0, extra: 0 };

/** A booking sold on a document by a voucher use (rule 17's doubled hour, a cheaper slot, extra time paid by card) — then every operation of the planning. */
async function runVoucher(m, rnd, violations) {
  const resource = configure(standardBath(rnd.pick(SOLD_SLOTS), rnd.pick(SOLD_EVENINGS)));
  const [slug, period] = rnd.pick([['jour', 'week'], ['jour', 'weekend'], ['soir', 'week'], ['soir', 'weekend']]);
  const date = rnd.pick(VOUCHER_DATES);
  const start = rnd.pick(VOUCHER_STARTS);
  const request = rnd.pick([{}, {}, { extraMinutes: 30 }, { extraMinutes: 60 }]);
  wipe();
  let voucher;
  try { voucher = shop.sell(slug, period); } catch (err) {
    // A campaign the engine cannot price on this resource (a one-hour voucher on a 120-minute slot, a band that does not fall on the slot grid) is not sold: nothing to judge.
    if (!/PRICE_UNAVAILABLE/.test(err.message)) throw err;
    SOLD.skipped += 1;
    SOLD.unsellable = (SOLD.unsellable || 0) + 1;
    return;
  }
  const recap = shop.quoteOf(voucher, date, start, request);
  if (!recap.ok) { SOLD.skipped += 1; SOLD[`vq:${recap.code}`] = (SOLD[`vq:${recap.code}`] || 0) + 1; return; }
  const confirmed = await shop.confirm(voucher, date, start, request);
  if (!confirmed.ok) { SOLD.skipped += 1; SOLD[`vc:${confirmed.code}`] = (SOLD[`vc:${confirmed.code}`] || 0) + 1; return; }
  if (confirmed.data && confirmed.data.payUrl) {
    const use = db.prepare('SELECT * FROM gift_voucher_uses ORDER BY id DESC LIMIT 1').get();
    shop.api.useService.paid({ ref: use.id, linkId: use.linkId, amountCents: use.dueCents });
    await new Promise((resolve) => setImmediate(resolve));
  }
  const made = db.prepare('SELECT id FROM resource_bookings ORDER BY id DESC LIMIT 1').get();
  if (!made) { SOLD.skipped += 1; return; }
  SOLD.voucher += 1;
  SOLD[`slot${resource.slotDuration}`] = (SOLD[`slot${resource.slotDuration}`] || 0) + 1;
  if (!resource.hourlyEveningStart || Number(resource.hourlyEveningStart.slice(3)) % resource.slotDuration) SOLD.offGridEvening = (SOLD.offGridEvening || 0) + 1;
  const id = Number(made.id);
  const span = (row) => (Number(row.endTime.slice(0, 2)) * 60 + Number(row.endTime.slice(3))) - (Number(row.startTime.slice(0, 2)) * 60 + Number(row.startTime.slice(3)));
  if (span(rowOf(id)) >= 120 + (request.extraMinutes || 0)) SOLD.doubled += 1;
  if (request.extraMinutes) SOLD.extra += 1;
  const label = (step) => `voucher ${slug}-${period} ${date} ${start} ${JSON.stringify(request)} slot ${resource.slotDuration} (${rowOf(id).startTime}-${rowOf(id).endTime}) after ${step}`;
  exercise(m, rnd, resource, id, label, { visit: true, soldFigure: sessionTotalOf(id) }, violations);
}

/** A session of the website (« Mon bain », sold by `bookOutside`): the engine's line, the sale, the booking. */
function runSite(m, rnd, violations) {
  const resource = configure(standardBath(rnd.pick(SOLD_SLOTS), rnd.pick(SOLD_EVENINGS)));
  const date = rnd.pick(DATES);
  const minutes = rnd.pick([60, 120]);
  const startMinutes = rnd.pick([600, 660, 720, 840, 1080, 1140]);
  const start = clock(startMinutes);
  wipe();
  const offer = shop.offerOfBath.offer;
  const quoted = offer.quote({
    resourceId: bathId, date, start, coveredBand: startMinutes >= Number(resource.hourlyEveningStart.slice(0, 2)) * 60 + Number(resource.hourlyEveningStart.slice(3)) ? 'evening' : 'day', coveredMinutes: minutes, coveredPeriod: 'week',
  });
  if (!quoted.ok) { SOLD.skipped += 1; SOLD[`q:${quoted.code}`] = (SOLD[`q:${quoted.code}`] || 0) + 1; return; }
  const booked = offer.bookOutside({
    resourceId: bathId, date, start, end: clock(startMinutes + minutes), customer: { name: 'Site Client' }, fulfilments: [{ ...quoted.session.line, role: 'session' }], lines: [], tenders: [], channel: 'site',
    acceptedTotalCents: quoted.session.totalCents,
  });
  if (!booked.ok) { SOLD.skipped += 1; SOLD[`b:${booked.code}`] = (SOLD[`b:${booked.code}`] || 0) + 1; return; }
  SOLD.site += 1;
  SOLD[`slot${resource.slotDuration}`] = (SOLD[`slot${resource.slotDuration}`] || 0) + 1;
  if (Number(resource.hourlyEveningStart.slice(3)) % resource.slotDuration) SOLD.offGridEvening = (SOLD.offGridEvening || 0) + 1;
  const id = Number(booked.bookingId);
  const label = (step) => `site ${date} ${start}+${minutes} slot ${resource.slotDuration} after ${step}`;
  exercise(m, rnd, resource, id, label, { visit: true, soldFigure: sessionTotalOf(id) }, violations);
}

async function checkSold(m, rnd, scenarios) {
  const violations = [];
  for (let i = 0; i < scenarios; i += 1) {
    try {
      if (i % 2 === 0) await runVoucher(m, rnd, violations); else runSite(m, rnd, violations);
    } catch (err) { violations.push(`threw ${err.stack.split('\n').slice(0, 3).join(' | ')}`); }
    wipe();
  }
  return violations;
}

test('I-e — a booking sold on a document (a voucher use with its offered hour and paid extra time, a website session) keeps the document\'s session figure on every reader and every save that does not move it', async () => {
  const violations = await checkSold(model, generator(11), 120);
  assert.ok(SOLD.voucher > 20 && SOLD.site > 20 && SOLD.doubled > 0 && SOLD.extra > 0 && SOLD.slot30 > 0 && SOLD.slot60 > 0 && SOLD.slot120 > 0 && SOLD.offGridEvening > 0, JSON.stringify(SOLD));
  assert.deepEqual(violations.slice(0, 8), []);
});

test('I-e negative control — a save that re-prices the sold session at full price (the former behaviour) is caught', async () => {
  const repricing = {
    ...model,
    update: (id, body) => {
      const out = model.update(id, body);
      if (out.ok && Object.keys(body).length === 1 && body.notes) {
        const row = rowOf(id);
        db.prepare('UPDATE resource_bookings SET totalPrice = ? WHERE id = ?').run(cents(row.totalPrice) / 100 + 45, id);
      }
      return out;
    },
  };
  const violations = await checkSold(repricing, generator(11), 20);
  assert.ok(violations.some((v) => v.startsWith('I-')), 'the harness must notice a sold booking re-priced by a notes-only save');
});

test('I-b — preview, stored total, visit session line and invoice basis are one figure through create, notes-only save, full resend and every kind of move', () => {
  const violations = checkStored(model, generator(7), 120);
  assert.ok(STATS.created > 100 && STATS.moved > 100 && STATS.offered > 10, JSON.stringify(STATS));
  assert.deepEqual(violations.slice(0, 8), []);
});

test('I-c negative control (stored half) — a preview that never refuses while the save does is caught', () => {
  const lenient = { ...model, priceBooking: (draft, options) => { const out = model.priceBooking(draft, options); return out.error ? { total: 0, lines: [], bands: [] } : out; } };
  assert.ok(checkStored(lenient, generator(7), 60).some((v) => v.startsWith('I-c')));
});

test('I-b negative control — a reader that drifts by a cent (or a save that rewrites the total) is caught', () => {
  const drifting = { ...model, invoiceBasis: (id) => { const basis = model.invoiceBasis(id); return { ...basis, breakdown: { ...basis.breakdown, total: basis.breakdown.total + 0.01 } }; } };
  assert.ok(checkStored(drifting, generator(7), 10).length > 0);
  const rewriting = { ...model, update: (id, body) => { const out = model.update(id, body); if (out.ok && Object.keys(body).length === 1 && body.notes) db.prepare('UPDATE resource_bookings SET totalPrice = totalPrice + 5 WHERE id = ?').run(id); return out; } };
  assert.ok(checkStored(rewriting, generator(7), 10).length > 0);
});

test('I-b negative control — a booking offered at the visit whose stored total is left behind, and a preview of a move that is not what the save stores, are caught', () => {
  HOOKS.afterOffer = (id, wasStored) => db.prepare('UPDATE resource_bookings SET totalPrice = ? WHERE id = ?').run(wasStored, id);
  try {
    assert.ok(checkStored(model, generator(7), 40).some((v) => /offered at the visit/.test(v)), 'a stale stored total after « Offrir » is noticed');
  } finally { HOOKS.afterOffer = null; }
  const previewDrifts = { ...model, priceBooking: (draft, options) => { const out = model.priceBooking(draft, options); return draft.bookingId && !out.error ? { ...out, total: out.total + 0.01 } : out; } };
  assert.ok(checkStored(previewDrifts, generator(7), 20).some((v) => /preview of the move/.test(v)), 'a preview of a move that differs from the save is noticed');
});
