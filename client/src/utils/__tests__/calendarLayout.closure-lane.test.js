// specs/calendar-property-parity.md rules 9, 10, 18 — a closure of one logement is a lane item of its
// logement's group with a stay's half-day edges; a closure of every logement stays a column hatch; the
// week segments are shared by the name ribbons of the logement calendar.
import { buildMonthLayout, normalizeItems, weekSegments, monthItems, frRange, closedRange } from '../calendarLayout';

const stay = (id, startDate, endDate, extra = {}) => ({
  id, propertyId: 1, propertyName: 'Granja', startDate, endDate, label: `Guest ${id}`, platform: 'Airbnb',
  platformDisplay: 'Airbnb', color: '#C93848', textColor: '#FFFFFF', past: false, ...extra,
});
const closure = (id, startDate, endDate, extra = {}) => ({
  id, propertyId: 1, propertyName: 'Granja', global: false, label: 'Travaux', startDate, endDate, ...extra,
});
const layoutOf = (stays, closures, today = '2026-10-28') => buildMonthLayout(2026, 9, normalizeItems(stays, closures), today);
const barsOf = (layout) => layout.weeks.flatMap((w) => w.bars);

test('rule 9 — a closure shares the lane of a stay ending the day it starts, in the same logement group', () => {
  const layout = layoutOf([stay(1, '2026-10-09', '2026-10-11')], [closure(2, '2026-10-11', '2026-10-13')]);
  const week = layout.weeks.find((w) => w.bars.length === 2);
  const [a, b] = week.bars;
  expect(a.lane).toBe(b.lane);
  expect(week.laneCount).toBe(1);
  expect(a.rightEdge).toBe(b.leftEdge);
});

test('rule 10 — a closure has the half-day edges of a stay: middle of startDate to middle of the reopening day', () => {
  const [bar] = barsOf(layoutOf([], [closure(2, '2026-10-13', '2026-10-15')]));
  expect(bar.item.kind).toBe('closure');
  expect(bar.leftEdge).toBe(bar.startCol + 0.5);
  expect(bar.rightEdge).toBe(bar.endCol + 0.5);
  expect(bar.endCol - bar.startCol).toBe(2);
});

test('rule 10 — a one-night closure is half of startDate plus half of the next day, never invisible', () => {
  const [bar] = barsOf(layoutOf([], [closure(2, '2026-10-14', '2026-10-15')]));
  expect(bar.rightEdge - bar.leftEdge).toBe(1);
});

test('rule 9 — two closures of one logement in a week are packed like two stays', () => {
  const layout = layoutOf([], [closure(2, '2026-10-12', '2026-10-15'), closure(3, '2026-10-13', '2026-10-16')]);
  const week = layout.weeks.find((w) => w.bars.length === 2);
  expect(week.laneCount).toBe(2);
});

test('rule 9 — a closure of every logement is not a lane: it hatches whole day columns and keeps one label', () => {
  const layout = layoutOf([stay(1, '2026-10-12', '2026-10-14')], [closure(5, '2026-10-20', '2026-10-22', { propertyId: null, propertyName: null, global: true })]);
  expect(barsOf(layout).every((b) => b.item.kind === 'reservation')).toBe(true);
  const week = layout.weeks.find((w) => w.globalClosures.length === 1);
  expect(week.days.filter((d) => d.closedAll).map((d) => d.date)).toEqual(['2026-10-20', '2026-10-21']);
  expect(week.globalClosures[0]).toMatchObject({ startCol: 1, endCol: 2 });
});

test('rule 10 — a global closure reopening on a Monday leaves the previous Sunday as its last column', () => {
  const layout = layoutOf([], [closure(5, '2026-10-22', '2026-10-26', { propertyId: null, global: true })]);
  const second = layout.weeks.find((w) => w.globalClosures.length && w.days[0].date === '2026-10-26');
  expect(second).toBeUndefined();
});

test('rule 18 — weekSegments of a month-crossing stay: one segment per week, flush at a split, half at the true ends', () => {
  const items = normalizeItems([stay(1, '2026-10-29', '2026-11-04')], []);
  const first = weekSegments('2026-10-26', items);
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({ roundStart: true, roundEnd: false, leftEdge: 3.5, rightEdge: 7 });
  const second = weekSegments('2026-11-02', items);
  expect(second[0]).toMatchObject({ roundStart: false, roundEnd: true, leftEdge: 0, rightEdge: 2.5 });
});

test('rule 18 — a one-night stay segment is one cell wide', () => {
  const [seg] = weekSegments('2026-10-12', normalizeItems([stay(1, '2026-10-14', '2026-10-15')], []));
  expect(seg.rightEdge - seg.leftEdge).toBe(1);
});

test('stays are grouped by logement: two logements sit in different lanes, sorted by name', () => {
  const layout = layoutOf([
    stay(1, '2026-10-15', '2026-10-17', { propertyName: 'Studio', propertyId: 2 }),
    stay(2, '2026-10-16', '2026-10-18'),
  ], []);
  const week = layout.weeks.find((w) => w.bars.length === 2);
  const lane = (id) => week.bars.find((b) => b.item.reservationId === id).lane;
  expect(lane(2)).toBeLessThan(lane(1));
});

test('monthItems orders by arrival; frRange and closedRange read in French', () => {
  const items = normalizeItems([stay(1, '2026-10-20', '2026-10-22'), stay(2, '2026-10-02', '2026-10-04')], [closure(3, '2026-10-10', '2026-10-12')]);
  expect(monthItems(2026, 9, items).map((i) => i.key)).toEqual(['r2', 'c3', 'r1']);
  expect(frRange('2026-07-05', '2026-07-05')).toBe('5 juillet');
  expect(frRange('2026-06-30', '2026-07-02')).toBe('30 juin → 2 juillet');
  expect(closedRange(items.find((i) => i.key === 'c3'))).toBe('10 octobre → 11 octobre');
});
