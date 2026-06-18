import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { buildMonthLayout, monthReservations, frRange } from '../CumulativeMonthCalendar';

vi.mock('../../api', () => ({ default: { getReservations: vi.fn().mockResolvedValue([]) } }));
import api from '../../api';
import CumulativeMonthCalendar from '../CumulativeMonthCalendar';

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

describe('CumulativeMonthCalendar (infinite scroll)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function todayIso() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }

  it('stacks multiple months and renders reservation bars from the loaded data', async () => {
    const d = todayIso();
    api.getReservations.mockResolvedValue([
      { id: 1, startDate: d, endDate: d, platform: 'airbnb', propertyName: 'Gîte', firstName: 'Jean', lastName: 'Dupont' },
    ]);
    const { container } = render(<CumulativeMonthCalendar onReservationClick={() => {}} onCreateReservation={() => {}} />);

    // The infinite-scroll hook seeds several stacked months (prev / current / next …).
    await waitFor(() => expect(container.querySelectorAll('[data-month-anchor]').length).toBeGreaterThanOrEqual(3));
    // The reservation surfaces as a bar (logement · client).
    await waitFor(() => expect(container.textContent).toMatch(/Jean Dupont/));
    expect(api.getReservations).toHaveBeenCalled();
  });

  it('shows the « Aujourd\'hui » control and the scroll hint (no month buttons)', async () => {
    api.getReservations.mockResolvedValue([]);
    render(<CumulativeMonthCalendar onReservationClick={() => {}} />);
    expect(await screen.findByRole('button', { name: /Aujourd'hui/ })).toBeInTheDocument();
    expect(screen.getByText(/Faites défiler pour changer de mois/)).toBeInTheDocument();
  });
});

describe('monthReservations (mobile agenda data)', () => {
  const RES_M = [
    { id: 1, startDate: '2026-07-20', endDate: '2026-07-22', propertyName: 'Studio' },
    { id: 2, startDate: '2026-06-30', endDate: '2026-07-02', propertyName: 'Gîte' }, // overlaps July
    { id: 3, startDate: '2026-08-01', endDate: '2026-08-03', propertyName: 'Loft' }, // not in July
    { id: 4, startDate: '2026-07-05', endDate: '2026-07-06', propertyName: 'Cabane' },
  ];
  it('keeps only stays overlapping the month, sorted by start date', () => {
    const ids = monthReservations(2026, 6, RES_M).map((r) => r.id); // July
    expect(ids).toEqual([2, 4, 1]); // 06-30, 07-05, 07-20 — id 3 (August) excluded
  });
});

describe('frRange', () => {
  it('formats a single day and a range', () => {
    expect(frRange('2026-07-05', '2026-07-05')).toBe('5 juillet');
    expect(frRange('2026-06-30', '2026-07-02')).toBe('30 juin → 2 juillet');
  });
});
