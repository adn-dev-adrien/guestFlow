// Rule 50 — the paiement tab shows a loading state, or an error with a retry, while the limits load.
// specs/settings-input-guards.md rule 8 — the payment tab waits for the server's limits: a loading state
// while they come, an error with a retry when they do not (never a blank tab).

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
    getArticleLabels: vi.fn(() => Promise.resolve({ labels: [] })),
    getProperty: vi.fn(), getPropertyLimits: vi.fn(), getOptions: vi.fn(),
    // The « Arrivée » block is part of the page (specs/guest-email-texts-made-simple.md rule 35).
    getPropertyArrivalFacts: vi.fn(() => Promise.resolve({ address: "", mapUrl: "", accessFr: "", accessEn: "", wifiName: "", hasAccessCode: false, hasWifiPassword: false })),
    savePropertyArrivalFacts: vi.fn(() => Promise.resolve({})),
    createProperty: vi.fn(), updateProperty: vi.fn(), deleteProperty: vi.fn(),
    getPropertyPlatforms: vi.fn(), setPlatformColor: vi.fn(),
    createPropertyIcalSource: vi.fn(), updatePropertyIcalSource: vi.fn(),
    deletePropertyIcalSource: vi.fn(), syncPropertyIcalSource: vi.fn(), syncAllPropertyIcalSources: vi.fn(),
    createOption: vi.fn(), updateOption: vi.fn(),
    uploadDocument: vi.fn(), deleteDocument: vi.fn(), getIcalToken: vi.fn(),
  },
}));

import DialogProvider from '../../components/DialogProvider';
import PropertyDetail from '../PropertyDetail';
import api from '../../api';
import { LIMITS } from '../../components/property/__tests__/propertyLimitsFixtures';

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


const base = { id: 5, name: 'Le Moulin', nameArticle: 'au', maxGuests: 3, maxBabies: 1, singleBeds: 1, doubleBeds: 2, depositPercent: 30, depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7, depositEnabled: 1, pricingRules: [], documents: [], icalSources: [], photo: null };
const open = async () => {
  api.getProperty.mockResolvedValue(base);
  render(<MemoryRouter><DialogProvider><PropertyDetail /></DialogProvider></MemoryRouter>);
  await screen.findByDisplayValue('Le Moulin');
  fireEvent.click(screen.getByRole('tab', { name: /Paiement/ }));
};

test('rule 8: while the limits load the tab shows a loading state, then the fields', async () => {
  let resolve;
  api.getPropertyLimits.mockReturnValue(new Promise((r) => { resolve = r; }));
  await open();
  expect(screen.getByText('Chargement…')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Acompte \(jours après réservation\)/)).toBeNull();
  resolve(LIMITS);
  expect(await screen.findByLabelText(/Acompte \(jours après réservation\)/)).toBeInTheDocument();
});

test('rule 8: when the limits fail the tab says so and « Réessayer » loads them', async () => {
  api.getPropertyLimits.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(LIMITS);
  await open();
  expect(await screen.findByText('Impossible de charger les réglages de paiement.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByLabelText(/Acompte \(jours après réservation\)/)).toBeInTheDocument();
});
