// specs/tourist-tax-report-v2.md §3 rule 31 (reviews R5-10, R4-6) — the period, the view and the filters live in the
// URL: a link (or the way back from a fiche) opens them, a change writes them, and a fiche keeps the whole way back.
import { vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';
import { reportOf } from './touristTaxReportFixtures';

const navigateSpy = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateSpy };
});
vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn(), getToday: vi.fn() },
}));

import api from '../../api';
import TouristTaxPage from '../TouristTaxPage';

const ROW = { reservationId: 7, reservationName: 'Jean Dupont', startDate: '2026-06-20', endDate: '2026-06-22', adults: 2, children: 0, nightsCount: 2, taxAmount: 4.8 }; // date-literal-ok: display-only fixture dates
function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.search}</output>;
}
const openAt = (entry) => render(
  <ThemeProvider theme={theme}><DialogProvider><MemoryRouter initialEntries={[entry]}><TouristTaxPage /><Where /></MemoryRouter></DialogProvider></ThemeProvider>,
);
const where = () => new URLSearchParams(screen.getByTestId('where').textContent);

beforeEach(() => {
  navigateSpy.mockReset();
  api.getToday.mockReset().mockResolvedValue({ today: '2026-07-05' }); // date-literal-ok: the server's day, mocked
  api.getTouristTaxReport.mockReset().mockResolvedValue(reportOf([ROW]));
});

test('rule 31: the URL opens a year, a logement, a status and the register', async () => {
  openAt('/finance/tourist-tax?period=year&year=2026&propertyId=2&declaration=todo&view=night');
  await screen.findByText(/Registre par nuit/);
  expect(api.getTouristTaxReport.mock.calls[0][0]).toEqual({ period: 'year', year: '2026', propertyId: '2', declaration: 'todo' });
  expect(screen.getAllByRole('button', { name: 'Par nuit' })[0]).toHaveAttribute('aria-pressed', 'true');
});

test('rule 31 (R4-6): a month link with its logement opens that month on that logement', async () => {
  openAt('/finance/tourist-tax?month=2026-05&propertyId=2');
  await screen.findByText('Jean Dupont');
  expect(api.getTouristTaxReport.mock.calls[0][0]).toEqual({ period: 'month', month: '2026-05', propertyId: '2', declaration: '' });
});

test('rule 31: what is not a logement, a status or a view is ignored', async () => {
  openAt('/finance/tourist-tax?propertyId=abc&declaration=maybe&view=grid&period=week');
  await screen.findByText('Jean Dupont');
  expect(api.getTouristTaxReport.mock.calls[0][0]).toEqual({ period: 'month', month: '2026-06', propertyId: '', declaration: '' });
});

test('rule 31: a change writes the selection and the view; a fiche opens with the whole way back', async () => {
  openAt('/finance/tourist-tax');
  await screen.findByText('Jean Dupont');
  await waitFor(() => expect(where().get('month')).toBe('2026-06'));
  fireEvent.click(screen.getByRole('button', { name: 'Trimestre' }));
  await waitFor(() => expect(where().get('period')).toBe('quarter'));
  expect(where().get('quarter')).toBe('2026-Q3');
  expect(where().get('month')).toBeNull();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getAllByRole('button', { name: 'Par nuit' })[0]);
  await waitFor(() => expect(where().get('view')).toBe('night'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Liste' })[0]);
  await waitFor(() => expect(where().get('view')).toBeNull());
  fireEvent.click(screen.getByText('Jean Dupont'));
  const target = navigateSpy.mock.calls.at(-1)[0];
  expect(target.startsWith('/reservations/7?from=')).toBe(true);
  expect(decodeURIComponent(target.split('from=')[1])).toBe('/finance/tourist-tax?period=quarter&quarter=2026-Q3');
});
