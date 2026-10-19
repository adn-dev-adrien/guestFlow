// specs/plugins-phase-p-productisation.md rule 43 (UI/UX review 2026-10-18, proposal 13) — step
// « Plugins » asks three yes/no questions; each says what its « oui » turns on, the answers go to the
// server as they are, and the full list stays in Paramètres › Plugins.
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
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ refresh: vi.fn().mockResolvedValue() }) }));

import api from '../../api';
import OnboardingPage from '../OnboardingPage';

const QUESTIONS = [
  { id: 'options', label: 'Des options payantes à l’arrivée : repas, linge, bain nordique ?', answer: true, allowed: true, plan: null, hint: 'Active : Ressources à l’heure, Linge et blanchisserie, Arrivée et départ guidés.' },
  { id: 'website', label: 'Un site internet qui prend des réservations ?', answer: true, allowed: true, plan: null, hint: 'Active : Réservation depuis le site.' },
  { id: 'payment', label: 'Encaisser en ligne, par lien de paiement ?', answer: false, allowed: true, plan: null, hint: 'Active : Paiement en ligne (Qonto).' },
];

async function openStep3(questions = QUESTIONS) {
  api.getOnboarding.mockResolvedValue({
    open: true, company: { name: 'Les Cabanes', email: 'c@x.fr' }, property: { id: 1, existing: 1, draft: null }, plugins: [], questions,
  });
  api.saveOnboardingCompany.mockResolvedValue({});
  api.saveOnboardingPlugins.mockResolvedValue({ results: [], pluginsSummary: '4 plugins actifs' });
  api.getEmailReadiness.mockResolvedValue({ items: [] });
  render(<MemoryRouter initialEntries={['/demarrage']}><OnboardingPage /></MemoryRouter>);
  await screen.findByText('Étape 1 sur 5');
  while (!screen.queryByText('Étape 3 sur 5')) {
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('rule 43: three switches, each with what its « oui » turns on, no plugin list', async () => {
  await openStep3();
  expect(screen.getAllByRole('switch')).toHaveLength(3);
  expect(screen.getByRole('switch', { name: /options payantes/ })).toBeChecked();
  expect(screen.getByRole('switch', { name: /Encaisser en ligne/ })).not.toBeChecked();
  expect(screen.getByText('Active : Paiement en ligne (Qonto).')).toBeInTheDocument();
  expect(screen.getByText('Le reste se règle plus tard dans Paramètres › Plugins.')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('rule 43: the answers as given go to the server', async () => {
  await openStep3();
  fireEvent.click(screen.getByRole('switch', { name: /Encaisser en ligne/ }));
  fireEvent.click(screen.getByRole('switch', { name: /Un site internet/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  await vi.waitFor(() => expect(api.saveOnboardingPlugins).toHaveBeenCalledWith({ options: true, website: false, payment: true }));
});

test('rule 43: a settled question is shown on, disabled, says where it changes, and is not sent', async () => {
  const settled = QUESTIONS.map((q) => (q.id === 'options'
    ? { ...q, answer: true, settled: true, hint: 'Déjà en partie actif ; le reste se règle dans Paramètres › Plugins.' }
    : q));
  await openStep3(settled);
  const sw = screen.getByRole('switch', { name: /options payantes/ });
  expect(sw).toBeChecked();
  expect(sw).toBeDisabled();
  expect(screen.getByText('Déjà en partie actif ; le reste se règle dans Paramètres › Plugins.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  await vi.waitFor(() => expect(api.saveOnboardingPlugins).toHaveBeenCalledWith({ website: true, payment: false }));
});
