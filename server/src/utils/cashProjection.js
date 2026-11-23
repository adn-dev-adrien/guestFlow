/**
 * Cash projection of an exercise (specs/mobile-dashboard-exercise-cash.md rule 18) — the money received and
 * the money still expected for the stays of a window, shaped for the « Trésorerie de l'exercice » card: per
 * month, and as a daily cumulative series the date cursor reads. The client only draws what is returned here.
 *
 * Rules the series rests on:
 *   - a payment received before the exercise starts is counted on its first day; one dated after « now »
 *     (impossible, but never trusted) is counted then;
 *   - an expected payment already late or due now (date past) is counted on today (rule 15) — on the exercise's
 *     last day once the exercise is over; one dated before the exercise starts on its first day;
 *   - what lands after the exercise ends sits in the « après » column, on at most AFTER_DAYS extra days.
 *
 * Pure: rows in, series out.
 */

const { exerciseMonths, MONTH_SHORT } = require('./exerciseOverview');
const { addDaysToIsoDate } = require('./devisHelpers');
const { roundMoneyOrZero: round2 } = require('./pricing/money');

const AFTER_DAYS = 31;
const AFTER_KEY = 'after';

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const monthEnd = (ym) => `${ym}-${String(new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
const dateLabel = (iso) => `${Number(iso.slice(8, 10))} ${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/**
 * @param {object} input
 * @param {Array<{ date: string, amount: number }>} input.received payments in (refunds negative), any date
 * @param {Array<{ date: string, amount: number, late?: boolean, dueNow?: boolean }>} input.expected expected payments, any date
 * @param {{ from: string, to: string }} input.exercise the exercise the x axis spans
 * @param {{ from: string, to: string }} input.window the page's window (months outside it are dimmed)
 * @param {string} input.today
 */
function buildCashProjection({ received, expected, exercise, window: win, today }) {
  const { from, to } = exercise;
  const span = daysBetween(from, to) + 1;
  const afterEnd = addDaysToIsoDate(to, AFTER_DAYS);
  // « Now » is today, or the exercise's last day once the exercise is over: what is late or due now is counted
  // there, inside the plot, and the solid line ends there.
  const now = today > to ? to : today;
  const isNow = (p) => Boolean(p.late || p.dueNow || p.date < today);
  const lateAmount = round2(expected.filter((p) => p.late).reduce((n, p) => n + p.amount, 0));

  const place = (iso) => (iso < from ? from : iso);
  const events = [
    ...received.map((p) => ({ date: place(p.date > now ? now : p.date), received: p.amount, expected: 0, late: 0 })),
    ...expected.map((p) => ({ date: place(isNow(p) ? now : p.date), received: 0, expected: p.amount, late: p.late ? p.amount : 0 })),
  ].map((e) => ({ ...e, date: e.date > afterEnd ? afterEnd : e.date }));

  const months = exerciseMonths(from, to).map((m) => ({
    key: m.month, label: m.short, title: m.label, x: daysBetween(from, `${m.month}-01` < from ? from : `${m.month}-01`),
    end: monthEnd(m.month) > to ? to : monthEnd(m.month),
    received: 0, expected: 0, late: 0, inWindow: `${m.month}-01` <= win.to && `${m.month}-31` >= win.from,
  }));
  const hasAfter = events.some((e) => e.date > to);
  if (hasAfter) months.push({ key: AFTER_KEY, label: 'après', title: 'Après l\'exercice', x: span, end: afterEnd, received: 0, expected: 0, late: 0, inWindow: true });
  const monthOf = (iso) => months.find((m) => m.key === (iso > to ? AFTER_KEY : iso.slice(0, 7)));
  for (const e of events) {
    const m = monthOf(e.date);
    m.received = round2(m.received + e.received);
    m.expected = round2(m.expected + e.expected);
    m.late = round2(m.late + e.late);
  }
  for (const m of months) m.upcoming = round2(m.expected - m.late);
  let running = 0;
  let runningReceived = 0;
  for (const m of months) {
    running = round2(running + m.received + m.expected);
    runningReceived = round2(runningReceived + m.received);
    m.cumulative = running;
    m.receivedCumulative = runningReceived;
  }

  const moved = new Map();
  for (const e of events) {
    const slot = moved.get(e.date) || { received: 0, expected: 0 };
    slot.received = round2(slot.received + e.received);
    slot.expected = round2(slot.expected + e.expected);
    moved.set(e.date, slot);
  }
  // The anchors give the curve its start, the today marker and its end, even on days with no movement.
  const anchors = [from, to, now >= from ? now : null].filter(Boolean);
  for (const a of anchors) if (!moved.has(a)) moved.set(a, { received: 0, expected: 0 });

  let cumulative = 0;
  let receivedCumulative = 0;
  const daily = [...moved.keys()].sort().map((date) => {
    const slot = moved.get(date);
    cumulative = round2(cumulative + slot.received + slot.expected);
    receivedCumulative = round2(receivedCumulative + slot.received);
    return {
      date, label: dateLabel(date), x: Math.min(daysBetween(from, date), span + AFTER_DAYS),
      received: slot.received, expected: slot.expected,
      cumulative, receivedCumulative, expectedCumulative: round2(cumulative - receivedCumulative),
      solid: date <= now ? receivedCumulative : null,
      dashed: date >= now ? cumulative : null,
    };
  });

  const end = daily[daily.length - 1].date;

  return {
    today,
    todayLabel: dateLabel(today),
    todayMonth: today < from || today > to ? null : today.slice(0, 7),
    todayX: Math.max(0, Math.min(daysBetween(from, today), span)),
    from, to, end, endLabel: dateLabel(end), endCaption: end > to ? `Une fois toutes les échéances reçues (${dateLabel(end)})` : 'À la fin de l\'exercice',
    xMax: hasAfter ? span + AFTER_DAYS : span,
    total: round2(cumulative),
    empty: events.length === 0,
    lateAmount,
    months,
    daily,
  };
}

module.exports = { buildCashProjection, dateLabel, AFTER_DAYS };
