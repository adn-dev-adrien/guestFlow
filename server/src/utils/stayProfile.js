// « Profil des séjours » (specs/stay-profile.md §3). Pure: plain stays in, ready-to-render
// breakdowns out. The bucket boundaries live in constants/stayProfileBuckets.js.
//
// A stay is `{ totalSejour, nights, startDate, bookedOn, channel: { key, label } }`: `totalSejour` the
// page's « total de séjour » (financeModel), `bookedOn` the day its fiche was created.

const {
  LENGTH_BUCKETS, LEAD_BUCKETS, LEAD_UNKNOWN, PRICE_BUCKETS, PRICE_UNPRICED, MAX_ROWS, OTHER_ROW,
} = require('../constants/stayProfileBuckets');
const { change } = require('./yearOverYear');

const DAY = 86400000;
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const cents = (euros) => Math.round(Number(euros || 0) * 100);
const euros = (c) => c / 100;
const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

/** The first bucket whose inclusive `max` the value does not exceed (rules 6-8). */
function bucketOf(value, buckets) {
  return buckets.find((b) => b.max == null || value <= b.max);
}

/**
 * Rule 9 — whole percents that add up to exactly 100 (largest remainder). Null for every row when the
 * total is not positive or a value is negative: no share can be read then.
 */
function percentShares(values) {
  const total = values.reduce((n, v) => n + v, 0);
  if (!(total > 0) || values.some((v) => v < 0)) return values.map(() => null);
  const raw = values.map((v) => (v * 100) / total);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((n, v) => n + v, 0);
  const order = raw
    .map((r, i) => ({ i, rest: r - Math.floor(r), v: values[i] }))
    .sort((a, b) => (b.rest - a.rest) || (b.v - a.v) || (a.i - b.i));
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

/**
 * Rule 7 — days from the booking day to the arrival, or null when the booking day cannot be trusted:
 * missing, before the tracking start (the initial import, specs/booking-pace.md rule 8), or after the
 * arrival (a fiche entered once the guest was there).
 */
function leadDays(bookedOn, startDate, paceStart) {
  if (!bookedOn || !startDate) return null;
  if (!paceStart || bookedOn < paceStart) return null;
  const days = Math.round((toMs(String(startDate).slice(0, 10)) - toMs(bookedOn)) / DAY);
  return days >= 0 ? days : null;
}

// Rule 9 — count, amount, both shares and both bar lengths of each row.
function finish(rows) {
  const countPercents = percentShares(rows.map((r) => r.count));
  const amountPercents = percentShares(rows.map((r) => r.cents));
  const maxCount = Math.max(0, ...rows.map((r) => r.count));
  const maxCents = Math.max(0, ...rows.map((r) => r.cents));
  return rows.map((r, i) => ({
    key: r.key,
    label: r.label,
    ...(r.other ? { other: true, parts: r.parts } : {}),
    count: r.count,
    amount: euros(r.cents),
    countPercent: countPercents[i],
    amountPercent: amountPercents[i],
    // Rule 16 — the same whole percents as 0–1 shares, for the share table (widths add up to 100 %).
    countShare: countPercents[i] == null ? null : countPercents[i] / 100,
    amountShare: amountPercents[i] == null ? null : amountPercents[i] / 100,
    countBar: maxCount > 0 ? round4(r.count / maxCount) : 0,
    amountBar: maxCents > 0 ? round4(Math.max(0, r.cents) / maxCents) : 0,
  }));
}

/**
 * Rule 29 — at most five rows: past five, the first four by rank stay and the rest fold into one
 * « Autres » row (`other: true`, `parts` = the folded labels in rank order), summed before the shares
 * are computed so they still add up to 100. As the accounting synthesis does (its rule 37).
 */
function foldTail(rows) {
  if (rows.length <= MAX_ROWS) return rows;
  const kept = rows.slice(0, MAX_ROWS - 1);
  const rest = rows.slice(MAX_ROWS - 1);
  return [...kept, {
    ...OTHER_ROW,
    other: true,
    parts: rest.map((r) => r.label),
    count: rest.reduce((n, r) => n + r.count, 0),
    cents: rest.reduce((n, r) => n + r.cents, 0),
  }];
}

function tally(stays, keyOf, seed) {
  const rows = new Map(seed.map((b) => [b.key, { key: b.key, label: b.label, count: 0, cents: 0 }]));
  for (const s of stays) {
    const b = keyOf(s);
    const row = rows.get(b.key) || { key: b.key, label: b.label, count: 0, cents: 0 };
    row.count += 1;
    row.cents += cents(s.totalSejour);
    rows.set(b.key, row);
  }
  return rows;
}

// Rule 10 — fixed buckets in their natural order, every one listed; the « inconnue » / « sans
// montant » row last, only when it holds a stay.
function fixed(stays, buckets, keyOf, extra) {
  const rows = tally(stays, keyOf, buckets);
  const list = buckets.map((b) => rows.get(b.key));
  const special = rows.get(extra.key);
  if (special && special.count > 0) list.push(special);
  return finish(list);
}

const lengthOf = (s) => bucketOf(Number(s.nights || 0), LENGTH_BUCKETS);

// Rule 23 — each stay is judged against the tracking start of its own logement (`s.paceStart`).
const leadOf = (s) => {
  const days = leadDays(s.bookedOn, s.startDate, s.paceStart);
  return days == null ? LEAD_UNKNOWN : bucketOf(days, LEAD_BUCKETS);
};

const priceOf = (s) => (cents(s.totalSejour) === 0 ? PRICE_UNPRICED : bucketOf(cents(s.totalSejour), PRICE_BUCKETS));

/**
 * The four breakdowns of a window's stays (rules 4-10). Each stay carries `paceStart`, the tracking
 * start of its logement (rule 23).
 * @param {Array} stays
 */
function profileOf(stays) {
  const channelRows = foldTail(Array.from(tally(stays, (s) => s.channel, []).values())
    .sort((a, b) => (b.cents - a.cents) || (b.count - a.count) || a.label.localeCompare(b.label, 'fr')));
  const totalCents = stays.reduce((n, s) => n + cents(s.totalSejour), 0);
  return {
    totals: { count: stays.length, amount: euros(totalCents) },
    channel: finish(channelRows),
    length: fixed(stays, LENGTH_BUCKETS, lengthOf, { key: '' }),
    lead: fixed(stays, LEAD_BUCKETS, leadOf, LEAD_UNKNOWN),
    price: fixed(stays, PRICE_BUCKETS, priceOf, PRICE_UNPRICED),
  };
}

/**
 * Rules 14 and 22 (D-HC8, D-HC9) — a stay's « total de séjour » without the tourist tax it holds, which
 * is not revenue. `taxInTotal` is the tax inside the total's own buckets, placed by the model through
 * utils/stayTouristTaxInTotal.js; a stay without it is unchanged.
 */
function withoutTouristTax(s) {
  return round2(Number(s.totalSejour || 0) - Math.max(0, Number(s.taxInTotal || 0)));
}

/**
 * Rule 11 — stays, revenue and average basket of one month's stays (rule 14: tourist tax excluded);
 * average null without a stay.
 */
function basketOf(stays) {
  const total = stays.reduce((n, s) => n + cents(withoutTouristTax(s)), 0);
  return { stays: stays.length, revenue: euros(total), average: stays.length ? round2(total / 100 / stays.length) : null };
}

/** Rule 12 — the change of the average basket; null unless both sides have one. */
function basketDelta(current, previous) {
  if (!current || !previous || current.average == null || previous.average == null) return null;
  const amount = round2(current.average - previous.average);
  let trend = 'stable';
  if (amount > 0) trend = 'up';
  else if (amount < 0) trend = 'down';
  return { amount, change: change(current.average, previous.average), trend };
}

module.exports = {
  foldTail, bucketOf, percentShares, leadDays, profileOf, basketOf, basketDelta, withoutTouristTax,
};
