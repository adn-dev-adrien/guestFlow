const test = require('node:test');
const assert = require('node:assert/strict');

const { buildYearPlan, buildHorizonPlan, materializeClosures } = require('../utils/seasonPlan');
const { validateRecipe } = require('../utils/tariffRecipe');

// specs/tariff-recipes/spec.md §3.7 rules 41-44 — the Aventura calendar derived to the day, plus the
// generic invariants of §3.3: shoulders on the anchor weekday, no overlap, full coverage, closure
// skip, merged adjacent holiday blocks.

const AVENTURA = validateRecipe({
  id: 'aventura-test', version: '1.0.0', label: 'Aventura', horizonYears: 2,
  seasons: [
    { key: 'low', label: 'Basse saison', rank: 1, color: '#5B8C6E', pricePerNight: 179, pricingMode: 'progressive', extraNightRatio: 0.70 },
    { key: 'mid', label: 'Moyenne saison', rank: 2, color: '#D9A441', pricePerNight: 216, pricingMode: 'progressive', extraNightRatio: 0.70 },
    { key: 'high', label: 'Haute saison', rank: 3, color: '#C25B4E', pricePerNight: 247, pricingMode: 'progressive', extraNightRatio: 0.70 },
  ],
  calendar: {
    baseSeason: 'low',
    periods: [
      { id: 'july-shoulder', season: 'mid', anchor: { type: 'nth_weekday_of_month', month: 7, weekday: 6, occurrence: 1 }, nights: 7 },
      { id: 'august-shoulder', season: 'mid', anchor: { type: 'last_full_week_of_month', month: 8, weekday: 6 }, nights: 7 },
      { id: 'summer-core', season: 'high', anchor: { type: 'between', after: 'july-shoulder', before: 'august-shoulder' } },
    ],
    modifiers: [
      { type: 'public_holiday_bridge', effect: 'raise_rank', amount: 1, skipClosedDays: true, minNights: 'block' },
    ],
  },
  closures: [{ label: 'Fermeture hivernale', from: '10-15', to: '03-31' }],
}).recipe;

// The previous winter's tail matters for January-March holidays → materialize from year − 1.
const closuresFor = (year) => materializeClosures(AVENTURA, year - 1, year);

const r = (startDate, endDate, minNights) => (
  minNights ? { startDate, endDate, minNights } : { startDate, endDate }
);

test('2026 produces exactly the spec rule 44 table, holiday minimums included', () => {
  const plan = buildYearPlan(AVENTURA, 2026, closuresFor(2026));
  assert.deepEqual(plan.low, [
    r('2026-01-01', '2026-04-03'), r('2026-04-06', '2026-04-30'), r('2026-05-03', '2026-05-07'),
    r('2026-05-10', '2026-05-13'), r('2026-05-17', '2026-05-22'), r('2026-05-25', '2026-07-03'),
    r('2026-08-29', '2026-12-31'),
  ]);
  assert.deepEqual(plan.mid, [
    r('2026-04-04', '2026-04-05', 2), // Pâques (lun 6) — 2-night block
    r('2026-05-01', '2026-05-02', 2), // Fête du Travail (ven 1)
    r('2026-05-08', '2026-05-09', 2), // Victoire (ven 8)
    r('2026-05-14', '2026-05-16', 3), // Ascension (jeu 14) + pont — 3-night block
    r('2026-05-23', '2026-05-24', 2), // Pentecôte (lun 25)
    r('2026-07-04', '2026-07-10'),    // July shoulder — no holiday, no minimum
    r('2026-08-22', '2026-08-28'),    // August shoulder
  ]);
  // 14 juillet (mardi) is ALREADY high season: no rank change, but its 3-night block still splits
  // the high range and carries the minimum (spec rule 16bis).
  assert.deepEqual(plan.high, [
    r('2026-07-11', '2026-07-13', 3),
    r('2026-07-14', '2026-08-21'),
  ]);
});

test('2027: 1 May stands alone, Ascension absorbs Victoire (6-8 May), Pentecôte 15-16 May, Easter Monday skipped (closed)', () => {
  const plan = buildYearPlan(AVENTURA, 2027, closuresFor(2027));
  assert.deepEqual(plan.mid, [
    r('2027-05-01', '2027-05-01'),    // Fête du Travail on a SATURDAY: its own night, no minimum
    r('2027-05-06', '2027-05-08', 3), // Ascension (jeu 6) + Victoire (sam 8) merged into ONE range
    r('2027-05-15', '2027-05-16', 2), // Pentecôte (lun 17)
    r('2027-07-03', '2027-07-09'),    // July shoulder
    r('2027-08-21', '2027-08-27'),    // August shoulder
  ]);
  assert.deepEqual(plan.high, [r('2027-07-10', '2027-08-20')]);
  // Easter Monday 2027 = 29 March → nights 27-28 March are inside the closure → NOT raised.
  assert.ok(!plan.mid.some((range) => range.startDate.startsWith('2027-03')));
});

test('the holiday minimum is the block length, and no minimum without the setting (rule 16bis)', () => {
  // Every raised 2026 block carries its own length as a minimum.
  const withMin = buildYearPlan(AVENTURA, 2026, closuresFor(2026));
  const holidayRanges = withMin.mid.filter((range) => range.minNights);
  assert.deepEqual(holidayRanges.map((range) => range.minNights), [2, 2, 2, 3, 2]);

  // Drop `minNights` from the modifier → the ranges are identical but carry no minimum, which is
  // the pre-existing behaviour a recipe without the setting keeps.
  const withoutMin = buildYearPlan(
    { ...AVENTURA, calendar: { ...AVENTURA.calendar, modifiers: [{ type: 'public_holiday_bridge', effect: 'raise_rank', amount: 1, skipClosedDays: true }] } },
    2026,
    closuresFor(2026),
  );
  assert.ok(withoutMin.mid.every((range) => range.minNights === undefined));
  assert.deepEqual(
    withoutMin.mid.map((range) => [range.startDate, range.endDate]),
    withMin.mid.map((range) => [range.startDate, range.endDate]),
  );
  // Without the minimum, nothing splits the high season around 14 juillet.
  assert.deepEqual(withoutMin.high, [{ startDate: '2026-07-11', endDate: '2026-08-21' }]);
});

test('shoulders land on the anchor weekday (Saturday) for ten consecutive years', () => {
  for (let year = 2026; year < 2036; year += 1) {
    const plan = buildYearPlan(AVENTURA, year, closuresFor(year));
    const shoulders = plan.mid.filter((range) => range.startDate.slice(5, 7) === '07' || range.startDate.slice(5, 7) === '08');
    assert.equal(shoulders.length, 2, `${year}: two summer shoulders`);
    for (const s of shoulders) {
      const d = new Date(`${s.startDate}T00:00:00Z`);
      assert.equal(d.getUTCDay(), 6, `${year}: shoulder ${s.startDate} starts on Saturday`);
      const nights = (new Date(`${s.endDate}T00:00:00Z`) - d) / 86400000 + 1;
      assert.equal(nights, 7, `${year}: shoulder ${s.startDate} is 7 nights`);
    }
  }
});

test('seasons never overlap and together cover every day of every generated year', () => {
  for (let year = 2026; year < 2031; year += 1) {
    const plan = buildYearPlan(AVENTURA, year, closuresFor(year));
    const all = [...plan.low, ...plan.mid, ...plan.high]
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    assert.equal(all[0].startDate, `${year}-01-01`);
    assert.equal(all[all.length - 1].endDate, `${year}-12-31`);
    for (let i = 1; i < all.length; i += 1) {
      const prevEnd = new Date(`${all[i - 1].endDate}T00:00:00Z`);
      const nextStart = new Date(`${all[i].startDate}T00:00:00Z`);
      assert.equal(nextStart - prevEnd, 86400000, `${year}: gap/overlap between ${all[i - 1].endDate} and ${all[i].startDate}`);
    }
  }
});

test('horizon plan spans exactly horizonYears, ranges within their own year', () => {
  // Closures for a horizon must include the PREVIOUS winter's tail (Jan-Mar of the first year).
  const plan = buildHorizonPlan(AVENTURA, 2026, materializeClosures(AVENTURA, 2025, 2027));
  assert.ok(plan.low.some((range) => range.startDate === '2026-01-01'));
  assert.ok(plan.low.some((range) => range.startDate === '2027-01-01'));
  assert.ok(!plan.low.some((range) => range.startDate.startsWith('2028')));
  for (const key of Object.keys(plan)) {
    for (const range of plan[key]) {
      assert.equal(range.startDate.slice(0, 4), range.endDate.slice(0, 4), 'range crosses a year boundary');
    }
  }
});

test('materializeClosures: a wrapping window ends in the next year', () => {
  const rows = materializeClosures(AVENTURA, 2026, 2027);
  assert.deepEqual(rows, [
    { label: 'Fermeture hivernale', startDate: '2026-10-15', endDate: '2027-03-31' },
    { label: 'Fermeture hivernale', startDate: '2027-10-15', endDate: '2028-03-31' },
  ]);
});

test('period overrides (minNights, changeover) ride on the produced ranges', () => {
  const recipe = validateRecipe({
    id: 'override-test', version: '1.0.0', label: 'x', horizonYears: 1,
    seasons: [
      { key: 'low', label: 'Basse', rank: 1, color: '#111', pricePerNight: 100 },
      { key: 'high', label: 'Haute', rank: 2, color: '#222', pricePerNight: 200, minNights: 7, changeover: { arrival: 6, departure: 6 } },
    ],
    calendar: {
      baseSeason: 'low',
      periods: [
        { id: 'core', season: 'high', anchor: { type: 'fixed_dates', from: '07-01', to: '08-31' }, minNights: 3, changeover: { arrival: 6, departure: null } },
      ],
      modifiers: [],
    },
    closures: [],
  }).recipe;
  const plan = buildYearPlan(recipe, 2026, []);
  assert.equal(plan.high.length, 1);
  assert.equal(plan.high[0].minNights, 3);
  assert.equal(plan.high[0].changeoverArrival, 6);
  assert.equal(plan.high[0].changeoverDeparture, undefined);
});

test('a between anchor with an empty span produces no range; the base season keeps those days', () => {
  const recipe = validateRecipe({
    id: 'empty-between', version: '1.0.0', label: 'x', horizonYears: 1,
    seasons: [
      { key: 'low', label: 'Basse', rank: 1, color: '#111', pricePerNight: 100 },
      { key: 'high', label: 'Haute', rank: 2, color: '#222', pricePerNight: 200 },
    ],
    calendar: {
      baseSeason: 'low',
      periods: [
        { id: 'a', season: 'high', anchor: { type: 'fixed_dates', from: '07-01', to: '07-15' } },
        { id: 'b', season: 'high', anchor: { type: 'fixed_dates', from: '07-16', to: '07-31' } },
        { id: 'between-them', season: 'high', anchor: { type: 'between', after: 'a', before: 'b' } },
      ],
      modifiers: [],
    },
    closures: [],
  }).recipe;
  const plan = buildYearPlan(recipe, 2026, []);
  // a and b are adjacent → the between span is empty → one merged high run, base low elsewhere.
  assert.deepEqual(plan.high, [r('2026-07-01', '2026-07-31')]);
});

// specs/tariff-recipes/spec.md §3.3 rule 16ter — a holiday landing on a SATURDAY.
test('a Saturday holiday raises its own night, alone and with no minimum-stay constraint', () => {
  // It forms no bridge — Saturday is already a non-working day — which is why it was originally
  // skipped. But « le 1er mai » still fills the area whatever weekday it lands on: 1 AND 8 May 2027
  // are Saturdays, and both were priced as ordinary nights.
  const plan = buildYearPlan(AVENTURA, 2027, closuresFor(2027));
  const covering = (date) => Object.entries(plan)
    .find(([, ranges]) => ranges.some((r) => date >= r.startDate && date <= r.endDate));

  const [seasonKey, ranges] = covering('2027-05-01');
  assert.equal(seasonKey, 'mid', '1 May 2027 (Saturday) goes up one rank');
  const range = ranges.find((r) => '2027-05-01' >= r.startDate && '2027-05-01' <= r.endDate);
  assert.equal(range.startDate, '2027-05-01');
  assert.equal(range.endDate, '2027-05-01', 'one night — the Saturday night, nothing around it');
  assert.equal(range.minNights, undefined, 'a single raised night imposes NO minimum: a minimum of 1 is not a constraint');

  // The neighbours are untouched.
  assert.equal(covering('2027-04-30')[0], 'low');
  assert.equal(covering('2027-05-02')[0], 'low');
});

test('a Sunday holiday changes nothing — it adds no day off', () => {
  // Owner's call, 2026-08-12. Assomption 2027 falls on a Sunday: the Sunday night runs into a
  // working Monday, so nobody stays for it, and the Saturday before is an ordinary weekend night.
  const recipe = JSON.parse(JSON.stringify(AVENTURA));
  recipe.calendar.periods = [];                       // strip the summer periods so only the holiday could raise
  const plan = buildYearPlan(recipe, 2027, []);
  const covering = (date) => Object.entries(plan)
    .find(([, ranges]) => ranges.some((r) => date >= r.startDate && date <= r.endDate))[0];
  assert.equal(covering('2027-08-15'), recipe.calendar.baseSeason, 'the holiday itself');
  assert.equal(covering('2027-08-14'), recipe.calendar.baseSeason, 'and the Saturday before it');
});

// ── capSeason (spec §3.3 rule 15bis) ─────────────────────────────────────────
// A grid whose top rank is a peak-summer price cannot let a holiday raise reach it: 25 December
// would be sold at the August rate. The cap stops the raise — and, just as important, never moves a
// night that already sits above it back DOWN.

const FIVE_RANKS = validateRecipe({
  id: 'cap-test', version: '1.0.0', label: 'Cinq rangs', horizonYears: 1,
  seasons: [
    { key: 'r1', label: 'R1', rank: 1, color: '#111', pricePerNight: 100 },
    { key: 'r2', label: 'R2', rank: 2, color: '#222', pricePerNight: 200 },
    { key: 'r3', label: 'R3', rank: 3, color: '#333', pricePerNight: 300 },
    { key: 'r4', label: 'R4', rank: 4, color: '#444', pricePerNight: 400 },
    { key: 'r5', label: 'R5', rank: 5, color: '#555', pricePerNight: 500 },
  ],
  calendar: {
    baseSeason: 'r1',
    // 14 juillet 2026 is a Tuesday: its block is 11-13 July, and it sits in the TOP rank here.
    periods: [
      { id: 'summer', season: 'r5', anchor: { type: 'fixed_dates', from: '07-01', to: '08-31' } },
      { id: 'christmas', season: 'r3', anchor: { type: 'fixed_dates', from: '12-19', to: '12-31' } },
    ],
    modifiers: [{ type: 'public_holiday_bridge', effect: 'raise_rank', amount: 1, capSeason: 'r4', minNights: 'block' }],
  },
}).recipe;

test('capSeason stops the raise at its rank instead of the highest one', () => {
  const plan = buildYearPlan(FIVE_RANKS, 2026, []);
  // 25 décembre 2026 is a Friday → the block is 25-26 December, painted r3, raised one rank to r4.
  assert.ok(plan.r4.some((x) => x.startDate === '2026-12-25' && x.endDate === '2026-12-26' && x.minNights === 2));
  // And it stops there: nothing reached r5 outside the summer period it was painted with.
  assert.deepEqual(plan.r5.map((x) => x.startDate).filter((d) => !d.startsWith('2026-07') && !d.startsWith('2026-08')), []);
});

test('a night already above the cap is never demoted, but still carries the block minimum', () => {
  const plan = buildYearPlan(FIVE_RANKS, 2026, []);
  // 14 juillet: the 3-night block splits the r5 range and keeps its price — a naive
  // Math.min(cap, rank + 1) would silently move these nights down to r4.
  assert.ok(plan.r5.some((x) => x.startDate === '2026-07-11' && x.endDate === '2026-07-13' && x.minNights === 3));
  assert.ok(plan.r5.some((x) => x.startDate === '2026-07-14'));
  assert.equal(plan.r4.some((x) => x.startDate.startsWith('2026-07')), false, 'no July night was demoted to r4');
});

test('an unknown capSeason is refused rather than silently ignored', () => {
  const out = validateRecipe({
    ...JSON.parse(JSON.stringify(FIVE_RANKS)),
    calendar: { ...FIVE_RANKS.calendar, modifiers: [{ type: 'public_holiday_bridge', effect: 'raise_rank', capSeason: 'nope' }] },
  });
  assert.equal(out.valid, false);
  assert.match(out.error, /capSeason/);
});

test('without capSeason the ceiling is still the highest rank — recipes written before it are untouched', () => {
  const noCap = validateRecipe({
    ...JSON.parse(JSON.stringify(FIVE_RANKS)), id: 'no-cap',
    calendar: { ...FIVE_RANKS.calendar, modifiers: [{ type: 'public_holiday_bridge', effect: 'raise_rank', amount: 1, minNights: 'block' }] },
  }).recipe;
  const plan = buildYearPlan(noCap, 2026, []);
  assert.ok(plan.r4.some((x) => x.startDate === '2026-12-25'), '25 December still rises one rank');
  assert.equal(plan.r5.some((x) => x.startDate.startsWith('2026-12')), false, 'and one rank only, from r3');
});
