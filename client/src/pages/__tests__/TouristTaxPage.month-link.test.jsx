// specs/finance-data-checks.md §3 rule 16 — a month item of « À vérifier » opens the tax page on that month.
import { vi } from 'vitest';
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxExtraction: vi.fn(), setTouristTaxDeclared: vi.fn() },
}));

import api from '../../api';
import TouristTaxPage from '../TouristTaxPage';

const ym = (offset) => {
  const d = new Date(new Date().getFullYear(), new Date().getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const EMPTY = (month) => ({ month, from: `${month}-01`, toExclusive: `${month}-28`, byProperty: [], reservations: [], totals: { reservationsCount: 0, rentedNights: 0, adultNights: 0, taxAmount: 0, accommodationAmount: 0 } });
const openAt = (entry) => render(
  <ThemeProvider theme={theme}><DialogProvider><MemoryRouter initialEntries={[entry]}><TouristTaxPage /></MemoryRouter></DialogProvider></ThemeProvider>,
);

beforeEach(() => { api.getTouristTaxExtraction.mockReset().mockImplementation((m) => Promise.resolve(EMPTY(m))); });

test('rule 16: ?month= opens that month', async () => {
  openAt(`/finance/tourist-tax?month=${ym(-4)}`);
  await waitFor(() => expect(api.getTouristTaxExtraction).toHaveBeenCalledWith(ym(-4)));
});

test.each([['a month to come', () => ym(2)], ['no real month', () => '2026-13'], ['text', () => 'abc']])('rule 16: %s opens the default month', async (_n, asked) => {
  openAt(`/finance/tourist-tax?month=${asked()}`);
  await waitFor(() => expect(api.getTouristTaxExtraction).toHaveBeenCalledWith(ym(-1)));
  expect(api.getTouristTaxExtraction).not.toHaveBeenCalledWith(asked());
});
