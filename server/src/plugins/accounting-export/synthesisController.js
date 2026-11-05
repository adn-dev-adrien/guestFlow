/**
 * Accounting synthesis controller (specs/accounting-synthesis.md §4.3) — `GET /api/accounting/synthesis`.
 * Orchestrates: the period (synthesisPeriod), the reads (synthesisModel), the shaping (synthesis). Every
 * figure leaves ready to render, each panel naming its source (D-HC8): the stays' amounts or the
 * collections, never both in one panel.
 */

const sdk = require('../sdk');
const { resolvePeriod, bucketsOf, monthsOf, isWholeMonths, periodOptions } = require('./synthesisPeriod');
const {
  ventilate, vatReturn, balanceCheck, vatCheck, collectionUnits, collections, refundsOf, series,
} = require('./synthesis');

const financeWindow = sdk.coreModule('financeWindow');
const fiscalYearUtil = sdk.coreModule('fiscalYear');
const yoy = sdk.coreModule('yearOverYear');
const { dateWindowMessage, horizonStart } = sdk.coreModule('stayDates');
const { remainingToPay } = sdk.coreModule('reservationSettlement');

const SOURCE = Object.freeze({ stays: 'stays', collections: 'collections' });

// Rule 5 — what the VAT tile says instead of a figure outside the VAT (vat-optional-mode's two mentions).
const NOT_SUBJECT_LABELS = {
  art_293_b: 'Franchise en base de TVA',
  art_261_d_4: 'Exonération de TVA',
};

const TAX_WHOLE_MONTHS = 'La taxe de séjour se déclare par mois entiers.';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pill = (current, previous) => ({ current: round2(current), previous: round2(previous), change: yoy.change(current, previous) });

/**
 * @returns {{ ok: true, data: object } | { ok: false, status: number, error: string }}
 */
function buildSynthesis(model, query = {}, plan = undefined) {
  const today = model.today();
  const fiscalEndMonth = model.fiscalEndMonth();
  const resolved = resolvePeriod({
    query, today, fiscalEndMonth, fiscalYear: fiscalYearUtil, resolveCustom: financeWindow.resolveWindow, dateWindowMessage,
  });
  if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };
  const { window: win, exercise } = resolved;

  const meansOf = model.meansResolver();
  const read = (from, to) => {
    const items = ventilate(model.entriesBetween(from, to), plan);
    return { items, units: collectionUnits(items, meansOf) };
  };
  const taxOf = (from, to) => (isWholeMonths(from, to) ? model.touristTax(monthsOf(from, to), today) : null);

  const current = read(win.from, win.to);
  const vat = vatReturn(current.items, plan);
  const money = collections(current.units);
  const summary = model.summary({ from: win.from, to: win.to, fiscalYear: exercise.key });
  const tax = taxOf(win.from, win.to);

  // Rule 9 — one comparison for every tile, on the comparable part of the window only.
  // The sentence is the dashboard's own (utils/financeComparison status.notice): one window, one sentence.
  const { range, snapshotKnown, knownN1, status } = model.lastYearRange(win, today);
  let yoyOf = { revenue: null, collected: null, touristTax: null, vat: null };
  let previousUnits = null;
  if (range) {
    const part = range.complete ? current : read(range.current.from, range.current.to);
    const previous = read(range.previous.from, range.previous.to);
    const partSummary = range.complete ? summary : model.summary({ from: range.current.from, to: range.current.to, fiscalYear: exercise.key });
    const previousSummary = model.summary({ from: range.previous.from, to: range.previous.to, fiscalYear: exercise.key, knownAt: snapshotKnown ? knownN1 : null });
    const partTax = tax ? (range.complete ? tax : taxOf(range.current.from, range.current.to)) : null;
    const previousTax = tax ? taxOf(range.previous.from, range.previous.to) : null;
    yoyOf = {
      revenue: pill(partSummary.revenueTotalHt, previousSummary.revenueTotalHt),
      collected: pill(collections(part.units).total, collections(previous.units).total),
      touristTax: partTax && previousTax ? pill(partTax.amount, previousTax.amount) : null,
      vat: pill(vatReturn(part.items, plan).totals.vat, vatReturn(previous.items, plan).totals.vat),
    };
    if (range.complete) previousUnits = previous.units;
  }
  const comparison = {
    comparable: Boolean(range),
    complete: Boolean(range && range.complete),
    months: range ? range.months : 0,
    totalMonths: range ? range.totalMonths : yoy.monthsTouched(win.from, win.to),
    current: range ? range.current : null,
    previous: range ? range.previous : null,
    reasonCode: status.reason,
    comparableFrom: status.comparableFrom || null,
    notice: status.notice,
  };

  const regime = model.regimeInForce();
  const notSubject = regime && regime.regime === 'not_subject' && vat.totals.vat === 0
    ? { regime: 'not_subject', mention: regime.legalMention || null, label: NOT_SUBJECT_LABELS[regime.legalMention] || NOT_SUBJECT_LABELS.art_293_b }
    : null;

  // Rule 17 — the stays of the window already over that still owe money.
  const unsettled = summary.reservations
    .filter((r) => r.endDate < today && !r.settled)
    .map((r) => ({
      reservationId: r.id,
      name: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
      propertyName: r.propertyName || '',
      endDate: r.endDate,
      remaining: remainingToPay(r),
    }));

  const buckets = bucketsOf(win);

  return {
    ok: true,
    data: {
      window: win,
      today,
      fiscalYear: { key: exercise.key, label: exercise.label, from: exercise.from, to: exercise.to },
      fiscalYears: (summary.fiscalYears || []).map((f) => ({ key: f.key, label: f.label, isCurrent: Boolean(f.isCurrent) })),
      periodOptions: (() => {
        // Rule 22 — from the oldest exercise (never before the entered-date window) to the server's month.
        const oldest = (summary.fiscalYears || []).reduce((min, f) => (f.from && f.from < min ? f.from : min), exercise.from);
        const floor = horizonStart(today);
        const first = [oldest, win.from].reduce((a, b) => (b < a ? b : a));
        const last = win.to > today ? win.to : today;
        return periodOptions({ firstMonth: (first < floor ? floor : first).slice(0, 7), lastMonth: last.slice(0, 7) });
      })(),
      counts: { payments: money.payments, entries: current.items.length },
      comparison,
      kpis: {
        revenue: {
          source: SOURCE.stays,
          ht: round2(summary.revenueTotalHt),
          ttc: round2(summary.revenueTotal),
          showHt: Boolean(summary.showHt),
          stays: summary.reservations.length,
          yoy: yoyOf.revenue,
        },
        collected: {
          source: SOURCE.collections,
          amount: money.total,
          payments: money.payments,
          refunds: refundsOf(current.items),
          yoy: yoyOf.collected,
        },
        touristTax: {
          source: SOURCE.stays,
          amount: tax ? tax.amount : null,
          stays: tax ? tax.stays : null,
          reason: tax ? null : TAX_WHOLE_MONTHS,
          yoy: yoyOf.touristTax,
        },
        vat: {
          source: SOURCE.collections,
          amount: notSubject ? null : vat.totals.vat,
          byRate: vat.byRate.filter((r) => r.ratePercent > 0).map((r) => ({ ratePercent: r.ratePercent, vat: r.vat })),
          // Rule 25 — the tile's « dont 10 % : … »: the rate that carries the most VAT.
          mainRate: vat.byRate.filter((r) => r.ratePercent > 0 && r.vat > 0)
            .reduce((best, r) => (!best || r.vat > best.vat ? { ratePercent: r.ratePercent, vat: r.vat } : best), null),
          notSubject,
          yoy: notSubject ? null : yoyOf.vat,
        },
      },
      vatReturn: { source: SOURCE.collections, ...vat },
      checks: {
        balanced: { source: SOURCE.collections, ...balanceCheck(current.items) },
        vatCoherence: { source: SOURCE.collections, ...vatCheck(current.items) },
        settled: { source: SOURCE.stays, status: unsettled.length === 0 ? 'ok' : 'gap', count: unsettled.length, stays: unsettled },
        lastExport: (() => {
          const stamp = model.lastCsvExport();
          return stamp ? { ...stamp, monthLabel: financeWindow.monthLabel(stamp.month) } : null;
        })(),
      },
      collections: {
        source: SOURCE.collections,
        total: money.total,
        payments: money.payments,
        byMeans: money.byMeans,
        byType: money.byType,
        series: {
          granularity: win.granularity,
          previousAvailable: Boolean(previousUnits),
          buckets: series({ buckets, window: win, today, units: current.units, previousUnits, shiftYear: yoy.shiftYear }),
        },
      },
    },
  };
}

function createSynthesisController(getModel, { plan = () => undefined } = {}) {
  return {
    synthesis(req, res) {
      const result = buildSynthesis(getModel(), req.query || {}, plan());
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json(result.data);
    },
  };
}

module.exports = { create: createSynthesisController, buildSynthesis };
