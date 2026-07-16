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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    getReservation: vi.fn(),
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
  // remainingToPay = Σ still-owed buckets (specs/finance-operational-remaining-to-pay.md §3);
  // remainingDue kept for back-compat callers but no longer drives the pending view.
  remainingToPay: 300, remainingDue: 300, depositAmount: 100, depositPaid: 0, depositDisabled: 0,
  balanceAmount: 200, balancePaid: 0, complementAmount: 0, endOfStayComplementAmount: 0,
};

const OPERATIONAL = {
  overdue: { reservations: [], count: 0, totalAmount: 0, totals: { overdueAmount: 0 } },
  pending: {
    reservations: [PENDING_ROW],
    totals: { depositAmount: 100, balanceAmount: 200, complementAmount: 0, endOfStayComplementAmount: 0, remainingToPay: 300, remainingDue: 300, totalSejour: 300 },
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
  api.getReservation.mockReset().mockResolvedValue(null);
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
    // « sur la période » qualifies both the period revenue card and the pending card.
    expect(screen.getAllByText('sur la période').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Revenu total').length).toBeGreaterThan(0); // year card 2 + period card
    // « Encaissé » / « En attente » also appear in the pie legend, hence getAllByText.
    expect(screen.getAllByText('Encaissé').length).toBeGreaterThan(0);
    expect(screen.getAllByText('En attente').length).toBeGreaterThan(0);
    expect(screen.getByText('En attente de règlement')).toBeInTheDocument();
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

  test('upcoming tab renders the read-only payments table + the « En attente de paiement » box', async () => {
    // specs/finance-upcoming-payments-table.md — same payments table as Paiements en attente, read-only,
    // without the « Compl. fin de séjour » column. No per-reservation fetch any more.
    api.getFinanceOperational.mockResolvedValue({
      overdue: { reservations: [], count: 0, totalAmount: 0 },
      pending: { reservations: [], totals: {} },
      upcoming: {
        reservations: [{
          id: 9, firstName: 'Léa', lastName: 'Roux', propertyName: 'Gîte', platform: 'direct',
          startDate: '2026-07-01', endDate: '2026-07-04', depositAmount: 200, depositPaid: 0,
          balanceAmount: 420, balancePaid: 0, complementAmount: 0, endOfStayComplementAmount: 0,
          remainingToPay: 620, totalSejour: 620,
        }],
        totals: { depositAmount: 200, balanceAmount: 420, complementAmount: 0, remainingToPay: 620, totalSejour: 620 },
      },
    });
    renderPage();
    await screen.findByText('Revenus');
    fireEvent.click(screen.getByRole('tab', { name: 'Réservations à venir' }));
    // green « En attente de paiement » box (Σ reste à payer of upcoming) — exact amount
    // (actionable total → formatCurrency, specs/ds-theme-maison.md §3 rule 6 correction).
    expect(await screen.findByText(/En attente de paiement : 620,00\s*€/)).toBeInTheDocument();
    // the reservation row + no end-of-stay column header + no « Tout solder » action (read-only)
    expect(await screen.findByText('Léa Roux')).toBeInTheDocument();
    expect(screen.getByText('Gîte')).toBeInTheDocument();
    expect(screen.queryByText('Compl. fin de séjour')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tout solder')).not.toBeInTheDocument();
    // a row click navigates to the fiche
    fireEvent.click(screen.getByText('Gîte'));
    expect(navigateSpy).toHaveBeenCalledWith('/reservations/9');
    // the table is fed by the operational payload alone (no per-reservation detail fetch)
    expect(api.getReservation).not.toHaveBeenCalled();
  });

  test('period tab shows a « Période du … au … » chip above the table', async () => {
    renderPage();
    await screen.findByText('Revenus');
    // The « Revenus par logement » chart caption already carries one « Période du … au … »; switching
    // to the period tab adds the chip, so a second occurrence appears.
    const before = screen.getAllByText(/Période du .+ au .+/).length;
    fireEvent.click(screen.getByRole('tab', { name: 'Réservations période' }));
    await waitFor(() => expect(screen.getAllByText(/Période du .+ au .+/).length).toBe(before + 1));
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
    // Post-sweep the whole table (rows + footer) formats via formatCurrency, so the column totals
    // render as « 100,00 € » / « 200,00 € » — appearing in both the row and the footer.
    expect(screen.getAllByText('100,00 €').length).toBeGreaterThanOrEqual(1); // Σ acompte (footer + row)
    expect(screen.getAllByText('200,00 €').length).toBeGreaterThanOrEqual(1); // Σ solde
  });

  test('pending tab shows a green « En attente de paiement » total box (Σ reste à payer)', async () => {
    renderPage();
    await screen.findByText('Revenus');
    fireEvent.click(screen.getByRole('tab', { name: 'Paiements en attente' }));
    // discreet chip « En attente de paiement : 300,00 € » (exact actionable total)
    expect(await screen.findByText(/En attente de paiement : 300,00\s*€/)).toBeInTheDocument();
  });

  test('projection detail rows and footer reconcile at the cent (never rounded)', async () => {
    // Regression net for the phase-1 review finding: cents-bearing amounts (platform commissions
    // make them routine) must render EXACT in the reconciliation table — rows must visually sum to
    // the footer. Only the KPI h5 figures above the table stay rounded (overview style).
    api.getFinanceProjection.mockResolvedValue({
      targetDate: '2026-07-16',
      total: 501, // 2 × 250.50
      collected: 200.5,
      pending: 300.5,
      details: [
        { reservationId: 1, clientName: 'Jean Dupont', propertyName: 'Gîte', startDate: '2026-07-01', endDate: '2026-07-04', collected: 100.25, totalSejour: 250.5, settled: false },
        { reservationId: 2, clientName: 'Marie Martin', propertyName: 'Tente', startDate: '2026-07-05', endDate: '2026-07-08', collected: 100.25, totalSejour: 250.5, settled: false },
      ],
    });
    renderPage();
    await screen.findByText('Revenus');
    // Detail rows: exact cents, twice each.
    expect((await screen.findAllByText('250,50 €')).length).toBe(2);
    expect(screen.getAllByText('100,25 €').length).toBe(2);
    // Footer: exact — reconciles with the rows (2 × 250,50 = 501,00).
    expect(screen.getByText('501,00 €')).toBeInTheDocument();
    expect(screen.getByText('200,50 €')).toBeInTheDocument();
    // KPI h5 figures stay rounded (overview style): « 501 € » present as the headline total.
    expect(screen.getByText('501 €')).toBeInTheDocument();
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
