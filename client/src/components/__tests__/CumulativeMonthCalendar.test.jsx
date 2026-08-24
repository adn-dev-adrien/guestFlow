import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { buildMonthLayout, normalizeItems, monthItems, frRange } from '../CumulativeMonthCalendar';

vi.mock('../../api', () => ({ default: {
  getReservations: vi.fn().mockResolvedValue([]),
  getEstablishmentClosures: vi.fn().mockResolvedValue([]),
} }));
import api from '../../api';
import CumulativeMonthCalendar from '../CumulativeMonthCalendar';

// specs/cumulative-month-calendar.md §3 — spanning bars split per week, lane-packed, GROUPED BY logement,
// reservations half-day at arrival/departure, closures full-day.
const RES = [
  { id: 1, startDate: '2026-07-15', endDate: '2026-07-17', platform: 'airbnb', propertyName: 'Gîte', firstName: 'Jean', lastName: 'Dupont' },
  { id: 2, startDate: '2026-07-16', endDate: '2026-07-18', platform: 'booking', propertyName: 'Studio', firstName: 'Anne', lastName: 'Bernard' }, // overlaps id1, other property
  { id: 3, startDate: '2026-07-04', endDate: '2026-07-12', platform: 'direct', propertyName: 'Loft', firstName: 'C', lastName: 'C' }, // spans 2 week rows
];
const CLOSURES = [
  { id: 10, propertyId: 1, propertyName: 'Gîte', label: 'Travaux', startDate: '2026-07-20', endDate: '2026-07-22' }, // closed 20–21 (half-open)
  { id: 11, propertyId: null, propertyName: null, label: 'Congés', startDate: '2026-07-25', endDate: '2026-07-27' }, // global
];
const ITEMS = normalizeItems(RES, CLOSURES);

function allBars(layout) { return layout.weeks.flatMap((w) => w.bars); }

describe('normalizeItems', () => {
  it('maps reservations + closures, with closures using the last OCCUPIED day (endDate − 1)', () => {
    const r = ITEMS.find((i) => i.key === 'r1');
    expect(r.kind).toBe('reservation');
    expect(r.lastDay).toBe('2026-07-17');
    const c = ITEMS.find((i) => i.key === 'c10');
    expect(c.kind).toBe('closure');
    expect(c.lastDay).toBe('2026-07-21'); // endDate 22 → last occupied 21
    const g = ITEMS.find((i) => i.key === 'c11');
    expect(g.groupKey).toBe(''); // global closure → top band
  });
});

describe('buildMonthLayout', () => {
  const layout = buildMonthLayout(2026, 6, ITEMS, '2026-07-16'); // July 2026

  it('a reservation is half-day at arrival + departure (leftEdge/rightEdge offset by 0.5)', () => {
    const bars = allBars(layout).filter((b) => b.item.reservationId === 1);
    expect(bars).toHaveLength(1);
    const b = bars[0];
    expect(b.roundStart && b.roundEnd).toBe(true);
    expect(b.leftEdge).toBe(b.startCol + 0.5);
    expect(b.rightEdge).toBe(b.endCol + 0.5);
  });

  it('a closure is half-day at its start/end too (consistent with reservations)', () => {
    const bars = allBars(layout).filter((b) => b.item.key === 'c10');
    expect(bars.length).toBeGreaterThanOrEqual(1);
    const b = bars[0];
    expect(b.roundStart && b.roundEnd).toBe(true);
    expect(b.leftEdge).toBe(b.startCol + 0.5);
    expect(b.rightEdge).toBe(b.endCol + 0.5);
  });

  it('a stay crossing a week boundary splits; only the true edges are half-day', () => {
    const bars = allBars(layout).filter((b) => b.item.reservationId === 3);
    expect(bars.length).toBeGreaterThanOrEqual(2);
    expect(bars[0].roundStart).toBe(true);
    expect(bars[0].leftEdge).toBe(bars[0].startCol + 0.5);   // arrival half-day
    expect(bars[0].roundEnd).toBe(false);
    expect(bars[0].rightEdge).toBe(bars[0].endCol + 1);       // week-split edge = full
    expect(bars[bars.length - 1].roundEnd).toBe(true);
  });

  it('groups by logement: Gîte and Studio overlap but sit in different lanes, Gîte above Studio', () => {
    const week = layout.weeks.find((w) => w.bars.some((b) => b.item.reservationId === 1) && w.bars.some((b) => b.item.reservationId === 2));
    expect(week).toBeTruthy();
    const laneG = week.bars.find((b) => b.item.reservationId === 1).lane;
    const laneS = week.bars.find((b) => b.item.reservationId === 2).lane;
    expect(laneG).not.toBe(laneS);
    expect(laneG).toBeLessThan(laneS); // « Gîte » sorts before « Studio »
  });

  it('a global closure sits in the top lane band (lane 0)', () => {
    const bars = allBars(layout).filter((b) => b.item.key === 'c11');
    expect(bars.length).toBeGreaterThanOrEqual(1);
    expect(bars[0].lane).toBe(0);
  });

  it('flags exactly the today cell as isToday', () => {
    const todays = layout.weeks.flatMap((w) => w.days).filter((d) => d.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0].date).toBe('2026-07-16');
  });
});

describe('monthItems (mobile agenda, ordered by arrival date)', () => {
  it('orders strictly by arrival (startDate), logement only breaking same-day ties', () => {
    const keys = monthItems(2026, 6, ITEMS).map((i) => i.key);
    // r3 04/07 → r1 15/07 → r2 16/07 → c10 20/07 → c11 25/07.
    expect(keys).toEqual(['r3', 'r1', 'r2', 'c10', 'c11']);
  });
});

describe('frRange', () => {
  it('formats a single day and a range', () => {
    expect(frRange('2026-07-05', '2026-07-05')).toBe('5 juillet');
    expect(frRange('2026-06-30', '2026-07-02')).toBe('30 juin → 2 juillet');
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
    const end = `${d.slice(0, 8)}${String(Number(d.slice(8, 10)) + 1).padStart(2, '0')}`;
    api.getReservations.mockResolvedValue([
      { id: 1, startDate: d, endDate: end, platform: 'airbnb', propertyName: 'Gîte', firstName: 'Jean', lastName: 'Dupont' },
    ]);
    api.getEstablishmentClosures.mockResolvedValue([]);
    const { container } = render(<CumulativeMonthCalendar onReservationClick={() => {}} onCreateReservation={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll('[data-month-anchor]').length).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(container.textContent).toMatch(/Jean Dupont/));
  });

  // Reported 2026-08-24: « Abracadaroom » and « abracadaroom » sat side by side in the legend.
  // Case is not identity — one platform, one entry, one leading capital.
  it('lists a platform once in the legend whatever the stored casing', async () => {
    const d = todayIso();
    const end = `${d.slice(0, 8)}${String(Number(d.slice(8, 10)) + 1).padStart(2, '0')}`;
    api.getReservations.mockResolvedValue([
      { id: 1, startDate: d, endDate: end, platform: 'Abracadaroom', propertyName: 'Gîte', firstName: 'Jean', lastName: 'Dupont' },
      { id: 2, startDate: d, endDate: end, platform: 'abracadaroom', propertyName: 'Lodge', firstName: 'Marie', lastName: 'Martin' },
    ]);
    api.getEstablishmentClosures.mockResolvedValue([]);
    render(<CumulativeMonthCalendar onReservationClick={() => {}} />);
    await waitFor(() => expect(screen.getAllByText('Abracadaroom').length).toBeGreaterThan(0));
    // One legend swatch + one chip per reservation bar — never two differently-cased legend entries.
    expect(screen.queryByText('abracadaroom')).not.toBeInTheDocument();
  });

  it('shows the « Aujourd\'hui » control and the scroll hint (no month buttons)', async () => {
    api.getReservations.mockResolvedValue([]);
    api.getEstablishmentClosures.mockResolvedValue([]);
    render(<CumulativeMonthCalendar onReservationClick={() => {}} />);
    expect(await screen.findByRole('button', { name: /Aujourd'hui/ })).toBeInTheDocument();
    expect(screen.getByText(/Faites défiler pour changer de mois/)).toBeInTheDocument();
  });
});
