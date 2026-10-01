// Finance dashboard model (specs/finance-dashboard-redesign.md). It COMPOSES financeModel — getSummary,
// getOperational, getProjection — and never re-derives a stay's revenue, collected amount or
// remaining-to-pay: those rules stay where they are tested. What it adds is the shaping of the page
// (one window, a logement filter, hero, tiles, charts, detail tables), occupancy and the comparison
// with last year. Every figure leaves here ready to render.

const db = require('../database');
const financeModel = require('./financeModel');
const fiscalYearUtil = require('../utils/fiscalYear');
const { resolveWindow, monthLabel } = require('../utils/financeWindow');
const occupancy = require('../utils/financeOccupancy');
const yoy = require('../utils/yearOverYear');
const { buildInsights } = require('../utils/financeInsights');
const { readRevenueGoals } = require('../utils/revenueGoals');
const { exerciseMonths } = require('../utils/exerciseOverview');
const { curveAxis, dayOffset } = require('../utils/financeCurveAxis');
const { bookingChannelOf } = require('../utils/attributionChannel');
const { isDirectChannel } = require('../utils/platformNameFormat');
const { round2 } = require('../utils/paymentStatus');
const { parseNotes } = require('../utils/midStayExtras');
const { parseGroup } = require('../utils/arrivalPaymentGroup');
const { arrivalPaymentAdjustment } = require('../utils/reservationSettlement');

const H = financeModel.helpers;

// One colour per logement, in id order, so a logement keeps its colour on every chart (§4.3).
const PROPERTY_COLORS = ['#2F5D46', '#C99038', '#31556E', '#A8433A', '#6B8F76', '#8A6B3E', '#5C4B7D', '#757575'];
const DETAIL_TILES = new Set(['collected', 'toCollect', 'late', 'stays', 'properties', 'channels']);
const CUMULATIVE_DAILY_UP_TO = 62;

const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 10000 : null);
const addDays = occupancy.addDays;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
// Same day next month, clamped to the month's end — the « Arrivées d'ici le » default (today + 1 month).
function plusOneMonth(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const max = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, max)).padStart(2, '0')}`;
}
const lastDay = (ym) => `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;

// A platform stay pays a commission on the buckets it collected off the caisse interne — the same
// buckets totalSejour nets it from.
const commissionOf = (r) => (r.depositPaidCash ? 0 : Number(r.acompteCommissionAmount || 0))
  + (r.balancePaidCash ? 0 : Number(r.platformCommissionAmount || 0));
const isPlatformStay = (r) => r.requestOrigin !== 'public' && !isDirectChannel(r.platform);

function createDashboardModel(database, finance) {
  const hasTable = (name) => {
    try { return database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) != null; }
    catch { return false; }
  };

  const properties = () => database.prepare('SELECT id, name FROM properties ORDER BY id').all()
    .map((p, i) => ({ id: p.id, name: p.name, color: PROPERTY_COLORS[i % PROPERTY_COLORS.length] }));

  const closures = () => (hasTable('establishment_closures')
    ? database.prepare('SELECT propertyId, startDate, endDate FROM establishment_closures').all()
    : []);

  const readGoals = () => {
    try { return readRevenueGoals((database.prepare('SELECT revenueGoals FROM app_settings WHERE id = 1').get() || {}).revenueGoals); }
    catch { return {}; }
  };

  // Rule 17 — the coverage starts with the earliest reservation of the scope.
  const coverage = (propertyId) => {
    const row = propertyId
      ? database.prepare("SELECT MIN(startDate) AS d FROM reservations WHERE kind = 'reservation' AND propertyId = ?").get(propertyId)
      : database.prepare("SELECT MIN(startDate) AS d FROM reservations WHERE kind = 'reservation'").get();
    return yoy.coverageMonth(row && row.d);
  };

  // Per logement, the first day it has data (rule 24): the first day of the month of its earliest stay.
  const coverageStarts = () => {
    const rows = database.prepare("SELECT propertyId, MIN(startDate) AS d FROM reservations WHERE kind = 'reservation' GROUP BY propertyId").all();
    const byId = new Map(rows.map((r) => [r.propertyId, r.d ? `${String(r.d).slice(0, 7)}-01` : null]));
    return (p) => byId.get(p.id) || null;
  };

  const stayNights = (from, to, propertyId) => database.prepare(`
    SELECT propertyId, startDate, endDate, DATE(createdAt) AS createdDay FROM reservations
    WHERE kind = 'reservation' AND endDate > ? AND startDate <= ?${propertyId ? ' AND propertyId = ?' : ''}
  `).all(...[from, to, ...(propertyId ? [propertyId] : [])]);

  // Window, exercise and logement of a request (rules 1-4). Invalid input → 400 with the page's message.
  function context(params = {}) {
    const today = H.todayIso();
    const endMonth = H.getFiscalYearEndMonth(database);
    const current = fiscalYearUtil.containing(endMonth, today);
    const exercise = fiscalYearUtil.resolve(endMonth, { key: params.fiscalYear, today });
    const resolved = resolveWindow({ exercise, kind: params.period || 'fy', month: params.month, from: params.from, to: params.to });
    if (!resolved.ok) return { ok: false, status: 400, error: resolved.error };
    const all = properties();
    let propertyId = null;
    if (params.propertyId != null && params.propertyId !== '') {
      propertyId = Number(params.propertyId);
      if (!all.some((p) => p.id === propertyId)) return { ok: false, status: 400, error: 'Logement inconnu.' };
    }
    const win = { ...resolved.window, asOf: resolved.window.to < today ? resolved.window.to : today };
    return {
      ok: true, today, propertyId, allProperties: all,
      scopeProperties: propertyId ? all.filter((p) => p.id === propertyId) : all,
      exercise: { ...exercise, isCurrent: exercise.key === current.key, previousLabel: fiscalYearUtil.boundsForEndYear(endMonth, exercise.key - 1).label },
      window: win,
    };
  }

  // The figures every part of the page shares — computed once per request.
  function figures(ctx) {
    const { window: win, exercise, propertyId, today } = ctx;
    const summary = finance.getSummary({ from: win.from, to: win.to, fiscalYear: exercise.key, propertyId });
    const cover = coverage(propertyId);
    const range = yoy.comparableRange(win, cover);
    const knownN1 = yoy.shiftYear(today, -1);
    let comparable = null;
    if (range) {
      const cur = range.complete ? summary : finance.getSummary({ from: range.current.from, to: range.current.to, fiscalYear: exercise.key, propertyId });
      const prev = finance.getSummary({ from: range.previous.from, to: range.previous.to, fiscalYear: exercise.key, propertyId, knownAt: knownN1 });
      comparable = { range, cur, prev };
    }
    return { summary, cover, comparable, knownN1 };
  }

  const directRevenueOf = (breakdown) => round2((breakdown.site.subtotal.revenue || 0)
    + breakdown.others.filter((c) => c.group === 'direct').reduce((n, c) => n + c.revenue, 0));

  function averagePlatformRate(reservations) {
    let commission = 0;
    let gross = 0;
    for (const r of reservations) {
      const c = commissionOf(r);
      if (!isPlatformStay(r) || c <= 0) continue;
      commission += c;
      gross += Number(r.totalSejour || 0) + c;
    }
    return gross > 0 ? Math.round((commission / gross) * 10000) / 10000 : null;
  }

  function getDashboard(params) {
    const ctx = context(params);
    if (!ctx.ok) return ctx;
    const { window: win, exercise, propertyId, today, allProperties, scopeProperties } = ctx;
    const { summary, cover, comparable, knownN1 } = figures(ctx);
    const operational = finance.getOperational({ propertyId });
    const everywhere = propertyId ? finance.getSummary({ from: win.from, to: win.to, fiscalYear: exercise.key }) : summary;
    const allClosures = closures();

    // Occupancy of the window (hero + strip) and per month of the exercise (chart).
    const prevExercise = { from: yoy.shiftYear(exercise.from, -1), to: yoy.shiftYear(exercise.to, -1) };
    const stays = stayNights(
      win.from < prevExercise.from ? win.from : prevExercise.from,
      win.to > exercise.to ? win.to : exercise.to,
      null,
    );
    const staysKnownN1 = stays.filter((s) => !s.createdDay || s.createdDay <= knownN1);
    const startOf = coverageStarts();
    const windowOcc = occupancy.occupancyOver(allProperties, stays, allClosures, win.from, win.to, { startOf });
    const scopeOcc = propertyId ? windowOcc.byProperty.get(propertyId) : windowOcc;
    const months = exerciseMonths(exercise.from, exercise.to);

    const occupancySeries = scopeProperties.map((p) => {
      const own = stays.filter((s) => s.propertyId === p.id);
      const ownN1 = staysKnownN1.filter((s) => s.propertyId === p.id);
      const pCover = coverage(p.id);
      return {
        propertyId: p.id, name: p.name, color: p.color,
        average: occupancy.occupancyOver([p], own, allClosures, exercise.from, exercise.to, { startOf }).rate,
        months: months.map((m) => {
          const from = `${m.month}-01`;
          const to = lastDay(m.month);
          const prevMonth = yoy.shiftMonth(m.month, -1);
          return {
            month: m.month, label: m.label, initial: m.initial,
            current: occupancy.occupancyOver([p], own, allClosures, from, to, { startOf }).rate,
            previous: yoy.isComparableMonth(m.month, pCover)
              ? occupancy.occupancyOver([p], ownN1, allClosures, `${prevMonth}-01`, lastDay(prevMonth), { startOf }).rate
              : null,
          };
        }),
      };
    });

    // Revenue per month of the exercise, with last year's month beside it when comparable (rule 22).
    const anyComparable = months.some((m) => yoy.isComparableMonth(m.month, cover));
    const exerciseSummary = win.kind === 'fy' ? summary : finance.getSummary({ from: exercise.from, to: exercise.to, fiscalYear: exercise.key, propertyId });
    const prevMonths = anyComparable
      ? finance.getSummary({ from: prevExercise.from, to: prevExercise.to, fiscalYear: exercise.key - 1, propertyId, knownAt: knownN1 }).exerciseMonths
      : [];
    const revenueMonths = exerciseSummary.exerciseMonths.map((m, i) => ({
      month: m.month, label: m.label, initial: m.initial,
      past: m.past, upcoming: m.upcoming, revenue: m.revenue, revenueHt: m.revenueHt, nights: m.nights,
      previous: yoy.isComparableMonth(m.month, cover) && prevMonths[i] ? prevMonths[i].revenue : null,
      previousLabel: monthLabel(yoy.shiftMonth(m.month, -1)),
      inWindow: m.month >= win.from.slice(0, 7) && m.month <= win.to.slice(0, 7),
    }));

    // Cumulative curve (rule 9) — last year only when the whole window is comparable.
    const daily = daysBetween(win.from, win.to) <= CUMULATIVE_DAILY_UP_TO;
    const step = daily ? 1 : 7;
    const prevStays = comparable && comparable.range.complete ? comparable.prev.reservations : null;
    const cumulative = [];
    for (let day = win.from; ; day = addDays(day, step)) {
      const d = day > win.to ? win.to : day;
      cumulative.push({
        day: d,
        x: dayOffset(win.from, d),
        current: d <= win.asOf ? round2(summary.reservations.filter((r) => r.attributionDate <= d).reduce((n, r) => n + r.totalSejour, 0)) : null,
        previous: prevStays ? round2(prevStays.filter((r) => r.attributionDate <= yoy.shiftYear(d, -1)).reduce((n, r) => n + r.totalSejour, 0)) : null,
      });
      if (d === win.to) break;
    }

    const revenue = summary.revenueTotal;
    const direct = directRevenueOf(summary.revenueByChannel);
    const goals = readGoals();
    const goalAmount = win.kind === 'fy' && !propertyId ? goals[exercise.key] : null;
    const byId = new Map(everywhere.revenueByProperty.map((p) => [p.propertyId, p]));
    const commission = round2(summary.reservations.reduce((n, r) => n + commissionOf(r), 0));
    const best = revenueMonths.reduce((b, m) => (m.past + m.upcoming > (b ? b.past + b.upcoming : -Infinity) ? m : b), null);
    const scopeRevenue = propertyId ? byId.get(propertyId) : null;
    const leader = everywhere.revenueByProperty.find((p) => p.revenue > 0);

    return {
      ok: true,
      data: {
        window: win,
        fiscalYear: ctx.exercise,
        fiscalYears: summary.fiscalYears,
        months: exerciseMonths(exercise.from, exercise.to).map((m) => ({ month: m.month, label: m.label })),
        propertyId,
        hero: {
          revenue, revenueHt: summary.revenueTotalHt, stays: summary.reservations.length, nights: summary.revenueTotalNights,
          occupancy: scopeOcc ? scopeOcc.rate : null,
          revenuePerNight: occupancy.revenuePerNight(revenue, summary.revenueTotalNights),
          directShare: ratio(direct, revenue),
          yoy: comparable ? {
            current: comparable.cur.revenueTotal, previous: comparable.prev.revenueTotal,
            change: yoy.change(comparable.cur.revenueTotal, comparable.prev.revenueTotal),
            months: comparable.range.months, totalMonths: comparable.range.totalMonths,
          } : null,
          goal: goalAmount ? { amount: goalAmount, ratio: ratio(revenue, goalAmount), remaining: round2(Math.max(0, goalAmount - revenue)) } : null,
          cumulative,
          axis: curveAxis(win.from, win.to, daily),
        },
        insights: buildInsights({
          bestMonth: best ? { month: best.month, revenue: best.past + best.upcoming, previous: best.previous } : null,
          direct: { revenue: direct, averagePlatformRate: averagePlatformRate(summary.reservations) },
          late: { count: operational.overdue.count, amount: operational.overdue.totalAmount },
        }),
        properties: allProperties.map((p) => {
          const agg = byId.get(p.id) || { revenue: 0, nights: 0 };
          const o = windowOcc.byProperty.get(p.id);
          return { propertyId: p.id, name: p.name, color: p.color, revenue: agg.revenue, occupancy: o ? o.rate : null, revenuePerNight: occupancy.revenuePerNight(agg.revenue, agg.nights) };
        }),
        totalRevenue: everywhere.revenueTotal,
        totalOccupancy: windowOcc.rate,
        tiles: {
          collected: { amount: summary.totalCollected, shareOfRevenue: ratio(summary.totalCollected, revenue) },
          toCollect: { amount: round2(operational.pending.totals.remainingToPay || 0), stays: operational.pending.reservations.length },
          late: { amount: operational.overdue.totalAmount, stays: operational.overdue.count },
          stays: { count: summary.reservations.length, upcoming: operational.upcoming.reservations.length },
          properties: propertyId
            ? { count: 1, name: scopeRevenue ? scopeRevenue.propertyName : '', revenue: scopeRevenue ? scopeRevenue.revenue : 0, revPar: occupancy.revPar(scopeRevenue ? scopeRevenue.revenue : 0, scopeOcc ? scopeOcc.sellable : 0) }
            : { count: allProperties.length, leader: leader ? leader.propertyName : null },
          channels: { commission },
        },
        revenueMonths,
        occupancy: occupancySeries,
      },
    };
  }

  // « Encaissé » (rule 13): every payment received for the window's stays, dated, so that the
  // table adds up to the tile (Σ comptaCollected). Same buckets, same exclusions (caisse interne,
  // internal refunds), same commission netting as utils/reservationSettlement.comptaCollected.
  function paymentsLedger(reservations) {
    const ids = reservations.map((r) => r.id);
    const refunds = ids.length && hasTable('reservation_refunds')
      ? database.prepare(`SELECT reservationId, refundDate, totalTtc FROM reservation_refunds WHERE method <> 'internal' AND reservationId IN (${ids.map(() => '?').join(',')})`).all(...ids)
      : [];
    const rows = [];
    for (const r of reservations) {
      const base = {
        reservationId: r.id, clientName: `${r.firstName || ''} ${r.lastName || ''}`.trim(),
        propertyName: r.propertyName, platform: r.platform,
      };
      const day = (d) => (d ? String(d).slice(0, 10) : r.attributionDate);
      const add = (date, kind, label, amount) => { if (round2(amount) !== 0) rows.push({ ...base, date: day(date), kind, label, amount: round2(amount) }); };
      if (r.depositPaid && !r.depositPaidCash) add(r.depositPaidDate, 'deposit', 'Acompte', Number(r.depositAmount || 0) - Number(r.acompteCommissionAmount || 0));
      if (r.balancePaid && !r.balancePaidCash) add(r.balancePaidDate, 'balance', isPlatformStay(r) ? 'Versement plateforme' : 'Solde', Number(r.balanceAmount || 0) - Number(r.platformCommissionAmount || 0));
      if (r.complementPaid && !r.complementPaidCash) add(r.complementPaidDate, 'complement', 'Complément', Number(r.complementAmount || 0));
      if (r.endOfStayComplementPaid && !r.endOfStayComplementPaidCash) add(r.endOfStayComplementPaidDate, 'endOfStay', 'Complément fin de séjour', Number(r.endOfStayComplementAmount || 0));
      for (const n of parseNotes(r.midStaySettledNotes)) {
        if (Number(n.paidCash || 0) === 0) add(n.paidDate, 'note', 'Note en séjour', Number(n.total) || 0);
      }
      const adjustment = arrivalPaymentAdjustment(r).net;
      if (adjustment) add((parseGroup(r.arrivalPaymentGroup) || {}).at, 'adjustment', adjustment > 0 ? 'Pourboire à l\'arrivée' : 'Réduction à l\'arrivée', adjustment);
      for (const f of refunds.filter((x) => x.reservationId === r.id)) add(f.refundDate, 'refund', 'Remboursement', -Number(f.totalTtc || 0));
    }
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.reservationId - a.reservationId);
    return rows;
  }

  function getDashboardDetail(tile, params = {}) {
    if (!DETAIL_TILES.has(tile)) return { ok: false, status: 404, error: 'Tableau inconnu.' };
    const ctx = context(params);
    if (!ctx.ok) return ctx;
    const { window: win, exercise, propertyId, today, scopeProperties } = ctx;

    if (tile === 'late' || tile === 'toCollect' || (tile === 'stays' && params.scope === 'upcoming')) {
      const op = finance.getOperational({ propertyId });
      if (tile === 'late') return { ok: true, data: { rows: op.overdue.reservations, totals: { amount: op.overdue.totalAmount, count: op.overdue.count } } };
      if (tile === 'stays') return { ok: true, data: { scope: 'upcoming', rows: op.upcoming.reservations, totals: op.upcoming.totals } };
      const until = /^\d{4}-\d{2}-\d{2}$/.test(String(params.until || '')) ? params.until : plusOneMonth(today);
      const projection = finance.getProjection({ date: until, propertyId });
      return { ok: true, data: { rows: op.pending.reservations, totals: op.pending.totals, projection: { until, total: projection.total, collected: projection.collected, pending: projection.pending } } };
    }

    const { summary, comparable } = figures(ctx);

    if (tile === 'collected') {
      const rows = paymentsLedger(summary.reservations);
      return { ok: true, data: { rows, totals: { amount: summary.totalCollected, count: rows.length } } };
    }

    if (tile === 'stays') {
      const rows = summary.reservations.map((r) => ({
        id: r.id, clientName: `${r.firstName || ''} ${r.lastName || ''}`.trim(), propertyName: r.propertyName,
        startDate: r.startDate, endDate: r.endDate, platform: r.platform, nights: r.nights, totalSejour: r.totalSejour,
        settled: r.settled, remainingDue: r.remainingDue,
        depositDisabled: Boolean(r.depositDisabled), depositPaid: Boolean(r.depositPaid), depositDueDate: r.depositDueDate,
        balancePaid: Boolean(r.balancePaid), balanceDueDate: r.balanceDueDate,
      }));
      return { ok: true, data: { scope: 'window', rows, totals: { count: rows.length, nights: summary.revenueTotalNights, totalSejour: summary.revenueTotal } } };
    }

    if (tile === 'properties') {
      const stays = stayNights(win.from, win.to, propertyId);
      const occ = occupancy.occupancyOver(scopeProperties, stays, closures(), win.from, win.to, { startOf: coverageStarts() });
      const curBy = new Map((comparable ? comparable.cur : summary).revenueByProperty.map((p) => [p.propertyId, p]));
      const prevBy = comparable ? new Map(comparable.prev.revenueByProperty.map((p) => [p.propertyId, p])) : null;
      const rows = scopeProperties.map((p) => {
        const agg = summary.revenueByProperty.find((x) => x.propertyId === p.id) || { revenue: 0, revenueHt: 0, nights: 0 };
        const o = occ.byProperty.get(p.id);
        const prev = prevBy && prevBy.get(p.id);
        return {
          propertyId: p.id, name: p.name, color: p.color, nights: agg.nights,
          occupancy: o.rate, revenuePerNight: occupancy.revenuePerNight(agg.revenue, agg.nights), revPar: occupancy.revPar(agg.revenue, o.sellable),
          revenue: agg.revenue, revenueHt: agg.revenueHt,
          change: prev ? yoy.change((curBy.get(p.id) || { revenue: 0 }).revenue, prev.revenue) : null,
        };
      });
      return {
        ok: true,
        data: {
          rows,
          totals: {
            nights: summary.revenueTotalNights, occupancy: occ.rate, revenuePerNight: occupancy.revenuePerNight(summary.revenueTotal, summary.revenueTotalNights),
            revPar: occupancy.revPar(summary.revenueTotal, occ.sellable), revenue: summary.revenueTotal, revenueHt: summary.revenueTotalHt,
          },
          comparableMonths: comparable ? { months: comparable.range.months, totalMonths: comparable.range.totalMonths } : null,
        },
      };
    }

    // « Canaux » — the channel breakdown of the window with what each channel cost (rule 13).
    const commissionByKey = new Map();
    for (const r of summary.reservations) {
      const key = bookingChannelOf(r, isDirectChannel).key;
      commissionByKey.set(key, (commissionByKey.get(key) || 0) + commissionOf(r));
    }
    const revenue = summary.revenueTotal;
    const withCost = (row) => {
      const c = round2(commissionByKey.get(row.key) || 0);
      return { ...row, commission: c, gross: round2(row.revenue + c), share: ratio(row.revenue, revenue) };
    };
    const b = summary.revenueByChannel;
    const siteRows = b.site.rows.filter((r) => r.reservations > 0 || r.requests > 0).map(withCost);
    const others = b.others.filter((r) => r.reservations > 0).map(withCost);
    const commission = round2([...siteRows, ...others].reduce((n, r) => n + r.commission, 0));
    return {
      ok: true,
      data: {
        site: { rows: siteRows, subtotal: { ...b.site.subtotal, commission: 0, gross: b.site.subtotal.revenue, share: ratio(b.site.subtotal.revenue, revenue) } },
        others,
        total: { ...b.total, commission, gross: round2(b.total.revenue + commission), share: revenue > 0 ? 1 : null },
      },
    };
  }

  return { getDashboard, getDashboardDetail };
}

const defaultModel = createDashboardModel(db, financeModel);
defaultModel.buildModel = (database) => createDashboardModel(database, financeModel.buildModel(database));

module.exports = defaultModel;
