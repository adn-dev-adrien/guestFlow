// « Profil des séjours » (specs/stay-profile.md). It COMPOSES the Suivi financier: the window, the
// logement filter and their refusals are the dashboard's (`context`), the stays and their « total de
// séjour » are financeModel.getSummary's, the channel is the « Canaux » tile's (`bookingChannelOf`),
// and last year follows the dashboard's own comparability (coverage + tracking start). What it adds
// is the bucketing (utils/stayProfile.js) and the monthly average basket.

const financeModel = require('./financeModel');
const dashboardModel = require('./financeDashboardModel');
const yoy = require('../utils/yearOverYear');
const { exerciseMonths } = require('../utils/exerciseOverview');
const { monthLabel } = require('../utils/financeWindow');
const { bookingChannelOf } = require('../utils/attributionChannel');
const { isDirectChannel } = require('../utils/platformNameFormat');
const { bookingDayOf } = require('../utils/vatRegime');
const { profileOf, basketOf, basketDelta } = require('../utils/stayProfile');
const { DIRECT_CHANNEL } = require('../constants/stayProfileBuckets');

// Rule 15 (D-HC8) — every panel names the money it reads; this page reads stay totals only.
const SOURCE = 'stays';
const SOURCE_LABEL = 'Sur les montants des séjours';
const BASKET_SOURCE_LABEL = 'Sur les montants des séjours, hors taxe de séjour';

const DIMENSIONS = [
  { key: 'channel', label: 'Canal' },
  { key: 'length', label: 'Durée' },
  { key: 'lead', label: 'Délai' },
  { key: 'price', label: 'Tranche de prix' },
];

// Rule 5 — a platform keeps the « Canaux » tile's row (key and label); every own channel is « Direct ».
function channelOf(r) {
  const ch = bookingChannelOf(r, isDirectChannel);
  return ch.group === 'platform' ? { key: ch.key, label: ch.label } : DIRECT_CHANNEL;
}

const toStay = (paceStartOf) => (r) => ({
  totalSejour: r.totalSejour,
  nights: r.nights,
  startDate: r.startDate,
  bookedOn: bookingDayOf(r.createdAt),
  paceStart: paceStartOf(r.propertyId),
  channel: channelOf(r),
});

function byMonth(reservations) {
  const out = new Map();
  for (const r of reservations) {
    const ym = String(r.attributionDate).slice(0, 7);
    if (!out.has(ym)) out.set(ym, []);
    out.get(ym).push(r);
  }
  return out;
}

function createStayProfileModel(finance, dashboard) {
  const withTax = (reservations) => finance.withTouristTaxInTotal(reservations);

  // Rules 11-13 — the average basket per month of the selected exercise, last year beside it on the
  // months the dashboard compares.
  function basket(ctx, exerciseSummary, paceStart) {
    const { exercise, propertyId, today } = ctx;
    const cover = dashboard.coverage(propertyId);
    const snapshotKnown = yoy.lastYearSnapshotKnown(today, paceStart);
    const months = exerciseMonths(exercise.from, exercise.to);
    const readings = months.map((m) => (yoy.isComparableMonth(m.month, cover) ? yoy.lastYearReading(m.month, { today, snapshotKnown }) : null));
    const comparable = readings.some(Boolean);
    const previous = comparable
      ? finance.getSummary({
        from: yoy.shiftYear(exercise.from, -1),
        to: yoy.shiftYear(exercise.to, -1),
        fiscalYear: exercise.key - 1,
        propertyId,
        knownAt: snapshotKnown ? yoy.shiftYear(today, -1) : null,
      })
      : null;
    const cur = byMonth(withTax(exerciseSummary.reservations));
    const prev = previous ? byMonth(withTax(previous.reservations)) : new Map();
    const rows = months
      .map((m, i) => {
        const current = basketOf(cur.get(m.month) || []);
        const last = readings[i] ? basketOf(prev.get(yoy.shiftMonth(m.month, -1)) || []) : null;
        return { month: m.month, label: m.label, short: m.short, current, previous: last, delta: basketDelta(current, last) };
      })
      .filter((r) => r.current.stays > 0 || (r.previous && r.previous.stays > 0));
    return {
      source: SOURCE,
      sourceLabel: BASKET_SOURCE_LABEL,
      excludesTouristTax: true,
      currentLabel: exercise.label,
      previousLabel: exercise.previousLabel,
      comparable,
      // Rule 24 — an exercise over before the history starts has nothing to wait for: no notice.
      notice: !comparable && cover && exercise.to >= `${cover}-01`
        ? `Historique depuis ${monthLabel(cover)} : pas encore d'an dernier à comparer.`
        : null,
      rows,
    };
  }

  function getStayProfile(params = {}) {
    const ctx = dashboard.context(params);
    if (!ctx.ok) return ctx;
    const { window: win, exercise, propertyId, allProperties } = ctx;
    const summary = finance.getSummary({ from: win.from, to: win.to, fiscalYear: exercise.key, propertyId });
    const paceStart = dashboard.trackingStart(propertyId);
    // Rule 23 — one tracking start per logement, so the logements' breakdowns add up to « Tous ».
    const starts = new Map();
    const paceStartOf = (id) => {
      if (!starts.has(id)) starts.set(id, dashboard.trackingStart(id));
      return starts.get(id);
    };
    const profile = profileOf(summary.reservations.map(toStay(paceStartOf)));
    const exerciseSummary = win.kind === 'fy'
      ? summary
      : finance.getSummary({ from: exercise.from, to: exercise.to, fiscalYear: exercise.key, propertyId });
    return {
      ok: true,
      data: {
        window: win,
        fiscalYear: ctx.exercise,
        fiscalYears: summary.fiscalYears,
        months: exerciseMonths(exercise.from, exercise.to).map((m) => ({ month: m.month, label: m.label })),
        propertyId,
        properties: allProperties.map((p) => ({ id: p.id, name: p.name })),
        empty: profile.totals.count === 0,
        totals: profile.totals,
        dimensions: DIMENSIONS.map((d) => ({ ...d, source: SOURCE, sourceLabel: SOURCE_LABEL, rows: profile[d.key] })),
        basket: basket(ctx, exerciseSummary, paceStart),
      },
    };
  }

  return { getStayProfile };
}

let defaultModel = null;
// The production model, built on first use so that requiring this file opens no database.
function getStayProfile(params) {
  defaultModel = defaultModel || createStayProfileModel(financeModel, dashboardModel);
  return defaultModel.getStayProfile(params);
}

function buildModel(database) {
  return createStayProfileModel(financeModel.buildModel(database), dashboardModel.buildModel(database));
}

module.exports = { getStayProfile, buildModel, channelOf, DIMENSIONS };
