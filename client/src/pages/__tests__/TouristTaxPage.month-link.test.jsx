// specs/finance-data-checks.md §3 rule 16 — a month item of « À vérifier » opens the tax page on that month.
// Since specs/tourist-tax-report-v2.md rule 17 the page reads the period report: the month arrives as `period=month`.
import { vi } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn() },
}));

import api from '../../api';
import TouristTaxPage from '../TouristTaxPage';
import { reportOf } from './touristTaxReportFixtures';

const ym = (offset) => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const asked = (month) => expect.objectContaining({ period: 'month', month });
const openAt = (entry) => render(
  <ThemeProvider theme={theme}><DialogProvider><MemoryRouter initialEntries={[entry]}><TouristTaxPage /></MemoryRouter></DialogProvider></ThemeProvider>,
);

beforeEach(() => { api.getTouristTaxReport.mockReset().mockImplementation(() => Promise.resolve(reportOf([]))); });

test('rule 16: ?month= opens that month', async () => {
  openAt(`/finance/tourist-tax?month=${ym(-4)}`);
  await waitFor(() => expect(api.getTouristTaxReport).toHaveBeenCalledWith(asked(ym(-4))));
});

test.each([['a month to come', () => ym(2)], ['no real month', () => '2026-13'], ['text', () => 'abc']])('rule 16: %s opens the default month', async (_n, month) => {
  openAt(`/finance/tourist-tax?month=${month()}`);
  await waitFor(() => expect(api.getTouristTaxReport).toHaveBeenCalledWith(asked(ym(-1))));
  expect(api.getTouristTaxReport).not.toHaveBeenCalledWith(asked(month()));
});
