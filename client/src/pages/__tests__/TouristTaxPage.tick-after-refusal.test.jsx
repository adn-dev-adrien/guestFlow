// specs/tourist-tax-report-v2.md §3 rule 33 (review R1-05) — while a refused selection's reason is shown, a tick
// re-reads the selection ON SCREEN, so the bar takes the server's figures.
import { vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { reportOf, renderTaxPage, TOTALS } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn(), getToday: vi.fn() },
}));

import api from '../../api';

const ROW = { reservationId: 7, reservationName: 'Jean Dupont', startDate: '2026-06-20', endDate: '2026-06-22', adults: 2, children: 0, nightsCount: 2, taxAmount: 4.8 }; // date-literal-ok: display-only fixture dates

beforeEach(() => {
  api.getToday.mockReset().mockResolvedValue({ today: '2026-07-05' }); // date-literal-ok: the server's day, mocked
  api.getTouristTaxReport.mockReset().mockResolvedValue(reportOf([ROW]));
  api.setTouristTaxDeclared.mockReset().mockResolvedValue({ declaredAt: '2026-07-05 10:00:00' }); // date-literal-ok: a stamp echoed back
});

test('rule 33: a tick made under a refusal reads the shown selection, and the bar moves', async () => {
  renderTaxPage();
  await screen.findByText('Jean Dupont');
  const shown = api.getTouristTaxReport.mock.calls[0][0];
  api.getTouristTaxReport.mockRejectedValueOnce(Object.assign(new Error('Les mois futurs ne sont pas autorisés.'), { status: 400 }));
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Mois' }));
  fireEvent.click(await screen.findByRole('option', { name: 'juillet 2026' }));
  await screen.findByRole('alert');
  api.getTouristTaxReport.mockResolvedValue(reportOf(
    [{ ...ROW, touristTaxDeclaredAt: '2026-07-05 10:00:00' }], // date-literal-ok: a stamp echoed back
    { totals: { ...TOTALS, declaredAmount: 4.8, remainingAmount: 0, allDeclared: true } },
  ));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Déclarée — Jean Dupont' }));
  await waitFor(() => expect(api.getTouristTaxReport).toHaveBeenCalledTimes(3));
  expect(api.getTouristTaxReport.mock.calls[2][0]).toEqual(shown);
  await waitFor(() => expect(within(screen.getByTestId('total-amount')).getByText('tout est déclaré')).toBeInTheDocument());
  expect(within(screen.getByTestId('total-declared')).getByText('4,80 €')).toBeInTheDocument();
});
