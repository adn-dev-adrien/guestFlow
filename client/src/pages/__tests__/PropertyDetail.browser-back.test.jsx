// specs/ui-review-2026-10-19-operations.md rules 26, 40, 43 — the browser « Retour » of a dirty logement with a real
// BrowserRouter, and an unknown logement that says so rather than offering a retry.
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../components/IcalExportCard', () => ({ default: () => null }));
vi.mock('../../api', () => ({
  default: {
    getArticleLabels: vi.fn(() => Promise.resolve({ labels: [] })),
    getProperty: vi.fn(), getPropertyLimits: vi.fn(), getOptions: vi.fn(), getPropertyArrivalFacts: vi.fn(), savePropertyArrivalFacts: vi.fn(),
    updateProperty: vi.fn(), createProperty: vi.fn(), deleteProperty: vi.fn(),
    getPropertyPlatforms: vi.fn(), getPlatformSettings: vi.fn(), createOption: vi.fn(), updateOption: vi.fn(),
  },
}));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));

import DialogProvider from '../../components/DialogProvider';
import PropertyDetail from '../PropertyDetail';
import api from '../../api';
import installBackGuard from '../../utils/backGuard';
import { LIMITS } from '../../components/property/__tests__/propertyLimitsFixtures';

installBackGuard();

const PROPERTY = {
  id: 5, name: 'Le Moulin', nameArticle: 'au', maxGuests: 3, maxBabies: 1, singleBeds: 1, doubleBeds: 2,
  depositPercent: 30, depositDueDays: 7, balanceDaysBefore: 30, cancelAfterBalanceDueDays: 7, defaultCautionAmount: 0,
  defaultCheckIn: '15:00', defaultCheckOut: '10:00', cleaningHours: 3, pricingRules: [], documents: [], photo: null,
  pendingFacts: '', cleaningIncluded: 1, towelsProvided: 1, poolSeasonStart: '', poolSeasonEnd: '',
};
const FACTS = { address: '', mapUrl: '', accessFr: '', accessEn: '', wifiName: 'Moulin', hasAccessCode: false, hasWifiPassword: false };

function renderApp() {
  window.history.replaceState(null, '', '/prev');
  render(
    <BrowserRouter>
      <DialogProvider>
        <Link to="/properties/5?tab=sejour">vers le logement</Link>
        <Routes>
          <Route path="/prev" element={<p>page précédente</p>} />
          <Route path="/properties" element={<p>liste des logements</p>} />
          <Route path="/properties/:id" element={<PropertyDetail />} />
        </Routes>
      </DialogProvider>
    </BrowserRouter>,
  );
  fireEvent.click(screen.getByText('vers le logement'));
}

async function openDirty() {
  renderApp();
  const wifi = await screen.findByLabelText('Réseau Wi-Fi');
  await waitFor(() => expect(wifi).toHaveValue('Moulin'));
  fireEvent.change(wifi, { target: { value: 'Autre' } });
  await waitFor(() => expect(typeof window.__guestflowBeforeBack).toBe('function'));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getPropertyLimits.mockResolvedValue(LIMITS);
  api.getOptions.mockResolvedValue([]);
  api.getProperty.mockResolvedValue({ ...PROPERTY });
  api.getPropertyArrivalFacts.mockResolvedValue({ ...FACTS });
  api.savePropertyArrivalFacts.mockResolvedValue({ ...FACTS, wifiName: 'Autre' });
  api.updateProperty.mockResolvedValue({});
  api.getPropertyPlatforms.mockResolvedValue({ platforms: [] });
  api.getPlatformSettings.mockResolvedValue({ platforms: [] });
});
afterEach(() => {
  delete window.__guestflowBeforeBack;
  window.history.replaceState(null, '', '/');
});

test('rule 40: Back on a dirty logement asks, keeps the edit, the URL and the entry state', async () => {
  await openDirty();
  const { idx } = window.history.state;
  window.history.back();
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/properties/5');
  expect(window.location.search).toBe('?tab=sejour');
  expect(screen.getByLabelText('Réseau Wi-Fi')).toHaveValue('Autre');
  expect(window.history.state.idx).toBe(idx);
});

test('rule 40: « Rester » keeps editing, a second Back asks again', async () => {
  await openDirty();
  window.history.back();
  fireEvent.click(await screen.findByRole('button', { name: 'Rester sur la page' }));
  await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).toBeNull());
  window.history.back();
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(screen.getByLabelText('Réseau Wi-Fi')).toHaveValue('Autre');
});

test('rule 40: « Quitter sans enregistrer » performs the back', async () => {
  await openDirty();
  window.history.back();
  fireEvent.click(await screen.findByRole('button', { name: 'Quitter sans enregistrer' }));
  expect(await screen.findByText('page précédente')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/prev');
});

test('rule 40: « Enregistrer et quitter » saves, then performs the back', async () => {
  await openDirty();
  window.history.back();
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer et quitter' }));
  expect(await screen.findByText('page précédente')).toBeInTheDocument();
  expect(api.savePropertyArrivalFacts).toHaveBeenCalled();
});

test('rule 43: an unknown logement says so, with the way back to the list and no retry', async () => {
  api.getProperty.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
  renderApp();
  expect(await screen.findByText('Logement introuvable.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Réessayer/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retour aux logements' }));
  expect(await screen.findByText('liste des logements')).toBeInTheDocument();
});

test('rule 43: any other failure stays a load failure with its retry', async () => {
  api.getProperty.mockRejectedValue(Object.assign(new Error('Connexion au serveur impossible.'), { code: 'NETWORK' }));
  renderApp();
  expect(await screen.findByText('Impossible de charger le logement.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Réessayer/ })).toBeInTheDocument();
});
