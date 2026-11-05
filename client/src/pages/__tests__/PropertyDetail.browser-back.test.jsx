// specs/ui-review-2026-10-19-operations.md rules 26, 40, 43 — the browser « Retour » of a dirty logement with a real
// BrowserRouter, and an unknown logement that says so rather than offering a retry.
import { screen, fireEvent, waitFor } from '@testing-library/react';
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

import api from '../../api';
import installBackGuard from '../../utils/backGuard';
import { renderApp, openDirty, resetLogementMocks, clearLeaveGuards } from './propertyDetailGuardFixtures';

installBackGuard();

beforeEach(resetLogementMocks);
afterEach(clearLeaveGuards);

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

test('rule 40: the slot follows the router: Back after the page moved stays on where it moved to', async () => {
  await openDirty();
  fireEvent.click(screen.getByRole('tab', { name: /Tarifs/ }));
  await waitFor(() => expect(window.location.search).toBe('?tab=tarifs'));
  window.history.back();
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(window.location.search).toBe('?tab=tarifs');
});
