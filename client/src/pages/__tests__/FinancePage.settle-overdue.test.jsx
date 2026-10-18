/**
 * FinancePage — specs/finance-dashboard-redesign.md rule 38: « Marquer payé » on a row of « En retard »
 * ticks exactly the elements its chips list (review of PR #702, major 1: a late platform payout also
 * marked the guest's on-site complement as paid).
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
  },
}));

import api from '../../api';
import FinancePage from '../FinancePage';
import { DASHBOARD } from './financePageFixtures';

const PAYOUT_ROW = {
  id: 22275, firstName: 'Léa', lastName: 'Martin', propertyName: 'Estiva', platform: 'Abracadaroom',
  startDate: '2026-09-01', endDate: '2026-09-04', overdueAmount: 720.82, oldestDueDate: '2026-09-14', isOverdue: true,
  balanceAmount: 720.82, balancePaid: false, complementAmount: 132, complementPaid: false,
  payoutOverdue: true,
  overdueItems: [{ kind: 'payout', paidField: 'balancePaid', label: 'Versement Abracadaroom', amount: 720.82, dueDate: '2026-09-14' }],
};
const GUEST_ROW = {
  id: 22300, firstName: 'Paul', lastName: 'Durand', propertyName: 'Gîte', platform: 'Direct',
  startDate: '2026-10-25', endDate: '2026-10-28', overdueAmount: 100, oldestDueDate: '2026-10-10', isOverdue: true,
  depositAmount: 100, depositPaid: false, balanceAmount: 400, balancePaid: false, complementAmount: 50, complementPaid: false,
  payoutOverdue: false,
  overdueItems: [{ kind: 'deposit', paidField: 'depositPaid', label: 'Acompte', amount: 100, dueDate: '2026-10-10' }],
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/finance']}>
      <Routes><Route path="/finance" element={<FinancePage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.getFinanceDashboard.mockReset().mockResolvedValue({ ...DASHBOARD, tiles: { ...DASHBOARD.tiles, late: { amount: 820.82, stays: 2, payouts: 1 } } });
  api.getFinanceDashboardDetail.mockReset().mockResolvedValue({
    rows: [PAYOUT_ROW, GUEST_ROW],
    totals: { amount: 820.82, count: 2, payouts: { count: 1, totalAmount: 720.82 } },
  });
  api.markPayment.mockReset().mockResolvedValue({});
});

async function settle(name) {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'En retard : afficher le détail' }));
  const panel = await screen.findByRole('region', { name: 'En retard' });
  const row = (await within(panel).findAllByText(name))[0].closest('tr, [data-testid], li, .MuiCard-root, .MuiPaper-root');
  fireEvent.click(within(row).getByRole('button', { name: 'Marquer payé' }));
}

test('rule 38 — a late platform payout ticks the balance only, never the complement', async () => {
  await settle('Léa Martin');
  await waitFor(() => expect(api.markPayment).toHaveBeenCalledTimes(1));
  expect(api.markPayment).toHaveBeenCalledWith(22275, { balancePaid: true });
});

test('rule 38 — a late guest deposit ticks the deposit only', async () => {
  await settle('Paul Durand');
  await waitFor(() => expect(api.markPayment).toHaveBeenCalledTimes(1));
  expect(api.markPayment).toHaveBeenCalledWith(22300, { depositPaid: true });
});
