// specs/tourist-tax-report-v2.md §3 rule 23 — « Par nuit » shows the server's register, one row per night, and its
// empty state; the totals bar stays the same.
import { vi } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { reportOf, renderTaxPage, setPhone } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn() },
}));

import api from '../../api';

const ROW = { reservationId: 7, reservationName: 'Jean Dupont', startDate: '2026-06-20', endDate: '2026-06-22', adults: 2, children: 1, nightsCount: 2, taxAmount: 4.8 };
const NIGHTS = [
  { date: '2026-06-20', staysCount: 1, persons: 3, taxedPersons: 2, exemptPersons: 1, taxAmount: 2.4 },
  { date: '2026-06-21', staysCount: 2, persons: 5, taxedPersons: 4, exemptPersons: 1, taxAmount: 4.75 },
];

beforeEach(() => { setPhone(false); api.getTouristTaxReport.mockReset().mockResolvedValue(reportOf([ROW], { nights: NIGHTS })); });
afterAll(() => setPhone(null));

test('rule 23: the register lists one row per night, from the server', async () => {
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getAllByRole('button', { name: 'Par nuit' })[0]);
  expect(await screen.findByText(/Registre par nuit · juin 2026/)).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'Nuit du' })).toBeInTheDocument();
  const row = screen.getByText(/21\/06\/2026/).closest('tr');
  expect(within(row).getByText('4,75 €')).toBeInTheDocument();
  expect(within(row).getByText('5')).toBeInTheDocument();
  expect(screen.getByText(/sam\.? 20\/06\/2026/)).toBeInTheDocument();
  expect(screen.queryByText('Jean Dupont')).toBeNull();
  expect(api.getTouristTaxReport).toHaveBeenCalledTimes(1);
});

test('rule 23: no night, the empty state says so', async () => {
  api.getTouristTaxReport.mockResolvedValue(reportOf([], { nights: [] }));
  renderTaxPage();
  await screen.findByText('Aucun séjour sur cette période.');
  fireEvent.click(screen.getAllByRole('button', { name: 'Par nuit' })[0]);
  expect(await screen.findByText('Aucune nuit à déclarer sur cette période.')).toBeInTheDocument();
});
