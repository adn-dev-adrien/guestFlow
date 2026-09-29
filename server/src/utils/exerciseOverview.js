// Exercise overview shaping — pure helpers, no DB, no clock (specs/finance-exercise-overview-charts.md).
// financeModel.getSummary feeds them the aggregates it already builds over the selected exercise, so the
// months, logements and channels all add up to `yearTotal` by construction (spec rule 3).

const { round2 } = require('./paymentStatus');

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];
const MAX_CHANNEL_SLICES = 5;

// Every month of the exercise, in exercise order (a September closing starts in October) — rule 8.
function exerciseMonths(from, to) {
  const out = [];
  let year = Number(String(from).slice(0, 4));
  let month = Number(String(from).slice(5, 7));
  const endKey = String(to).slice(0, 7);
  for (let guard = 0; guard < 24; guard += 1) {
    const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
    if (key > endKey) break;
    const name = MONTH_NAMES[month - 1];
    out.push({ month: key, label: `${name} ${year}`, initial: name[0].toUpperCase() });
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

// Whole percents that sum to exactly 100 (largest remainder) — rule 14. Null when there is no total.
function percentages(values) {
  const total = values.reduce((n, v) => n + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => null);
  const raw = values.map((v) => (Math.max(0, v) / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((n, v) => n + v, 0);
  raw
    .map((r, i) => ({ rest: r - floors[i], i }))
    .sort((a, b) => b.rest - a.rest)
    .forEach(({ i }) => { if (left > 0) { floors[i] += 1; left -= 1; } });
  return floors;
}

const isDirectGroup = (agg) => agg.group === 'site' || agg.group === 'direct';

// « Part en direct » — website bookings + saisie directe over the exercise total (rule 6).
function directShare(channelAggs, total) {
  const revenue = round2(channelAggs.filter(isDirectGroup).reduce((n, c) => n + c.revenue, 0));
  return { revenue, percent: total > 0 ? Math.round((revenue / total) * 100) : null };
}

// Donut slices (rules 13-15): Direct merged into one slice, one slice per platform, revenue desc, at
// most five — the smallest fold into « Autres ». `platform` is the key the client colours by. A channel
// with no revenue (an iCal import carrying no amount) has no slice to draw and is left out.
function channelSlices(channelAggs) {
  const direct = { key: 'direct', label: 'Direct', platform: 'direct', revenue: 0, reservations: 0 };
  const platforms = [];
  for (const c of channelAggs) {
    if (isDirectGroup(c)) {
      direct.revenue += c.revenue;
      direct.reservations += c.reservations;
    } else {
      platforms.push({ key: c.key, label: c.label, platform: c.label, revenue: c.revenue, reservations: c.reservations });
    }
  }
  let slices = [direct].concat(platforms)
    .filter((c) => c.revenue > 0)
    .sort((a, b) => (b.revenue - a.revenue) || a.label.localeCompare(b.label, 'fr'));
  if (slices.length > MAX_CHANNEL_SLICES) {
    const rest = slices.slice(MAX_CHANNEL_SLICES - 1);
    slices = slices.slice(0, MAX_CHANNEL_SLICES - 1).concat({
      key: 'others',
      label: 'Autres',
      platform: null,
      revenue: rest.reduce((n, c) => n + c.revenue, 0),
      reservations: rest.reduce((n, c) => n + c.reservations, 0),
    });
  }
  const percents = percentages(slices.map((s) => s.revenue));
  return slices.map((s, i) => ({ ...s, revenue: round2(s.revenue), percent: percents[i] }));
}

// « Par logement » (rule 12): logements with revenue, each bar relative to the first one. The input is
// already sorted revenue desc by financeModel.finalizeByProperty.
function propertyRatios(byProperty) {
  const kept = byProperty.filter((p) => p.revenue > 0);
  const top = kept.length ? kept[0].revenue : 0;
  return kept.map((p) => ({
    propertyId: p.propertyId,
    propertyName: p.propertyName,
    revenue: p.revenue,
    ratio: top > 0 ? Math.round((p.revenue / top) * 1000) / 1000 : 0,
  }));
}

module.exports = { exerciseMonths, percentages, directShare, channelSlices, propertyRatios, MAX_CHANNEL_SLICES };
