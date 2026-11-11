// specs/tourist-tax-report-v2.md §6 (audit R27-C1) — the « Liste / Par nuit » toggle sits in the bar from `md` only; below
// `md` it is the in-page copy under the pickers, so between 600 and 899 px it is drawn once, not twice.
import { vi } from 'vitest';
import { screen } from '@testing-library/react';
import { reportOf, renderTaxPage } from './touristTaxReportFixtures';

vi.mock('../../api', () => ({ __esModule: true, default: { getTouristTaxReport: vi.fn(), setTouristTaxDeclared: vi.fn() } }));
vi.mock('../../components/PageActionBar', () => ({
  __esModule: true,
  default: ({ title, centerFrom }) => <div data-testid="bar" data-center-from={centerFrom ?? 'sm'}>{title}</div>,
}));

import api from '../../api';

test('R27-C1: the bar shows its toggle from md, where the in-page copy hides', async () => {
  api.getTouristTaxReport.mockResolvedValue(reportOf([]));
  renderTaxPage();
  const bar = await screen.findByTestId('bar');
  expect(bar).toHaveAttribute('data-center-from', 'md');
});
