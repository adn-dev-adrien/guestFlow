// specs/cumulative-month-calendar.md rules 13-14 — the week in progress is the row the Dashboard opens on
// (on a phone, the first stay of the month not yet over), and the day names stick under each month title.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';

const media = vi.hoisted(() => ({ mobile: false }));
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useMediaQuery: () => media.mobile };
});
vi.mock('../../api', () => ({ default: { getCalendar: vi.fn() } }));
vi.mock('../../hooks/useServerToday', () => ({ default: () => '2026-07-16' }));
import api from '../../api';
import CumulativeMonthCalendar from '../CumulativeMonthCalendar';

const stay = (id, startDate, endDate, extra = {}) => ({
  id, propertyId: 1, propertyName: 'Gite', startDate, endDate, label: `Client ${id}`,
  platform: 'Airbnb', platformDisplay: 'Airbnb', color: '#C93848', textColor: '#FFFFFF', past: false, ...extra,
});

describe('CumulativeMonthCalendar — current week', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    media.mobile = false;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-16T12:00:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  const renderCal = (props = {}) => render(
    <ThemeProvider theme={theme}><CumulativeMonthCalendar onReservationClick={() => {}} {...props} /></ThemeProvider>,
  );

  it('rule 13 — only the week holding today is marked, and it holds today', async () => {
    api.getCalendar.mockResolvedValue({ stays: [], closures: [] });
    const { container } = renderCal({ openOnCurrentWeek: true });
    await waitFor(() => expect(container.querySelector('[data-month-anchor="2026-6"]')).not.toBeNull());
    const marked = container.querySelectorAll("[data-current-week='true']");
    expect(marked).toHaveLength(1);
    expect(marked[0].querySelector('[data-date="2026-07-16"]')).not.toBeNull();
    expect(marked[0].querySelector('[data-date="2026-07-13"]')).not.toBeNull();
  });

  it('rule 14 — the day names sit inside each month\'s sticky title, once per month', async () => {
    api.getCalendar.mockResolvedValue({ stays: [], closures: [] });
    const { container } = renderCal();
    await waitFor(() => expect(container.querySelector('[data-month-anchor="2026-6"]')).not.toBeNull());
    const blocks = container.querySelectorAll('[data-month-anchor]');
    blocks.forEach((block) => {
      expect(block.firstElementChild.textContent).toMatch(/LunMarMerJeuVenSamDim$/);
      expect(block.textContent.match(/Lun/g)).toHaveLength(1);
    });
  });

  it('rule 13 — on a phone, today\'s month marks its first stay not yet over; the month before marks nothing', async () => {
    media.mobile = true;
    api.getCalendar.mockResolvedValue({
      stays: [
        stay(1, '2026-07-02', '2026-07-05', { past: true }),
        stay(2, '2026-06-28', '2026-07-20'),
        stay(3, '2026-07-16', '2026-07-18'),
      ],
      closures: [],
    });
    const { container } = renderCal({ openOnCurrentWeek: true });
    await waitFor(() => expect(container.textContent).toMatch(/Client 3/));
    const marked = container.querySelectorAll("[data-current-week='true']");
    expect(marked).toHaveLength(1);
    expect(marked[0].closest('[data-month-anchor]').getAttribute('data-month-anchor')).toBe('2026-6');
    expect(marked[0]).toHaveTextContent('Client 2');
    expect(container.textContent).not.toMatch(/Lun.*Dim/);
  });
});
