/**
 * FinancePage — specs/finance-dashboard-redesign.md rules 34 + 49, specs/direct-installments.md rules 14 + 48 (spec
 * review of 2026-10-27, agent 3 F3): a late installment is an element of « En retard »; « Marquer payé »
 * records it through its own endpoint, never through a payment flag it does not have.
 */

import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getFinanceDashboard: vi.fn(),
    getFinanceDashboardDetail: vi.fn(),
    markPayment: vi.fn(),
    markInstallmentPaid: vi.fn(),
  },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { DASHBOARD } from './financePageFixtures';

const PLAN_ROW = {
  id: 22310, firstName: 'Anne', lastName: 'Plan', propertyName: 'Gîte', platform: 'Direct',
  startDate: '2027-03-10', endDate: '2027-03-15', overdueAmount: 344, oldestDueDate: '2026-10-01', isOverdue: true,
  depositAmount: 0, balanceAmount: 0, payoutOverdue: false,
  overdueItems: [
    { kind: 'installment:7', installmentId: 7, paidField: null, label: 'Échéance 1/3', amount: 172, dueDate: '2026-10-01' },
    { kind: 'installment:8', installmentId: 8, paidField: null, label: 'Échéance 2/3', amount: 172, dueDate: '2026-10-15' },
  ],
};

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue({ ...DASHBOARD, tiles: { ...DASHBOARD.tiles, late: { amount: 344, stays: 1, payouts: 0 } } });
  api.getFinanceDashboardDetail.mockReset().mockResolvedValue({ rows: [PLAN_ROW], totals: { amount: 344, count: 1, payouts: { count: 0, totalAmount: 0 } } });
  api.markPayment.mockReset().mockResolvedValue({});
  api.markInstallmentPaid.mockReset().mockResolvedValue({});
});

test('late installments are listed and « Marquer payé » records each one, no payment flag', async () => {
  render(
    <MemoryRouter initialEntries={['/finance']}>
      <Routes><Route path="/finance" element={<FinancePage />} /></Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'En retard : afficher le détail' }));
  const panel = await screen.findByRole('region', { name: 'En retard' });
  expect((await within(panel).findAllByText(/Échéance 1\/3/)).length).toBeGreaterThan(0);
  const row = (await within(panel).findAllByText('Anne Plan'))[0].closest('tr, [data-testid], li, .MuiCard-root, .MuiPaper-root');
  fireEvent.click(within(row).getByRole('button', { name: 'Marquer payé' }));
  await waitFor(() => expect(api.markInstallmentPaid).toHaveBeenCalledTimes(2));
  expect(api.markInstallmentPaid).toHaveBeenNthCalledWith(1, 22310, 7, {});
  expect(api.markInstallmentPaid).toHaveBeenNthCalledWith(2, 22310, 8, {});
  expect(api.markPayment).not.toHaveBeenCalled();
});
