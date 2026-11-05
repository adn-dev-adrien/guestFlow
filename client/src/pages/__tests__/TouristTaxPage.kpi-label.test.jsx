// specs/ui-review-2026-10-19-operations.md rule 45 — the count reads every row of the selection, whatever its channel:
// no « Réservations directes ». Since specs/tourist-tax-report-v2.md rule 20 it is the « Séjours » total of the bar.
import { vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { reportOf, renderTaxPage, TOTALS } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({ __esModule: true, default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn() } }));

import api from '../../api';

test('rule 45: the count reads « Séjours »', async () => {
  api.getTouristTaxReport.mockResolvedValue(reportOf([], { totals: { ...TOTALS, staysCount: 2 } }));
  renderTaxPage();
  const stays = within(await screen.findByTestId('total-stays'));
  expect(stays.getByText('Séjours')).toBeInTheDocument();
  expect(stays.getByText('2')).toBeInTheDocument();
  expect(screen.queryByText(/Réservations directes/)).toBeNull();
});
