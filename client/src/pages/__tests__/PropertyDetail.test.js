// Behavior / non-regression tests for the PropertyDetail page itself (load → populate → save,
// dirty-reveals-actions, cancel-reverts, new-property guard, iCal create). Mocks the API, the
// router hooks, usePlatforms, and the two heavy child cards so the test exercises ONLY this page's
// own logic — the payloads it sends and the affordances it shows.

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

// Mutable router state shared with the hoisted react-router-dom mock.
const routerState = vi.hoisted(() => ({ id: 'new', navigate: () => {} }));

vi.mock('react-router-dom', async (importOriginal) => {
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
    getPropertyPlatforms: vi.fn(), setPlatformColor: vi.fn(),
    createPropertyIcalSource: vi.fn(), updatePropertyIcalSource: vi.fn(),
    deletePropertyIcalSource: vi.fn(), syncPropertyIcalSource: vi.fn(), syncAllPropertyIcalSources: vi.fn(),
    createOption: vi.fn(), updateOption: vi.fn(),
    uploadDocument: vi.fn(), deleteDocument: vi.fn(), getIcalToken: vi.fn(),
  },
}));

// specs/platforms-and-ical-rework.md — the merged per-property platform list that drives the section.
const PLATFORMS = [
  { platformKey: 'direct', platformLabel: 'Direct', color: '#c9a227', isDirect: true, isBuiltIn: true, url: '', collectsTouristTax: 1, touristTaxCollection: 'platform', disabled: 0, sourceId: null, lastSyncAt: null, lastSyncStatus: null, lastSyncMessage: null },
  { platformKey: 'airbnb', platformLabel: 'Airbnb', color: '#FF5A5F', isDirect: false, isBuiltIn: true, url: '', collectsTouristTax: 1, touristTaxCollection: 'platform', disabled: 0, sourceId: null, lastSyncAt: null, lastSyncStatus: null, lastSyncMessage: null },
];

import PropertyDetail from '../PropertyDetail';
import api from '../../api';

const PROPERTY = {
  id: 5, name: 'Le Moulin', nameArticle: 'au',
  maxAdults: 3, maxChildren: 2, maxBabies: 1,
  basePriceIncludedGuests: 2, extraGuestPrice: 15,
  singleBeds: 1, doubleBeds: 2,
  depositPercent: 30, depositDaysBefore: 30, balanceDaysBefore: 7,
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
  render(<PropertyDetail />);
  expect(await screen.findByText('Le Moulin')).toBeInTheDocument(); // name heading (read mode)
  expect(api.getProperty).toHaveBeenCalledWith('5');
  expect(screen.getByLabelText(/Caution par défaut/)).toHaveValue(500);
  expect(screen.getByLabelText(/Max adultes/)).toHaveValue(3);
  // Not dirty → Save/Cancel hidden; the destructive action is always available.
  expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Supprimer le logement' })).toBeInTheDocument();
});

// ── dirty reveals actions + save sends a FormData payload ─────────────────

test('editing a field reveals Save and persists via api.updateProperty (FormData)', async () => {
  render(<PropertyDetail />);
  await screen.findByText('Le Moulin');

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
  render(<PropertyDetail />);
  await screen.findByText('Le Moulin');

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
  render(<PropertyDetail />);

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

// ── Plateformes & iCal (specs/platforms-and-ical-rework.md) ───────────────

test('Plateformes & iCal: renders the merged platform list (built-ins incl. direct)', async () => {
  render(<PropertyDetail />);
  await screen.findByText('Le Moulin');
  await waitFor(() => expect(api.getPropertyPlatforms).toHaveBeenCalledWith('5'));

  expect(screen.getByText('Plateformes & iCal')).toBeInTheDocument();
  expect(await screen.findByText('Airbnb')).toBeInTheDocument();
  expect(screen.getByText('Direct')).toBeInTheDocument();
  // No URL set on any platform → "Synchroniser tout" is disabled.
  expect(screen.getByRole('button', { name: 'Synchroniser tout' })).toBeDisabled();
});

test('Plateformes & iCal: inline-editing a platform URL upserts the source + reloads the list', async () => {
  render(<PropertyDetail />);
  await screen.findByText('Le Moulin');
  await screen.findByText('Airbnb');

  // The Airbnb row (only non-direct platform here) → enter inline edit, set a URL, save.
  // In edit mode the URL moves to its own full-width row, labelled "URL iCal".
  fireEvent.click(screen.getByRole('button', { name: 'Modifier' }));
  fireEvent.change(screen.getByLabelText(/URL iCal/i), {
    target: { value: 'https://airbnb.test/cal.ics' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(api.createPropertyIcalSource).toHaveBeenCalledTimes(1));
  const [propId, payload] = api.createPropertyIcalSource.mock.calls[0];
  expect(propId).toBe('5');
  expect(payload.url).toBe('https://airbnb.test/cal.ics');
  expect(payload.platformKey).toBe('airbnb');
  // The platform list reloads after the upsert (initial load + reload).
  await waitFor(() => expect(api.getPropertyPlatforms).toHaveBeenCalledTimes(2));
});

test('Plateformes & iCal: the « Taxe de séjour » Select persists a 3-way mode change', async () => {
  // specs/per-platform-tourist-tax-three-way.md — a non-direct platform shows a 3-option Select;
  // choosing « Plateforme → vous » (platform_reversed) upserts the source with that value.
  render(<PropertyDetail />);
  await screen.findByText('Le Moulin');
  await screen.findByText('Airbnb');

  // Only the non-direct (Airbnb) row has the tax Select; direct shows "—".
  const select = screen.getByLabelText('Mode de collecte de la taxe de séjour');
  fireEvent.mouseDown(select);
  fireEvent.click(await screen.findByRole('option', { name: 'Plateforme → vous' }));

  await waitFor(() => expect(api.createPropertyIcalSource).toHaveBeenCalledTimes(1));
  const [, payload] = api.createPropertyIcalSource.mock.calls[0];
  expect(payload.platformKey).toBe('airbnb');
  expect(payload.touristTaxCollection).toBe('platform_reversed');
});

test('Plateformes & iCal: clicking a platform name chip opens the colour palette', async () => {
  render(<PropertyDetail />);
  await screen.findByText('Le Moulin');
  await screen.findByText('Airbnb');

  // The platform name chip is the colour trigger ("Changer la couleur"); clicking it opens the palette.
  const triggers = screen.getAllByRole('button', { name: 'Changer la couleur' });
  fireEvent.click(triggers[0]);
  expect(await screen.findByText('Couleur sur le calendrier')).toBeInTheDocument();
});

test('Plateformes & iCal: a configured DEFAULT platform cannot be deleted; a custom one can', async () => {
  // A built-in (Airbnb) and a custom (Vrbo) platform, both configured (sourceId set). Only the custom
  // one exposes the "Réinitialiser la configuration" (delete) action.
  api.getPropertyPlatforms.mockResolvedValue({
    platforms: [
      { platformKey: 'airbnb', platformLabel: 'Airbnb', color: '#FF5A5F', isDirect: false, isBuiltIn: true, url: 'https://a/c.ics', collectsTouristTax: 1, disabled: 0, sourceId: 10, lastSyncAt: null, lastSyncStatus: null, lastSyncMessage: null },
      { platformKey: 'vrbo', platformLabel: 'Vrbo', color: '#757575', isDirect: false, isBuiltIn: false, url: 'https://v/c.ics', collectsTouristTax: 1, disabled: 0, sourceId: 11, lastSyncAt: null, lastSyncStatus: null, lastSyncMessage: null },
    ],
  });
  render(<PropertyDetail />);
  await screen.findByText('Le Moulin');
  await screen.findByText('Vrbo');

  // Exactly one delete affordance — the custom platform's. The built-in (Airbnb), though configured, has none.
  const deletes = screen.queryAllByRole('button', { name: 'Réinitialiser la configuration' });
  expect(deletes).toHaveLength(1);
});
