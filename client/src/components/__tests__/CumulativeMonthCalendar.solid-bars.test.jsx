// specs/calendar-property-parity.md rules 4, 8, 9-11, 13-14 — the all-logements calendar: a current stay is a
// solid bar in the colour the server chose, a past one a soft tint, a closure a hatched bar on its logement's
// lane that never opens a fiche, and « Aujourd'hui » is the only navigation.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

vi.mock('../../api', () => ({ default: { getCalendar: vi.fn() } }));
vi.mock('../../hooks/useServerToday', () => ({ default: () => '2026-07-16' }));
import api from '../../api';
import CumulativeMonthCalendar from '../CumulativeMonthCalendar';

const stay = (id, startDate, endDate, extra = {}) => ({
  id, propertyId: 1, propertyName: 'Gite', startDate, endDate, label: 'Jean Dupont', firstName: 'Jean', lastName: 'Dupont',
  platform: 'Airbnb', platformDisplay: 'Airbnb', color: '#C93848', textColor: '#FFFFFF', past: false, ...extra,
});
const payload = (stays = [], closures = []) => ({ from: '2026-06-01', to: '2026-08-31', today: '2026-07-16', stays, closures });

describe('CumulativeMonthCalendar — solid bars and closures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-16T12:00:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  const renderCal = (props = {}) => render(
    <ThemeProvider theme={theme}><CumulativeMonthCalendar onReservationClick={() => {}} {...props} /></ThemeProvider>,
  );

  it('rule 4 — a future stay is filled with its colour, its text in the server\'s text colour', async () => {
    api.getCalendar.mockResolvedValue(payload([stay(1, '2026-07-20', '2026-07-22')]));
    const { container } = renderCal();
    await waitFor(() => expect(container.querySelector('[data-bar="r1"]')).not.toBeNull());
    const style = getComputedStyle(container.querySelector('[data-bar="r1"]'));
    expect(style.backgroundColor).toBe('rgb(201, 56, 72)');
    expect(style.color).toBe('rgb(255, 255, 255)');
  });

  it('rule 8 — a past stay is a 14 % tint with a stripe of its colour, ink text, no opacity', async () => {
    api.getCalendar.mockResolvedValue(payload([stay(1, '2026-07-02', '2026-07-04', { past: true })]));
    const { container } = renderCal();
    await waitFor(() => expect(container.querySelector('[data-bar="r1"]')).not.toBeNull());
    const style = getComputedStyle(container.querySelector('[data-bar="r1"]'));
    expect(style.backgroundColor).toBe('rgba(201, 56, 72, 0.14)');
    expect(style.color).toBe('rgb(39, 37, 31)');
    expect(style.boxShadow).toMatch(/inset 3px 0 0/);
    expect(style.opacity).not.toBe('0.65');
  });

  it('rule 11 — a closure bar reads « Fermé · label », is focusable, named in full, and opens nothing', async () => {
    const onReservationClick = vi.fn();
    api.getCalendar.mockResolvedValue(payload([], [{ id: 4, propertyId: 1, propertyName: 'Gite', global: false, label: 'Travaux', startDate: '2026-07-20', endDate: '2026-07-22' }]));
    const { container } = renderCal({ onReservationClick });
    await waitFor(() => expect(container.querySelector('[data-closure-bar="c4"]')).not.toBeNull());
    const bar = container.querySelector('[data-closure-bar="c4"]');
    expect(bar).toHaveTextContent('Fermé · Travaux');
    expect(bar).toHaveAttribute('tabindex', '0');
    expect(bar).toHaveAttribute('aria-label', 'Gite fermé — Travaux, 20 juillet → 21 juillet');
    fireEvent.click(bar);
    expect(onReservationClick).not.toHaveBeenCalled();
  });

  it('rule 9 — a closure of one logement sits on a lane of the week, not under it', async () => {
    api.getCalendar.mockResolvedValue(payload(
      [stay(1, '2026-07-18', '2026-07-20')],
      [{ id: 4, propertyId: 1, propertyName: 'Gite', global: false, label: 'Travaux', startDate: '2026-07-20', endDate: '2026-07-22' }],
    ));
    const { container } = renderCal();
    await waitFor(() => expect(container.querySelector('[data-closure-bar="c4"]')).not.toBeNull());
    const top = (el) => el.style.top || getComputedStyle(el).top;
    expect(top(container.querySelector('[data-bar="r1"]'))).toBe(top(container.querySelector('[data-closure-bar="c4"]')));
  });

  it('legend — a platform is listed once whatever its stored casing, with a solid swatch, behind « Légende »', async () => {
    api.getCalendar.mockResolvedValue(payload([
      stay(1, '2026-07-20', '2026-07-22', { platform: 'Abracadaroom', platformDisplay: 'Abracadaroom', color: '#8A55B2' }),
      stay(2, '2026-07-23', '2026-07-24', { platform: 'abracadaroom', platformDisplay: undefined, color: '#8A55B2' }),
    ]));
    renderCal();
    fireEvent.click(await screen.findByRole('button', { name: 'Légende' }));
    await waitFor(() => expect(screen.getAllByText('Abracadaroom').length).toBeGreaterThan(0));
    expect(screen.queryByText('abracadaroom')).not.toBeInTheDocument();
  });

  it('rule 14 — « Aujourd\'hui » is there, the scroll hint is gone', async () => {
    api.getCalendar.mockResolvedValue(payload());
    renderCal();
    expect(await screen.findByRole('button', { name: /Aujourd'hui/ })).toBeInTheDocument();
    expect(screen.queryByText(/Faites défiler/)).toBeNull();
  });
});
