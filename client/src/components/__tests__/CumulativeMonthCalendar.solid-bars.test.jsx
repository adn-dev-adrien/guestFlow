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

  // specs/ui-review-2026-10-19-operations.md rule 14 (live part) — a past stay keeps the soft tint and ink text.
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

  // specs/ui-review-2026-10-19-operations.md rule 13 (live part) — a closure of every logement is not a lane:
  // it hatches whole day columns and carries one label « Tout fermé ».
  it('a closure of every logement hatches the day columns and is labelled « Tout fermé », with no bar', async () => {
    api.getCalendar.mockResolvedValue(payload([], [{ id: 5, propertyId: null, propertyName: null, global: true, label: 'Hiver', startDate: '2026-07-20', endDate: '2026-07-22' }]));
    const { container } = renderCal();
    await waitFor(() => expect(screen.getAllByText(/Tout fermé/).length).toBeGreaterThan(0));
    expect(container.querySelector('[data-closure-bar="c5"]')).toBeNull();
    const hatched = [...container.querySelectorAll('[data-date]')].filter((el) => getComputedStyle(el).backgroundImage.includes('repeating-linear-gradient'));
    expect(hatched.map((el) => el.getAttribute('data-date')).sort()).toEqual(['2026-07-20', '2026-07-21']);
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

describe('CumulativeMonthCalendar — keyboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-16T12:00:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('a stay bar is reachable from the keyboard, named in full, and Enter opens its fiche', async () => {
    const onReservationClick = vi.fn();
    api.getCalendar.mockResolvedValue(payload([stay(1, '2026-07-20', '2026-07-22')]));
    const { container } = render(<ThemeProvider theme={theme}><CumulativeMonthCalendar onReservationClick={onReservationClick} /></ThemeProvider>);
    await waitFor(() => expect(container.querySelector('[data-bar="r1"]')).not.toBeNull());
    const bar = container.querySelector('[data-bar="r1"]');
    expect(bar).toHaveAttribute('tabindex', '0');
    expect(bar).toHaveAttribute('role', 'button');
    expect(bar).toHaveAttribute('aria-label', 'Gite · Jean Dupont — Airbnb, 20 juillet → 22 juillet');
    fireEvent.keyDown(bar, { key: 'Enter' });
    expect(onReservationClick).toHaveBeenCalledWith(1);
  });
});
