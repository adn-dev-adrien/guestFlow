import { vi } from 'vitest';
/**
 * TouristTaxPage — specs/tourist-tax-declared-checkbox.md §7 (client):
 *  - « Dates réservation » shows the reservation's stay dates (arrival → departure), NOT the last night
 *    (non-regression: a 1-night stay 20/06 → 21/06 must render « 20/06/2026 au 21/06/2026 »);
 *  - the « Déclarée » checkbox reflects touristTaxDeclaredAt and toggling PATCHes without navigating.
 * The page is pure render (all figures shaped server-side), so the fixture mirrors the financeModel payload.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

const navigateSpy = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getTouristTaxExtraction: vi.fn(),
    setTouristTaxDeclared: vi.fn(),
  },
}));

import api from '../../api';
import TouristTaxPage from '../TouristTaxPage';

const DATA = {
  month: '2026-06',
  from: '2026-06-01',
  toExclusive: '2026-07-01',
  byProperty: [{ propertyId: 1, propertyName: 'Gîte', reservationsCount: 2, nightsCount: 3, adultNights: 6, taxAmount: 12, accommodationAmount: 600 }],
  reservations: [
    {
      reservationId: 7, propertyId: 1, propertyName: 'Gîte', reservationName: 'Jean Dupont',
      startDate: '2026-06-20', endDate: '2026-06-21', lastNightDate: '2026-06-20',
      touristTaxDeclaredAt: null, adults: 2, children: 0, nightsCount: 1, taxRate: 1, taxAmount: 4, accommodationAmount: 200,
    },
    {
      reservationId: 8, propertyId: 1, propertyName: 'Gîte', reservationName: 'Marie Martin',
      startDate: '2026-06-10', endDate: '2026-06-12', lastNightDate: '2026-06-11',
      touristTaxDeclaredAt: '2026-06-30 09:00:00', adults: 2, children: 0, nightsCount: 2, taxRate: 1, taxAmount: 8, accommodationAmount: 400,
      refundedTaxNights: 0, refundedTaxAmount: 0,
    },
  ],
  totals: { reservationsCount: 2, rentedNights: 3, adultNights: 6, taxAmount: 12, accommodationAmount: 600 },
};

beforeEach(() => {
  navigateSpy.mockReset();
  api.getTouristTaxExtraction.mockReset().mockResolvedValue(DATA);
  api.setTouristTaxDeclared.mockReset().mockResolvedValue({ declaredAt: '2026-07-01 10:00:00' });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><DialogProvider>
        <TouristTaxPage />
      </DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

test('« Dates réservation » shows arrival → departure (a 1-night stay is not collapsed onto one day)', async () => {
  renderPage();
  expect(await screen.findByText('20/06/2026 au 21/06/2026')).toBeInTheDocument();
  // Regression guard: it must NOT show the old « au 20/06/2026 » (last-night minus one day).
  expect(screen.queryByText('20/06/2026 au 20/06/2026')).not.toBeInTheDocument();
});

test('« Déclarée » checkbox reflects touristTaxDeclaredAt and toggling PATCHes without navigating', async () => {
  renderPage();
  const undeclared = await screen.findByLabelText('Déclarée — Jean Dupont');
  const declared = screen.getByLabelText('Déclarée — Marie Martin');
  expect(undeclared).not.toBeChecked();
  expect(declared).toBeChecked();

  fireEvent.click(undeclared);
  await waitFor(() => expect(api.setTouristTaxDeclared).toHaveBeenCalledWith(7, true));
  expect(navigateSpy).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.getByLabelText('Déclarée — Jean Dupont')).toBeChecked());
});

// specs/reservation-refunds.md §3.5 — les chiffres affichés sont NETS des nuits dont la taxe a été
// rendue ; la mention dit ce qui a été retiré, sinon l'écart avec la fiche serait inexplicable.
// specs/reservation-refunds.md rule 32 — la ligne DIT pourquoi son net est plus bas : sans cette
// annotation, l'opérateur qui compare sa déclaration au mois précédent verrait un chiffre inexpliqué.
test('une nuit dont la taxe est remboursée est annotée sur la ligne', async () => {
  api.getTouristTaxExtraction.mockResolvedValue({
    ...DATA,
    reservations: [{
      ...DATA.reservations[0],
      reservationName: 'Camille Durand',
      nightsCount: 2, adults: 2, taxAmount: 8.8,
      refundedTaxNights: 1, refundedTaxAmount: 4.4,
    }],
  });
  renderPage();
  expect(await screen.findByText(/dont 1 nuit remboursée \(− 4,40 €\)/)).toBeInTheDocument();
  // Le montant affiché est déjà le net à déclarer.
  expect(screen.getAllByText('8,80 €').length).toBeGreaterThan(0);
});

test('sans remboursement de taxe, aucune mention ne s’affiche', async () => {
  renderPage();
  expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
  expect(screen.queryByText(/remboursée/)).not.toBeInTheDocument();
});

// specs/tourist-tax-included-services-deduction.md rule 15 — the declaration reports the assiette the
// commune's percentage form asks for, straight from the fiche. A per-day-per-person property has no
// price in its tax at all, so the cell reads « — » rather than a misleading 0,00 €.
test('« Nuit HT / occupant » renders the percentage-mode base, and « — » without one', async () => {
  api.getTouristTaxExtraction.mockResolvedValue({
    ...DATA,
    reservations: [
      { ...DATA.reservations[0], nightPricePerOccupantHt: 45.43 },
      { ...DATA.reservations[1], nightPricePerOccupantHt: null },
    ],
  });
  renderPage();
  expect(await screen.findByRole('columnheader', { name: 'Nuit HT / occupant' })).toBeInTheDocument();
  expect(screen.getByText('45,43 €')).toBeInTheDocument();
  expect(screen.getByText('—')).toBeInTheDocument();
});
