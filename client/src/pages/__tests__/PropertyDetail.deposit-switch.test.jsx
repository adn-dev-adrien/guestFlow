// specs/property-deposit-switch.md rules 9-13 — the « Acompte & Solde » card splits in two (rule 9):
// « Acompte » opens on its switch and reveals its two settings only when ON (rule 10), while
// « Paiement & Caution » stays visible whatever the switch (rule 11) and says what « Solde (jours
// avant) » means without an acompte (rule 12). Showing and hiding is local UI state only — the form
// keeps sending what it holds (rule 13).

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const routerState = vi.hoisted(() => ({ id: '5', navigate: () => {} }));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useParams: () => ({ id: routerState.id }),
    useNavigate: () => routerState.navigate,
    useLocation: () => ({ search: '' }),
  };
});
vi.mock('../../components/IcalExportCard', () => ({ default: () => null }));
vi.mock('../../components/PropertyDefaultOptionsCard', () => ({ default: () => null }));
vi.mock('../../api', () => ({
  default: {
    getProperty: vi.fn(), getOptions: vi.fn(),
    createProperty: vi.fn(), updateProperty: vi.fn(), deleteProperty: vi.fn(),
    getPropertyPlatforms: vi.fn(), setPlatformColor: vi.fn(), setPlatformTouristTax: vi.fn(),
    setPlatformPayoutDueDays: vi.fn(),
    createPropertyIcalSource: vi.fn(), updatePropertyIcalSource: vi.fn(),
    deletePropertyIcalSource: vi.fn(), syncPropertyIcalSource: vi.fn(), syncAllPropertyIcalSources: vi.fn(),
    createOption: vi.fn(), updateOption: vi.fn(),
    uploadDocument: vi.fn(), deleteDocument: vi.fn(), getIcalToken: vi.fn(),
  },
}));

import DialogProvider from '../../components/DialogProvider';
import PropertyDetail from '../PropertyDetail';
import api from '../../api';

const property = (depositEnabled) => ({
  id: 5, name: 'Le Moulin', nameArticle: 'au',
  maxGuests: 3, maxBabies: 1,
  basePriceIncludedGuests: 2, extraGuestPrice: 15,
  singleBeds: 1, doubleBeds: 2,
  depositPercent: 30, depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7,
  depositEnabled,
  defaultCautionAmount: 500,
  touristTaxPerDayPerPerson: 0, touristTaxMode: 'per_day_per_person',
  touristTaxPercentage: 0, touristTaxDepartmentPercentage: 0, touristTaxFixedAmount: 0,
  defaultCheckIn: '15:00', defaultCheckOut: '10:00', cleaningHours: 3,
  pricingRules: [], documents: [], icalSources: [], photo: null,
});

const renderWith = async (depositEnabled) => {
  api.getProperty.mockResolvedValue(property(depositEnabled));
  render(<DialogProvider><PropertyDetail /></DialogProvider>);
  await screen.findByDisplayValue('Le Moulin');
};

// Rule 11 — the three settings of « Paiement & Caution », plus the wording of rule 12.
const alwaysThere = () => {
  expect(screen.getByLabelText(/Solde \(jours avant\)/)).toHaveValue(30);
  expect(screen.getByLabelText(/Annulation \(jours après échéance du solde\)/)).toHaveValue(7);
  expect(screen.getByLabelText(/Caution par défaut/)).toHaveValue(500);
  expect(screen.getByText(/ou du paiement unique quand l'acompte est désactivé/)).toBeInTheDocument();
};

beforeEach(() => {
  vi.clearAllMocks();
  routerState.id = '5';
  routerState.navigate = vi.fn();
  api.getOptions.mockResolvedValue([]);
  api.updateProperty.mockResolvedValue(property(0));
  api.getPropertyPlatforms.mockResolvedValue({ platforms: [] });
});

// Rules 9-10 — the card exists, and OFF it holds the switch and nothing else.
test('switch OFF: the acompte card holds nothing but the switch and its caption', async () => {
  await renderWith(0);
  expect(screen.getByText('Paiement & Caution')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Acompte' })).not.toBeChecked();
  expect(screen.getByText(/payé en une fois/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/% acompte/)).toBeNull();
  expect(screen.queryByLabelText(/Acompte \(jours après réservation\)/)).toBeNull();
  alwaysThere();
});

// Rule 10 — ON reveals the two settings that only mean something with an acompte.
test('switch ON: the two acompte settings appear, the rest stays put', async () => {
  await renderWith(1);
  expect(screen.getByRole('switch', { name: 'Acompte' })).toBeChecked();
  expect(screen.getByText(/payé en deux fois/)).toBeInTheDocument();
  expect(screen.getByLabelText(/% acompte/)).toHaveValue(30);
  expect(screen.getByLabelText(/Acompte \(jours après réservation\)/)).toHaveValue(7);
  alwaysThere();
});

// Rule 13 — the reveal is local UI state: the form keeps its values and keeps sending them, so the
// server stays the only thing that decides what a hidden acompte setting is worth.
test('flipping the switch reveals the fields and saves depositEnabled', async () => {
  await renderWith(0);
  fireEvent.click(screen.getByRole('switch', { name: 'Acompte' }));

  expect(await screen.findByLabelText(/% acompte/)).toHaveValue(30);
  expect(screen.getByText(/payé en deux fois/)).toBeInTheDocument();

  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateProperty).toHaveBeenCalledTimes(1));
  const [, fd] = api.updateProperty.mock.calls[0];
  expect(fd.get('depositEnabled')).toBe('true');
  expect(fd.get('publicDepositEnabled')).toBeNull();
});

test('a hidden acompte setting is still carried by the payload — nothing is dropped (rule 13)', async () => {
  await renderWith(0);
  fireEvent.change(screen.getByLabelText(/Caution par défaut/), { target: { value: '750' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(api.updateProperty).toHaveBeenCalledTimes(1));
  const [, fd] = api.updateProperty.mock.calls[0];
  expect(fd.get('depositEnabled')).toBe('false');
  expect(fd.get('depositPercent')).toBe('30');
  expect(fd.get('depositDueDays')).toBe('7');
});
