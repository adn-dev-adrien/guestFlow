import { vi } from 'vitest';
/**
 * TouristTaxPage — specs/ds-sweep-finance.md rule 23: the amount declared to the commune is printed to the cent
 * (mega review #5, M5: 5,95 € showed « 6 € », 52,44 € showed « 52 € »). Since specs/tourist-tax-report-v2.md
 * rule 20 the figure is the « À reverser » total of the sticky bar, which replaced the tiles.
 */

import { screen, within } from '@testing-library/react';
import { reportOf, renderTaxPage, TOTALS } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn() },
}));

import api from '../../api';

test('rule 23 — the declared total keeps its cents', async () => {
  api.getTouristTaxReport.mockResolvedValue(reportOf(
    // date-literal-ok: display-only fixture dates, the page compares none of them with today
    [{ reservationId: 7, reservationName: 'Jean Dupont', startDate: '2026-09-20', endDate: '2026-09-21', adults: 2, children: 0, nightsCount: 1, taxAmount: 5.95 }],
    { totals: { ...TOTALS, amount: 5.95, remainingAmount: 5.95 } },
  ));
  renderTaxPage();
  const total = within(await screen.findByTestId('total-amount'));
  expect(total.getByText(/À reverser/)).toBeInTheDocument();
  expect(total.getByText('5,95 €')).toBeInTheDocument();
  expect(screen.getByTestId('total-amount').textContent).not.toMatch(/(^|[^,\d])6 €/);
});
