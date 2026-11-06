// specs/tourist-tax-report-v2.md §3 rule 32 (review R1-04) — a first read the server refuses never dead-ends: its
// reason shows, and the page opens the default month with its pickers.
import { vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { render } from '@testing-library/react';
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

const ROW = { reservationId: 7, reservationName: 'Jean Dupont', startDate: '2026-06-20', endDate: '2026-06-22', adults: 2, children: 0, nightsCount: 2, taxAmount: 4.8 }; // date-literal-ok: display-only fixture dates
const openAt = (entry) => render(
  <ThemeProvider theme={theme}><DialogProvider><MemoryRouter initialEntries={[entry]}><TouristTaxPage /></MemoryRouter></DialogProvider></ThemeProvider>,
);

beforeEach(() => {
  api.getToday.mockReset().mockResolvedValue({ today: '2026-07-05' }); // date-literal-ok: the server's day, mocked
  api.getTouristTaxReport.mockReset();
});

test('rule 32: a refused first selection says why, then opens the default month with its pickers', async () => {
  api.getTouristTaxReport
    .mockRejectedValueOnce(Object.assign(new Error('Les mois futurs ne sont pas autorisés.'), { status: 400 }))
    .mockResolvedValue(reportOf([ROW]));
  openAt('/finance/tourist-tax?period=year&year=2031');
  expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Les mois futurs ne sont pas autorisés.');
  expect(api.getTouristTaxReport.mock.calls[1][0]).toEqual({ period: 'month', month: '2026-06', propertyId: '', declaration: '' });
  expect(screen.getByRole('button', { name: 'Mois' })).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Mois' }));
  fireEvent.click(await screen.findByRole('option', { name: 'mai 2026' }));
  await waitFor(() => expect(api.getTouristTaxReport).toHaveBeenLastCalledWith(expect.objectContaining({ month: '2026-05' })));
});

test('rule 32: a server failure on the first read still offers « Réessayer »', async () => {
  api.getTouristTaxReport.mockRejectedValueOnce(Object.assign(new Error('Le serveur ne répond pas correctement.'), { status: 500 })).mockResolvedValue(reportOf([ROW]));
  openAt('/finance/tourist-tax');
  expect(await screen.findByText("Impossible de charger l'extraction.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));
  expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
});
