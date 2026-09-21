// Behavior / non-regression tests for the PropertyDetail page itself (load → populate → save,
// dirty-reveals-actions, cancel-reverts, new-property guard). The page is split into tabs
// (specs/settings-rationalization.md rule 21): the tabs have their own suites
// (PropertyDetail.tabs, components/property/__tests__/*). Mocks the API, the
// router hooks, usePlatforms, and the two heavy child cards so the test exercises ONLY this page's
// own logic — the payloads it sends and the affordances it shows.

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

// Mutable router state shared with the hoisted react-router mock.
const routerState = vi.hoisted(() => ({ id: 'new', navigate: () => {} }));

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

// specs/platforms-and-ical-rework.md — the merged per-property platform list that drives the section.
const PLATFORMS = [
  { platformKey: 'direct', platformLabel: 'Direct', color: '#c9a227', isDirect: true, isDirectChannel: true, isBuiltIn: true, url: '', collectsTouristTax: 1, touristTaxCollection: 'platform', payoutDueDays: 10, disabled: 0, sourceId: null, lastSyncAt: null, lastSyncStatus: null, lastSyncMessage: null },
  { platformKey: 'airbnb', platformLabel: 'Airbnb', color: '#FF5A5F', isDirect: false, isDirectChannel: false, isBuiltIn: true, url: '', collectsTouristTax: 1, touristTaxCollection: 'platform', payoutDueDays: 10, disabled: 0, sourceId: null, lastSyncAt: null, lastSyncStatus: null, lastSyncMessage: null },
];

import DialogProvider from '../../components/DialogProvider';
import PropertyDetail from '../PropertyDetail';
import api from '../../api';

const renderPage = () => render(
  <MemoryRouter><DialogProvider><PropertyDetail /></DialogProvider></MemoryRouter>,
);
const openTab = (label) => fireEvent.click(screen.getByRole('tab', { name: new RegExp(label) }));

const PROPERTY = {
  id: 5, name: 'Le Moulin', nameArticle: 'au',
  maxGuests: 3, maxBabies: 1,
  basePriceIncludedGuests: 2, extraGuestPrice: 15,
  singleBeds: 1, doubleBeds: 2,
  depositPercent: 30, depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7,
  defaultCautionAmount: 500,
  touristTaxPerDayPerPerson: 0, touristTaxMode: 'per_day_per_person',
  touristTaxPercentage: 0, touristTaxDepartmentPercentage: 0, touristTaxFixedAmount: 0,
  defaultCheckIn: '15:00', defaultCheckOut: '10:00', cleaningHours: 3,
  pricingRules: [], documents: [], icalSources: [], photo: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  routerState.id = '5';
  routerState.navigate = vi.fn();
  api.getOptions.mockResolvedValue([]);
  api.getProperty.mockResolvedValue({ ...PROPERTY });
  api.updateProperty.mockResolvedValue({ ...PROPERTY });
  api.createProperty.mockResolvedValue({ id: 9 });
  api.createPropertyIcalSource.mockResolvedValue({});
  api.getPropertyPlatforms.mockResolvedValue({ platforms: PLATFORMS.map((p) => ({ ...p })) });
  api.setPlatformColor.mockResolvedValue({});
});

// ── load → populate ──────────────────────────────────────────────────────

test('existing property: loads via api.getProperty and populates the form', async () => {
  renderPage();
  expect(await screen.findByDisplayValue('Le Moulin')).toBeInTheDocument(); // name field value (first form field)
  expect(api.getProperty).toHaveBeenCalledWith('5');
  // specs/property-capacity-single-total.md — one total instead of adultes/enfants buckets.
  expect(screen.getByLabelText(/Max voyageurs/)).toHaveValue(3);
  expect(screen.getByLabelText(/Max bébés/)).toHaveValue(1);
  expect(screen.queryByLabelText(/Max adultes/)).toBeNull();
  expect(screen.queryByLabelText(/Max enfants/)).toBeNull();
  // specs/payment-schedule-and-cancellation.md §3 — the schedule is driven by three per-property
  // delays: the acompte counts from the BOOKING, the solde from the arrival, the cancellation from
  // the solde deadline. This fixture has the « Acompte » switch OFF, so only the last two are on
  // screen — the switch and what it reveals live in PropertyDetail.deposit-switch.test.jsx.
  openTab('Paiement');
  expect(screen.getByLabelText(/Caution par défaut/)).toHaveValue(500);
  expect(screen.getByLabelText(/jours avant l'arrivée/)).toHaveValue(30);
  expect(screen.getByLabelText(/Annulation \(jours après échéance du solde\)/)).toHaveValue(7);
  expect(screen.queryByLabelText(/Acompte \(jours avant\)/)).toBeNull();
  // Not dirty → Save/Cancel hidden; the destructive action is always available.
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Supprimer le logement' })).toBeInTheDocument();
});

// ── dirty reveals actions + save sends a FormData payload ─────────────────

test('editing a field reveals Save and persists via api.updateProperty (FormData)', async () => {
  renderPage();
  await screen.findByDisplayValue('Le Moulin');

  openTab('Paiement');
  fireEvent.change(screen.getByLabelText(/Caution par défaut/), { target: { value: '750' } });
  const saveBtn = await screen.findByRole('button', { name: 'Enregistrer' });
  fireEvent.click(saveBtn);

  await waitFor(() => expect(api.updateProperty).toHaveBeenCalledTimes(1));
  const [calledId, fd] = api.updateProperty.mock.calls[0];
  expect(calledId).toBe('5');
  expect(fd).toBeInstanceOf(FormData);
  expect(fd.get('defaultCautionAmount')).toBe('750');
  expect(fd.get('name')).toBe('Le Moulin'); // unchanged fields ride along
});

test('Cancel reverts the edits and clears the dirty actions', async () => {
  renderPage();
  await screen.findByDisplayValue('Le Moulin');

  openTab('Paiement');
  const caution = screen.getByLabelText(/Caution par défaut/);
  fireEvent.change(caution, { target: { value: '750' } });
  expect(caution).toHaveValue(750);

  fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
  expect(screen.getByLabelText(/Caution par défaut/)).toHaveValue(500);
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  expect(api.updateProperty).not.toHaveBeenCalled();
});

// ── new-property guard ───────────────────────────────────────────────────

test('new property: Create is disabled until a name is set, then posts a FormData + navigates', async () => {
  routerState.id = 'new';
  renderPage();

  const createBtn = screen.getByRole('button', { name: 'Créer le logement' });
  expect(createBtn).toBeDisabled();
  expect(api.getProperty).not.toHaveBeenCalled(); // new mode never loads

  fireEvent.change(screen.getByLabelText('Nom du logement'), { target: { value: 'La Cabane' } });
  expect(createBtn).toBeEnabled();
  fireEvent.click(createBtn);

  await waitFor(() => expect(api.createProperty).toHaveBeenCalledTimes(1));
  const fd = api.createProperty.mock.calls[0][0];
  expect(fd).toBeInstanceOf(FormData);
  expect(fd.get('name')).toBe('La Cabane');
  await waitFor(() => expect(routerState.navigate).toHaveBeenCalledWith('/properties/9', { replace: true }));
});
