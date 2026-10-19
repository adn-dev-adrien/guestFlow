// specs/ui-review-2026-10-19-operations.md rules 13-15 — the all-logements calendar: a closure is a
// texture and never a lane, a stay bar is a tint + stripe + ink, the legend is folded with real names.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import { buildMonthLayout, normalizeItems, closureLabel, barTint } from '../CumulativeMonthCalendar';

vi.mock('../../api', () => ({ default: {
  getReservations: vi.fn().mockResolvedValue([]),
  getEstablishmentClosures: vi.fn().mockResolvedValue([]),
} }));
import api from '../../api';
import CumulativeMonthCalendar from '../CumulativeMonthCalendar';

const RES = [
  { id: 1, startDate: '2026-07-15', endDate: '2026-07-17', platform: 'Lodgify', propertyName: 'Gite', firstName: 'Jean', lastName: 'Dupont' },
];
const CLOSURES = [
  { id: 10, propertyId: 2, propertyName: 'Aventura lodge', label: 'Fermeture hivernale', startDate: '2026-07-13', endDate: '2026-08-31' },
  { id: 11, propertyId: null, propertyName: null, label: 'Congés', startDate: '2026-07-25', endDate: '2026-07-27' },
];

describe('rule 13 — a closure is a texture, never a lane', () => {
  const layout = buildMonthLayout(2026, 6, normalizeItems(RES, CLOSURES), '2026-07-16');

  it('no closure among the bars; the stay alone takes a lane', () => {
    const bars = layout.weeks.flatMap((w) => w.bars);
    expect(bars.every((b) => b.item.kind === 'reservation')).toBe(true);
    const week = layout.weeks.find((w) => w.bars.length > 0);
    expect(week.laneCount).toBe(1);
  });

  it('a logement\'s closure gets a band per week; a global one hatches its days', () => {
    const week = layout.weeks.find((w) => w.days.some((d) => d.date === '2026-07-25'));
    const band = week.closures.find((c) => c.item.key === 'c10');
    expect(band.band).toBe(0);
    expect(week.bandCount).toBe(1);
    const global = week.closures.find((c) => c.item.key === 'c11');
    expect(global.band).toBeNull();
    expect(week.days.filter((d) => d.closedAll).map((d) => d.date)).toEqual(['2026-07-25', '2026-07-26']);
  });

  it('one label per week: « Aventura lodge fermé », « Tout fermé »', () => {
    const items = normalizeItems([], CLOSURES);
    expect(closureLabel(items.find((i) => i.key === 'c10'))).toBe('Aventura lodge fermé');
    expect(closureLabel(items.find((i) => i.key === 'c11'))).toBe('Tout fermé');
  });
});

describe('rendered calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-16T12:00:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  const renderCal = () => render(<ThemeProvider theme={theme}><CumulativeMonthCalendar onReservationClick={() => {}} /></ThemeProvider>);

  it('rule 13 — the closure label shows once per week row, and no « Fermé — » bar remains', async () => {
    api.getReservations.mockResolvedValue(RES);
    api.getEstablishmentClosures.mockResolvedValue([CLOSURES[0]]);
    const { container } = renderCal();
    await waitFor(() => expect(screen.getAllByText('Aventura lodge fermé').length).toBeGreaterThan(0));
    expect(screen.queryByText(/Fermé —/)).toBeNull();
    expect(container.querySelectorAll('[data-closure-band="c10"]').length).toBeGreaterThan(0);
    // Reachable from the keyboard, the dates in its name.
    const label = screen.getAllByLabelText(/Aventura lodge fermé — Fermeture hivernale, 13 juillet → 30 août/)[0];
    expect(label).toHaveAttribute('tabindex', '0');
  });

  it('rule 14 — a stay bar is a 14 % tint with a stripe of its colour and ink text', async () => {
    api.getReservations.mockResolvedValue(RES);
    api.getEstablishmentClosures.mockResolvedValue([]);
    const { container } = renderCal();
    await waitFor(() => expect(container.querySelector('[data-bar="r1"]')).not.toBeNull());
    const bar = container.querySelector('[data-bar="r1"]');
    const style = getComputedStyle(bar);
    expect(style.color).toBe('rgb(39, 37, 31)');
    expect(style.boxShadow).toMatch(/inset 3px 0 0/);
    expect(barTint('#F4C430')).toBe('rgba(244, 196, 48, 0.14)');
  });

  it('rule 15 — the legend is folded, then lists the server\'s « Gîtes de France », never the raw key', async () => {
    api.getReservations.mockResolvedValue([{ ...RES[0], platform: 'GitesDeFrance', platformDisplay: 'Gîtes de France' }]);
    api.getEstablishmentClosures.mockResolvedValue([]);
    renderCal();
    const toggle = await screen.findByRole('button', { name: 'Légende' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText('Gîtes de France')).toBeInTheDocument());
    expect(screen.queryByText('GitesDeFrance')).toBeNull();
  });
});
