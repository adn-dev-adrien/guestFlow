import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// specs/neat-cancellation-insurance-subscription.md §6.1 — the « Assurance annulation (Neat) »
// Réglages card: status badge, credentials (secret 3-way), margin, discovery selects, mapping rows.

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getNeatSettings: vi.fn(),
    updateNeatSettings: vi.fn(),
    testNeatConnection: vi.fn(),
    getNeatDiscovery: vi.fn(),
    updateNeatSelection: vi.fn(),
    updateNeatMapping: vi.fn(),
  },
}));

import api from '../../api';
import DialogProvider from '../DialogProvider';
import SettingsNeatSection from '../SettingsNeatSection';

import { BASE_SETTINGS, CONFIGURED_SETTINGS } from './neatSectionFixtures';

function renderSection() {
  return render(
    <DialogProvider>
      <SettingsNeatSection />
    </DialogProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getNeatSettings.mockResolvedValue(BASE_SETTINGS);
});

test('unconfigured → « Non configurée » badge, credentials form, no discovery yet', async () => {
  renderSection();
  expect(await screen.findByText('Non configurée')).toBeInTheDocument();
  expect(screen.getByLabelText('Identifiant client (clientId)')).toBeInTheDocument();
  expect(screen.getAllByText('Secret client').length).toBeGreaterThan(0);
  expect(screen.queryByText('Charger les canaux de vente')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tester la connexion' })).toBeDisabled();
});

test('configured on staging → « Connectée — staging » badge + summary + counters', async () => {
  api.getNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  renderSection();
  expect(await screen.findByText('Connectée — staging')).toBeInTheDocument();
  expect(screen.getByText('Site direct')).toBeInTheDocument();
  expect(screen.getByText('Assurance annulation')).toBeInTheDocument();
  expect(screen.getByText('1 / 1')).toBeInTheDocument();
  expect(screen.getByText('2 en attente · 1 en échec · 4 active(s)')).toBeInTheDocument();
});

test('« Tester la connexion » surfaces the server verdict, success and failure alike', async () => {
  api.getNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  api.testNeatConnection.mockResolvedValue({ ok: true, environment: 'staging' });
  renderSection();
  await screen.findByText('Connectée — staging');
  fireEvent.click(screen.getByRole('button', { name: 'Tester la connexion' }));
  expect(await screen.findByText('Connexion Neat réussie (staging).')).toBeInTheDocument();

  api.testNeatConnection.mockRejectedValue(new Error('Connexion Neat impossible : identifiants refusés (401).'));
  fireEvent.click(screen.getByRole('button', { name: 'Tester la connexion' }));
  expect(await screen.findByText(/identifiants refusés/)).toBeInTheDocument();
});

test('the mapping table renders one row per contract field with the « requis » badge', async () => {
  api.getNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  renderSection();
  await screen.findByText('Champs du contrat Neat');
  expect(screen.getAllByText('Nombre de nuits').length).toBeGreaterThan(0);
  expect(screen.getByText("Type d'hébergement")).toBeInTheDocument();
  expect(screen.getAllByText('requis')).toHaveLength(1);
});

test('the load failure state offers a retry', async () => {
  api.getNeatSettings.mockRejectedValueOnce(new Error('down'));
  renderSection();
  expect(await screen.findByText('Impossible de charger les réglages Neat.')).toBeInTheDocument();
  api.getNeatSettings.mockResolvedValue(BASE_SETTINGS);
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Non configurée')).toBeInTheDocument();
});
