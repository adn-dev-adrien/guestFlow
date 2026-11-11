// specs/plugins-phase-p-productisation.md rules 37–38 — step « Plugins » names each plugin left out
// with the server's reason; the last step prints the server's « N plugins actifs »; the price is
// required on step 2; the fourth step is titled « Emails ».
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  { id: 'website-booking', label: 'Réservation depuis le site', description: 'Le moteur.', allowed: true, plan: null, state: 'available', recommended: true },
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

const renderPage = () => render(<MemoryRouter initialEntries={['/demarrage']}><OnboardingPage /></MemoryRouter>);
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));

test('rule 38: the price per night is marked required', async () => {
  renderPage();
  await screen.findByText('Étape 1 sur 5');
  next();
  await screen.findByText('Étape 2 sur 5');
  expect(screen.getByLabelText(/Prix par nuit/)).toBeRequired();
});

test('rule 37: a plugin left out is named with its reason, and the step stays open', async () => {
  api.saveOnboardingPlugins.mockResolvedValue({
    results: [{ id: 'website-booking', ok: true }, { id: 'sas', ok: false, error: 'UPDATE_IN_PROGRESS', reason: 'activation en cours, réessayer dans un instant' }],
    pluginsSummary: '1 plugin actif',
  });
  renderPage();
  await screen.findByText('Étape 1 sur 5');
  next(); await screen.findByText('Étape 2 sur 5');
  next(); await screen.findByText('Étape 3 sur 5');
  next();
  expect(await screen.findByText('Non activé : Arrivée et départ guidés (activation en cours, réessayer dans un instant)')).toBeInTheDocument();
  expect(screen.getByText('Étape 3 sur 5')).toBeInTheDocument();
});

test('rule 38: step 4 is « Emails », and the last step prints the server’s plural', async () => {
  api.saveOnboardingPlugins.mockResolvedValue({ results: [{ id: 'website-booking', ok: true }, { id: 'sas', ok: true }], pluginsSummary: '2 plugins actifs' });
  renderPage();
  await screen.findByText('Étape 1 sur 5');
  next(); await screen.findByText('Étape 2 sur 5');
  next(); await screen.findByText('Étape 3 sur 5');
  next(); await screen.findByText('Étape 4 sur 5');
  expect(screen.getByRole('heading', { name: 'Emails' })).toBeInTheDocument();
  next(); await screen.findByText('Étape 5 sur 5');
  expect(screen.getByRole('button', { name: 'Plugins : 2 plugins actifs' })).toBeInTheDocument();
});
