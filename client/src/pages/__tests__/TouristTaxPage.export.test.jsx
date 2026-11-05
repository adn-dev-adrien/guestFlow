// specs/tourist-tax-report-v2.md §3 rule 24 — « Exporter en CSV » downloads the selection shown and its view from
// the server; a refusal says the server's reason.
import { vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { reportOf, renderTaxPage } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn(), downloadTouristTaxReportCsv: vi.fn() },
}));

import api from '../../api';

const ROW = { reservationId: 7, reservationName: 'Jean Dupont', startDate: '2026-06-20', endDate: '2026-06-22', adults: 2, children: 0, nightsCount: 2, taxAmount: 4.8 };

beforeEach(() => {
  api.getTouristTaxReport.mockReset().mockResolvedValue(reportOf([ROW]));
  api.downloadTouristTaxReportCsv.mockReset().mockResolvedValue('taxe.csv');
});

test('rule 24: the export takes the selection read and the view on screen', async () => {
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getAllByRole('button', { name: 'Par nuit' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Exporter en CSV' }));
  await waitFor(() => expect(api.downloadTouristTaxReportCsv).toHaveBeenCalledWith(api.getTouristTaxReport.mock.calls[0][0], 'night'));
});

test('rule 24: a refused export says why', async () => {
  api.downloadTouristTaxReportCsv.mockRejectedValue(new Error('Période inconnue.'));
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  fireEvent.click(screen.getByRole('button', { name: 'Exporter en CSV' }));
  expect(await screen.findByText('Période inconnue.')).toBeInTheDocument();
});
