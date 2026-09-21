// PropertyDetail — the tabs (specs/settings-rationalization.md rules 21, 23a): the tab lives in
// `?tab=`, a tab holding an unsaved change shows an amber dot, a field refused by the server shows
// its message, lights its tab in red and brings that tab forward.

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const routerState = vi.hoisted(() => ({ id: '5', navigate: () => {} }));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useParams: () => ({ id: routerState.id }), useNavigate: () => routerState.navigate };
});
vi.mock('../../components/IcalExportCard', () => ({ default: () => null }));
vi.mock('../../api', () => ({
  default: {
    getProperty: vi.fn(), getOptions: vi.fn(), updateProperty: vi.fn(), createProperty: vi.fn(), deleteProperty: vi.fn(),
    getPropertyPlatforms: vi.fn(), getPlatformSettings: vi.fn(), createOption: vi.fn(), updateOption: vi.fn(),
  },
}));

import DialogProvider from '../../components/DialogProvider';
import PropertyDetail from '../PropertyDetail';
import api from '../../api';

const PROPERTY = {
  id: 5, name: 'Le Moulin', nameArticle: 'au', maxGuests: 3, maxBabies: 1, basePriceIncludedGuests: 2,
  extraGuestPrice: 15, singleBeds: 1, doubleBeds: 2, depositPercent: 30, depositDueDays: 7,
  balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7, defaultCautionAmount: 500,
  touristTaxMode: 'per_day_per_person', touristTaxPerDayPerPerson: 1.2, defaultCheckIn: '15:00',
  defaultCheckOut: '10:00', cleaningHours: 3, pricingRules: [], documents: [], photo: null,
};

const renderAt = (url = '/properties/5') => render(
  <MemoryRouter initialEntries={[url]}><DialogProvider><PropertyDetail /></DialogProvider></MemoryRouter>,
);

beforeEach(() => {
  vi.clearAllMocks();
  api.getOptions.mockResolvedValue([]);
  api.getProperty.mockResolvedValue({ ...PROPERTY });
  api.getPropertyPlatforms.mockResolvedValue({ platforms: [] });
  api.getPlatformSettings.mockResolvedValue({ platforms: [] });
});

test('the six tabs are there, and ?tab= opens the matching one', async () => {
  renderAt('/properties/5?tab=paiement');
  expect(await screen.findByLabelText(/Caution par défaut/)).toHaveValue(500);
  for (const label of ['Général', 'Tarifs', 'Paiement & caution', 'Séjour', 'Plateformes & iCal', 'Documents']) {
    expect(screen.getByRole('tab', { name: new RegExp(label) })).toBeInTheDocument();
  }
  expect(screen.getByRole('tab', { name: /Paiement/ })).toHaveAttribute('aria-selected', 'true');
});

test('an unsaved change lights its tab in amber, and only that tab', async () => {
  renderAt();
  await screen.findByDisplayValue('Le Moulin');
  fireEvent.change(screen.getByLabelText(/Max bébés/), { target: { value: '2' } });
  expect(screen.getByRole('tab', { name: /Général/ })).toContainElement(screen.getByLabelText('modifié'));
  expect(screen.getByRole('tab', { name: /Tarifs/ }).querySelector('[aria-label]')).toBeNull();
});

test('a field refused by the server shows its message and brings its tab forward, in red', async () => {
  api.updateProperty.mockRejectedValue(Object.assign(new Error('PROPERTY_INVALID'), {
    errors: { defaultCautionAmount: 'Un montant ≥ 0 €.' },
  }));
  renderAt();
  await screen.findByDisplayValue('Le Moulin');
  fireEvent.change(screen.getByLabelText(/Max bébés/), { target: { value: '2' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));

  expect(await screen.findByText('Un montant ≥ 0 €.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('tab', { name: /Paiement/ })).toHaveAttribute('aria-selected', 'true'));
  expect(screen.getByRole('tab', { name: /Paiement/ })).toContainElement(screen.getByLabelText('erreur'));
});

test('with a tariff recipe, the extra-guest price is read-only and each season shows its own', async () => {
  api.getProperty.mockResolvedValue({
    ...PROPERTY,
    tariffRecipeId: 'aventura-lodge-2026',
    pricingRules: [{ id: 1, label: 'Haute', startDate: '2027-07-01', endDate: '2027-08-31', pricePerNight: 247, minNights: 1, extraGuestPrice: 15 }],
  });
  renderAt('/properties/5?tab=tarifs');
  expect(await screen.findByText(/Fixé par la recette/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/Supplément par personne/)).toBeNull();
  expect(screen.getByText('Voyageur suppl.')).toBeInTheDocument();
});

test('without a recipe, the extra-guest fields stay editable', async () => {
  renderAt('/properties/5?tab=tarifs');
  expect(await screen.findByLabelText(/Supplément par personne/)).toHaveValue(15);
  expect(screen.getByText('Saisons saisies à la main.')).toBeInTheDocument();
});
