// specs/plugins-phase-p-productisation.md rule 42 — a plugin installed from a package brings pages
// the open bundle lacks: leaving the assistant loads the app again instead of navigating inside it.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getOnboarding: vi.fn(), saveOnboardingCompany: vi.fn(), saveOnboardingProperty: vi.fn(), saveOnboardingPlugins: vi.fn(),
    saveOnboardingEmails: vi.fn(), completeOnboarding: vi.fn(), previewEmailDraft: vi.fn(), getEmailReadiness: vi.fn(),
  },
}));
const refresh = vi.fn().mockResolvedValue();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ refresh }) }));

import api from '../../api';
import OnboardingPage from '../OnboardingPage';

const PLUGINS = [
  { id: 'sas', label: 'Arrivée et départ guidés', description: 'Le sas.', allowed: true, plan: null, state: 'available', recommended: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getOnboarding.mockResolvedValue({
    open: true, company: { name: 'Les Prés', email: 'a@b.fr' }, plugins: PLUGINS, pluginsSummary: 'Aucun plugin actif',
    emails: { phone: '', senderName: '', properties: [], previewStableKey: 'arrival_reminder_1d' },
  });
  api.saveOnboardingCompany.mockResolvedValue({});
  api.saveOnboardingProperty.mockResolvedValue({ id: 1 });
  api.saveOnboardingEmails.mockResolvedValue({});
  api.previewEmailDraft.mockResolvedValue({ subject: '', body: '', sample: true });
  api.getEmailReadiness.mockResolvedValue({ items: [], soonCount: 0 });
  api.completeOnboarding.mockResolvedValue({ open: false });
});

async function reachLastStep(onFullLoad) {
  render(<MemoryRouter initialEntries={['/demarrage']}><OnboardingPage onFullLoad={onFullLoad} /></MemoryRouter>);
  const next = () => fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  await screen.findByText('Étape 1 sur 5');
  next(); await screen.findByText('Étape 2 sur 5');
  next(); await screen.findByText('Étape 3 sur 5');
  next(); await screen.findByText('Étape 4 sur 5');
  next(); await screen.findByText('Étape 5 sur 5');
}

test('rule 42: after an install that asked for it, a link of the last step loads the app at its page', async () => {
  api.saveOnboardingPlugins.mockResolvedValue({ results: [{ id: 'sas', ok: true }], pluginsSummary: '1 plugin actif', reload: true });
  const onFullLoad = vi.fn();
  await reachLastStep(onFullLoad);
  fireEvent.click(screen.getByRole('button', { name: 'Plugins : 1 plugin actif' }));
  await waitFor(() => expect(onFullLoad).toHaveBeenCalledWith('/parametres/plugins'));
  expect(api.completeOnboarding).toHaveBeenCalled();
});

test('rule 42: without a reload asked, leaving stays inside the app', async () => {
  api.saveOnboardingPlugins.mockResolvedValue({ results: [{ id: 'sas', ok: true }], pluginsSummary: '1 plugin actif', reload: false });
  const onFullLoad = vi.fn();
  await reachLastStep(onFullLoad);
  refresh.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Plugins : 1 plugin actif' }));
  await waitFor(() => expect(api.completeOnboarding).toHaveBeenCalled());
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(onFullLoad).not.toHaveBeenCalled();
});
