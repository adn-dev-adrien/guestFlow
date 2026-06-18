import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Force the mobile breakpoint for this file.
vi.mock('@mui/material', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useMediaQuery: () => true };
});
vi.mock('../../api', () => ({ default: {
  getReservations: vi.fn().mockResolvedValue([]),
  getEstablishmentClosures: vi.fn().mockResolvedValue([]),
} }));

import api from '../../api';
import CumulativeMonthCalendar from '../CumulativeMonthCalendar';

// specs/cumulative-month-calendar.md §6 — on mobile the month renders as a readable agenda list
// (one row per reservation: logement, client, date range) instead of the wide 7-column grid.
describe('CumulativeMonthCalendar — mobile agenda', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function todayIso() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  }

  it('renders reservations as agenda rows (logement + client + date range)', async () => {
    const d = todayIso();
    api.getReservations.mockResolvedValue([
      { id: 1, startDate: d, endDate: d, platform: 'airbnb', propertyName: 'Le Studio', firstName: 'Marie', lastName: 'Martin' },
    ]);
    const { container } = render(<CumulativeMonthCalendar onReservationClick={() => {}} />);
    await waitFor(() => expect(container.textContent).toMatch(/Le Studio/));
    expect(container.textContent).toMatch(/Marie Martin/);
    // The wide grid's weekday header (7 columns) must NOT be rendered on mobile.
    expect(container.textContent).not.toMatch(/LunMarMerJeuVenSamDim/);
  });
});
