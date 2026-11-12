// specs/tourist-tax-report-v2.md §3 rule 22 — a stay whose platform remits the tax itself is listed muted, with its
// tag « reversée par … » instead of a « Déclarée » box, on desktop and on a phone.
import { vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { reportOf, renderTaxPage, setPhone } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn() },
}));

import api from '../../api';

// date-literal-ok: display-only fixture dates, the page compares none of them with today
const OURS = { reservationId: 7, reservationName: 'Jean Dupont', startDate: '2026-06-20', endDate: '2026-06-22', adults: 2, children: 0, nightsCount: 2, taxAmount: 4.8 };
const PLATFORM = {
  ...OURS, reservationId: 9, key: '9-platform', reservationName: 'Sam Martin', remittedBy: 'platform', platformLabel: 'Airbnb',
  declarable: false, taxAmount: 5.28,
};

beforeEach(() => api.getTouristTaxReport.mockReset().mockResolvedValue(reportOf([OURS, PLATFORM])));
afterAll(() => setPhone(null));

test('rule 22: the platform row is muted, tagged, and has no box', async () => {
  setPhone(false);
  renderTaxPage();
  const row = (await screen.findByText('Sam Martin')).closest('tr');
  expect(row).toHaveAttribute('data-remitted-by', 'platform');
  expect(within(row).getByText('reversée par Airbnb')).toBeInTheDocument();
  expect(within(row).queryByRole('checkbox')).toBeNull();
  expect(within(row).getByText('Airbnb')).toBeInTheDocument();
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
});

test('rule 22: on a phone too', async () => {
  setPhone(true);
  renderTaxPage();
  await screen.findByText('Sam Martin');
  expect(screen.getByText('reversée par Airbnb')).toBeInTheDocument();
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
});
