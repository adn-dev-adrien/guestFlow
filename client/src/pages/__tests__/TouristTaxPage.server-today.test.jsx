// specs/tourist-tax-report-v2.md §3 rule 32 (reviews R1-03, R4-7, R6-4) — the month the page opens on, and the
// month of an « À vérifier » link, are judged from the server's day once it is known, never from the device's.
// The device clock is pinned here, and the server's day mocked apart from it.
import { vi } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';
import { reportOf } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn(), getToday: vi.fn() },
}));

import api from '../../api';
import TouristTaxPage from '../TouristTaxPage';

const openAt = (entry) => render(
  <ThemeProvider theme={theme}><DialogProvider><MemoryRouter initialEntries={[entry]}><TouristTaxPage /></MemoryRouter></DialogProvider></ThemeProvider>,
);
const firstMonthRead = () => api.getTouristTaxReport.mock.calls[0][0].month;

beforeEach(() => {
  api.getTouristTaxReport.mockReset().mockResolvedValue(reportOf([]));
});
afterEach(() => { vi.useRealTimers(); });

test('rule 32: a device two months ahead still opens on the month before the server day', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-01-02T10:00:00') });
  api.getToday.mockResolvedValue({ today: '2026-11-05' });
  openAt('/finance/tourist-tax');
  await waitFor(() => expect(api.getTouristTaxReport).toHaveBeenCalled());
  expect(firstMonthRead()).toBe('2026-10');
});

test('rule 32: a linked month the device thinks is to come opens, the server day being on it', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-31T23:00:00') });
  api.getToday.mockResolvedValue({ today: '2026-11-05' });
  openAt('/finance/tourist-tax?month=2026-11');
  await waitFor(() => expect(api.getTouristTaxReport).toHaveBeenCalled());
  expect(firstMonthRead()).toBe('2026-11');
});

test('rule 32: a linked month still to come for the server opens the server default, nothing is sent for it', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-12-02T10:00:00') });
  api.getToday.mockResolvedValue({ today: '2026-11-05' });
  openAt('/finance/tourist-tax?month=2026-12');
  await waitFor(() => expect(api.getTouristTaxReport).toHaveBeenCalled());
  expect(firstMonthRead()).toBe('2026-10');
  expect(api.getTouristTaxReport.mock.calls.every(([q]) => q.month !== '2026-12')).toBe(true);
});

test('rule 32: nothing is read before the server day is known', async () => {
  let answer;
  api.getToday.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  openAt('/finance/tourist-tax');
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  expect(api.getTouristTaxReport).not.toHaveBeenCalled();
  answer({ today: '2026-03-15' }); // date-literal-ok: the server's day, mocked; the page reads nothing else
  await waitFor(() => expect(api.getTouristTaxReport).toHaveBeenCalled());
  expect(firstMonthRead()).toBe('2026-02');
});
