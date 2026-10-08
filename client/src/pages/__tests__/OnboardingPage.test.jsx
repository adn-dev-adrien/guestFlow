// specs/plugins-phase-p-productisation.md §3.D rules 20–23 — the start assistant: four steps, the
// server's refusal kept on its step, a failed plugin named, « Plus tard », the mobile layout.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getOnboarding: vi.fn(), saveOnboardingCompany: vi.fn(), saveOnboardingProperty: vi.fn(),
    saveOnboardingPlugins: vi.fn(), completeOnboarding: vi.fn(),
  },
}));
const refresh = vi.fn().mockResolvedValue();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ refresh }) }));

import api from '../../api';
import OnboardingPage from '../OnboardingPage';

const PLUGINS = [
  { id: 'website-booking', label: 'Réservation depuis le site', description: 'Le moteur.', allowed: true, plan: null, state: 'available', recommended: true },
  { id: 'sas', label: 'Arrivée et départ guidés', description: 'Le sas.', allowed: true, plan: null, state: 'available', recommended: true },
  { id: 'neat', label: 'Assurance annulation Neat', description: 'Assurance.', allowed: false, plan: 'Forfait Premium', state: 'available', recommended: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getOnboarding.mockResolvedValue({ open: true, company: { name: '', email: '' }, plugins: PLUGINS });
  api.completeOnboarding.mockResolvedValue({ open: false });
});

const renderPage = () => render(<MemoryRouter initialEntries={['/demarrage']}><OnboardingPage /></MemoryRouter>);
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));

test('a refusal keeps the step open with its messages; a valid step moves on', async () => {
  api.saveOnboardingCompany.mockRejectedValueOnce(Object.assign(new Error('x'), { errors: { name: 'Nom obligatoire', email: 'Adresse obligatoire' } }));
  renderPage();
  await screen.findByText('Étape 1 sur 4');
  next();
  expect(await screen.findByText('Nom obligatoire')).toBeInTheDocument();
  expect(screen.getByText('Étape 1 sur 4')).toBeInTheDocument();
  api.saveOnboardingCompany.mockResolvedValueOnce({});
  fireEvent.change(screen.getByLabelText(/Nom de l’entreprise/), { target: { value: 'Les Tilleuls' } });
  next();
  expect(await screen.findByText('Étape 2 sur 4')).toBeInTheDocument();
});

test('step 2: the capacity follows the beds until typed; step 3: the recommended plugins are ticked, a failure is named', async () => {
  api.saveOnboardingCompany.mockResolvedValue({});
  api.saveOnboardingProperty.mockResolvedValue({ id: 1 });
  api.saveOnboardingPlugins.mockResolvedValue({ results: [{ id: 'website-booking', ok: false, error: 'PLUGIN_MIGRATION_FAILED' }, { id: 'sas', ok: true }] });
  renderPage();
  await screen.findByText('Étape 1 sur 4');
  next();
  await screen.findByText('Étape 2 sur 4');
  fireEvent.change(screen.getByLabelText('Lits doubles'), { target: { value: '2' } });
  expect(screen.getByLabelText('Capacité')).toHaveValue(4);
  fireEvent.change(screen.getByLabelText('Lits simples'), { target: { value: '1' } });
  expect(screen.getByLabelText('Capacité')).toHaveValue(5);
  next();
  await screen.findByText('Étape 3 sur 4');
  expect(api.saveOnboardingProperty.mock.calls[0][0]).toMatchObject({ doubleBeds: '2', singleBeds: '1', maxGuests: '5' });
  expect(screen.getByRole('checkbox', { name: /Réservation depuis le site/ })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: /Assurance annulation Neat/ })).toBeDisabled();
  expect(screen.getByText('Forfait Premium')).toBeInTheDocument();
  next();
  expect(await screen.findByText('Non activé : Réservation depuis le site')).toBeInTheDocument();
  expect(api.saveOnboardingPlugins).toHaveBeenCalledWith(['website-booking', 'sas']);
  expect(screen.getByText('Étape 3 sur 4')).toBeInTheDocument();
});

test('« Plus tard » closes the assistant', async () => {
  renderPage();
  await screen.findByText('Étape 1 sur 4');
  fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
  await waitFor(() => expect(api.completeOnboarding).toHaveBeenCalled());
  expect(refresh).toHaveBeenCalled();
});

test('mobile: the primary action is full width', async () => {
  window.innerWidth = 375;
  renderPage();
  await screen.findByText('Étape 1 sur 4');
  const button = screen.getByRole('button', { name: 'Suivant' });
  expect(button.className).toMatch(/MuiButton/);
  expect(getComputedStyle(button).minHeight).toBe('44px');
});
