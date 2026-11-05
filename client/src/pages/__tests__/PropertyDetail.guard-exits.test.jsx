// specs/ui-review-2026-10-19-operations.md rule 42, reading of 2026-11-05 — a logement's « Enregistrer et quitter » leaves only
// after a successful save, and « Ouvrir la gestion tarifaire » is a way out like any other.
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

const leaveAndSave = async () => {
  fireEvent.click(screen.getByText('vers les clients'));
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer et quitter' }));
};

test('a save that succeeds leaves', async () => {
  await openDirty();
  await leaveAndSave();
  expect(await screen.findByText('liste des clients')).toBeInTheDocument();
  expect(api.savePropertyArrivalFacts).toHaveBeenCalled();
});

test('a refused field stays on the page, the draft kept', async () => {
  api.savePropertyArrivalFacts.mockRejectedValue(Object.assign(new Error('refus'), { errors: { wifiName: 'Trop long' } }));
  await openDirty();
  await leaveAndSave();
  await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).toBeNull());
  expect(screen.queryByText('liste des clients')).toBeNull();
  expect(window.location.pathname).toBe('/properties/5');
  expect(screen.getByLabelText('Réseau Wi-Fi')).toHaveValue('Autre');
});

test('a failed save stays too', async () => {
  api.savePropertyArrivalFacts.mockRejectedValue(new Error('Connexion au serveur impossible.'));
  await openDirty();
  await leaveAndSave();
  await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).toBeNull());
  expect(window.location.pathname).toBe('/properties/5');
});

test('a blank name stays and says so', async () => {
  renderApp();
  fireEvent.click(await screen.findByRole('tab', { name: /Général|Infos|Informations/ }));
  const name = await screen.findByLabelText(/^Nom/);
  await waitFor(() => expect(name).toHaveValue('Le Moulin'));
  fireEvent.change(name, { target: { value: '  ' } });
  await waitFor(() => expect(typeof window.__guestflowBeforeNavigate).toBe('function'));
  await leaveAndSave();
  expect(await screen.findByText('Le nom est obligatoire.')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/properties/5');
  expect(api.updateProperty).not.toHaveBeenCalled();
});

test('« Ouvrir la gestion tarifaire » asks on a dirty logement', async () => {
  await openDirty();
  fireEvent.click(screen.getByRole('tab', { name: /Tarifs/ }));
  fireEvent.click(await screen.findByRole('button', { name: /gestion tarifaire/i }));
  expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument();
  expect(window.location.pathname).toBe('/properties/5');
  fireEvent.click(screen.getByRole('button', { name: 'Quitter sans enregistrer' }));
  expect(await screen.findByText('gestion tarifaire')).toBeInTheDocument();
});
