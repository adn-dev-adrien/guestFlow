import { describe, it, expect } from 'vitest';
import { buildMonthLayout } from '../CumulativeMonthCalendar';

// specs/cumulative-month-calendar.md §3 — spanning bars split per week, lane-packed.
const RES = [
  { id: 1, startDate: '2026-07-15', endDate: '2026-07-15', platform: 'direct', propertyName: 'Gîte', firstName: 'A', lastName: 'A' },
  { id: 2, startDate: '2026-07-15', endDate: '2026-07-16', platform: 'airbnb', propertyName: 'Studio', firstName: 'B', lastName: 'B' },
  { id: 3, startDate: '2026-07-04', endDate: '2026-07-12', platform: 'booking', propertyName: 'Loft', firstName: 'C', lastName: 'C' }, // spans 2+ week rows
];

function allBars(layout) {
  return layout.weeks.flatMap((w) => w.bars);
}

describe('buildMonthLayout', () => {
  const layout = buildMonthLayout(2026, 6, RES, '2026-07-15'); // July 2026 (month index 6)

  it('a single-day stay yields exactly one rounded segment', () => {
    const bars = allBars(layout).filter((b) => b.res.id === 1);
    expect(bars).toHaveLength(1);
    expect(bars[0].roundStart && bars[0].roundEnd).toBe(true);
    expect(bars[0].startCol).toBe(bars[0].endCol);
  });

  it('a stay crossing a week boundary is split into multiple segments', () => {
    const bars = allBars(layout).filter((b) => b.res.id === 3);
    expect(bars.length).toBeGreaterThanOrEqual(2);
    // first segment rounds on the true start, last on the true end; the split edges are square.
    expect(bars[0].roundStart).toBe(true);
    expect(bars[bars.length - 1].roundEnd).toBe(true);
    expect(bars[0].roundEnd).toBe(false);
  });

  it('two overlapping stays in the same week get distinct lanes', () => {
    const week = layout.weeks.find((w) => w.bars.some((b) => b.res.id === 1) && w.bars.some((b) => b.res.id === 2));
    expect(week).toBeTruthy();
    const laneA = week.bars.find((b) => b.res.id === 1).lane;
    const laneB = week.bars.find((b) => b.res.id === 2).lane;
    expect(laneA).not.toBe(laneB);
    expect(week.laneCount).toBeGreaterThanOrEqual(2);
  });

  it('covers the whole month (5 or 6 week rows, 7 days each)', () => {
    expect(layout.weeks.length).toBeGreaterThanOrEqual(5);
    layout.weeks.forEach((w) => expect(w.days).toHaveLength(7));
  });
});
