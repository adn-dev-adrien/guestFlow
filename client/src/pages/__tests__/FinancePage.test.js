import { vi } from 'vitest';
/**
 * FinancePage — specs/finance-overview-rework.md §7 (client):
 *  - renders the 5 top cards (the two year cards first, then période / encaissé / en attente);
 *  - a row click anywhere navigates to the reservation fiche;
 *  - « Tout solder » PATCHes every still-open component paid and does NOT navigate.
 * The page is pure render (all figures shaped server-side), so the fixtures mirror the
 * financeModel payload shape exactly.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getFinanceSummary: vi.fn(),
    getFinanceProjection: vi.fn(),
    getFinanceOperational: vi.fn(),
    markPayment: vi.fn(),
  },
}));

import api from '../../api';
import FinancePage from '../FinancePage';

const SUMMARY = {
  revenueTotal: 1500,
  totalCollected: 900,
  totalPending: 300,
  yearToDate: 4200,
  yearTotal: 8000,
  revenueTotalHt: 1350,
  totalCollectedHt: 810,
  totalPendingHt: 270,
  yearToDateHt: 3780,
  yearTotalHt: 7200,
  revenueByProperty: [{ propertyId: 1, propertyName: 'Gîte', revenue: 1500 }],
  reservations: [
    {
      id: 7, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Gîte', platform: 'direct',
      startDate: '2026-06-01', endDate: '2026-06-05', totalSejour: 500, settled: false,
      remainingDue: 200, depositAmount: 150, depositPaid: 1, balanceAmount: 350, balancePaid: 0,
    },
  ],
};

const PENDING_ROW = {
  id: 42, firstName: 'Marie', lastName: 'Martin', propertyName: 'Tente', platform: 'direct',
  startDate: '2026-05-01', endDate: '2026-05-04', totalSejour: 300, settled: false,
  remainingDue: 300, depositAmount: 100, depositPaid: 0, depositDisabled: 0,
  balanceAmount: 200, balancePaid: 0, complementAmount: 0, endOfStayComplementAmount: 0,
};

const OPERATIONAL = {
  overdue: { reservations: [], count: 0, totalAmount: 0, totals: { overdueAmount: 0 } },
  pending: {
    reservations: [PENDING_ROW],
    totals: { depositAmount: 100, balanceAmount: 200, remainingDue: 300, totalSejour: 300 },
  },
  upcoming: {
    reservations: [],
    totals: { depositAmount: 0, balanceAmount: 0, complementAmount: 0, endOfStayComplementAmount: 0, totalSejour: 0 },
  },
};

const PROJECTION = { targetDate: '2026-07-16', total: 1500, collected: 900, pending: 600, details: [] };

beforeEach(() => {
  navigateSpy.mockReset();
  api.getFinanceSummary.mockReset().mockResolvedValue(SUMMARY);
  api.getFinanceProjection.mockReset().mockResolvedValue(PROJECTION);
  api.getFinanceOperational.mockReset().mockResolvedValue(OPERATIONAL);
  api.markPayment.mockReset().mockResolvedValue({ ok: true });
});

function renderPage() {
  return render(<MemoryRouter><FinancePage /></MemoryRouter>);
}

describe('FinancePage — total-de-séjour overview', () => {
  test('renders the 5 top cards, year cards first', async () => {
    renderPage();
    await screen.findByText('Revenus');
    // Year cards split into a main label + a smaller qualifier (like the period card).
    expect(screen.getByText("depuis le début de l'année")).toBeInTheDocument();
    expect(screen.getByText("sur l'année")).toBeInTheDocument();
    expect(screen.getByText('sur la période')).toBeInTheDocument();
    expect(screen.getAllByText('Revenu total').length).toBeGreaterThan(0); // year card 2 + period card
    // « Encaissé » / « En attente » also appear in the pie legend, hence getAllByText.
    expect(screen.getAllByText('Encaissé').length).toBeGreaterThan(0);
    expect(screen.getAllByText('En attente').length).toBeGreaterThan(0);
    // The two year figures are formatted in euros (non-breaking space thousands separator).
    expect(screen.getByText('4 200 €')).toBeInTheDocument();
    expect(screen.getByText('8 000 €')).toBeInTheDocument();
  });

  test('a pending row click navigates to the reservation fiche', async () => {
    renderPage();
    await screen.findByText('Revenus');
    fireEvent.click(screen.getByRole('tab', { name: 'Paiements en attente' }));
    const cell = await screen.findByText('Tente');
    fireEvent.click(cell);
    expect(navigateSpy).toHaveBeenCalledWith('/reservations/42');
  });

  test('« Tout solder » PATCHes every open component paid and does not navigate', async () => {
    renderPage();
    await screen.findByText('Revenus');
    fireEvent.click(screen.getByRole('tab', { name: 'Paiements en attente' }));
    const button = await screen.findByLabelText('Tout solder');
    fireEvent.click(button);
    await waitFor(() => expect(api.markPayment).toHaveBeenCalledWith(42, { depositPaid: true, balancePaid: true }));
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test('upcoming list pins « Total de séjour » + a paid indicator (settled honours caisse interne)', async () => {
    api.getFinanceOperational.mockResolvedValue({
      overdue: { reservations: [], count: 0, totalAmount: 0 },
      pending: { reservations: [] },
      upcoming: {
        reservations: [{
          id: 9, firstName: 'Léa', lastName: 'Roux', propertyName: 'Gîte', platform: 'direct',
          startDate: '2026-07-01', endDate: '2026-07-05', nights: 4, totalSejour: 620, settled: true,
          remainingDue: 0, depositAmount: 200, depositPaid: 1, balanceAmount: 400, balancePaid: 1,
          complementAmount: 0, endOfStayComplementAmount: 20, endOfStayComplementPaidCash: 1,
        }],
        totals: { depositAmount: 200, balanceAmount: 400, complementAmount: 0, endOfStayComplementAmount: 20, totalSejour: 620 },
      },
    });
    renderPage();
    await screen.findByText('Revenus');
    fireEvent.click(screen.getByRole('tab', { name: 'Réservations à venir' }));
    const row = (await screen.findByText('Léa Roux')).closest('tr');
    expect(within(row).getByText('620 €')).toBeInTheDocument(); // total de séjour pinned right
    expect(within(row).getByText('Payé')).toBeInTheDocument();   // settled via caisse interne
    // discreet « Total de séjour à venir » box (Σ total de séjour of upcoming)
    expect(screen.getByText(/Total de séjour à venir : 620\s*€/)).toBeInTheDocument();
  });

  test('each card shows its element-by-element HT in smaller text', async () => {
    renderPage();
    await screen.findByText('Revenus');
    expect(screen.getByText('3 780 € HT')).toBeInTheDocument(); // yearToDateHt
    expect(screen.getByText('7 200 € HT')).toBeInTheDocument(); // yearTotalHt
    expect(screen.getByText('1 350 € HT')).toBeInTheDocument(); // revenueTotalHt
  });

  test('the pending table foots its columns (server-computed totals)', async () => {
    renderPage();
    await screen.findByText('Revenus');
    fireEvent.click(screen.getByRole('tab', { name: 'Paiements en attente' }));
    await screen.findByText('Tente');
    // The footer renders amounts via eur() (« 100 € » with a separating space), distinct from the
    // row cell « 100€ » — so this match pins the footer specifically.
    expect(screen.getByText('100 €')).toBeInTheDocument(); // Σ acompte
    expect(screen.getByText('200 €')).toBeInTheDocument(); // Σ solde
  });

  test('pending tab shows a green « En attente de paiement » total box (Σ reste à payer)', async () => {
    renderPage();
    await screen.findByText('Revenus');
    fireEvent.click(screen.getByRole('tab', { name: 'Paiements en attente' }));
    // discreet chip « En attente de paiement : 300 € » (label = phrase + remainingDue total)
    expect(await screen.findByText(/En attente de paiement : 300\s*€/)).toBeInTheDocument();
  });

  test('hides the « Paiements en retard » tab when nothing is overdue', async () => {
    renderPage(); // base OPERATIONAL fixture has zero overdue
    await screen.findByText('Revenus');
    await screen.findByRole('tab', { name: 'Paiements en attente' });
    expect(screen.queryByRole('tab', { name: 'Paiements en retard' })).not.toBeInTheDocument();
  });

  test('shows the « Paiements en retard » tab when there are overdue payments', async () => {
    api.getFinanceOperational.mockResolvedValue({
      overdue: {
        reservations: [{
          id: 5, firstName: 'Paul', lastName: 'Durand', propertyName: 'Gîte',
          startDate: '2026-05-01', endDate: '2026-05-03', depositOverdue: true,
          depositAmount: 100, depositDueDate: '2026-04-01', overdueAmount: 100,
        }],
        count: 1, totalAmount: 100, totals: { overdueAmount: 100 },
      },
      pending: { reservations: [], totals: {} },
      upcoming: { reservations: [], totals: {} },
    });
    renderPage();
    await screen.findByText('Revenus');
    expect(await screen.findByRole('tab', { name: 'Paiements en retard' })).toBeInTheDocument();
  });
});
