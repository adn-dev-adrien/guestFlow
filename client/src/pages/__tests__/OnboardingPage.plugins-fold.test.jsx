// specs/plugins-phase-p-productisation.md rule 36 — step « Plugins » shows the recommended and active
// plugins; the others are folded under « Pour aller plus loin (N) », closed at first.
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

const PLUGINS = [
  { id: 'sas', label: 'Arrivée et départ guidés', description: 'Le sas.', allowed: true, plan: null, state: 'available', recommended: true, more: false },
  { id: 'weather', label: 'Vigilance Météo-France', description: 'Météo.', allowed: true, plan: null, state: 'active', recommended: false, more: false },
  { id: 'neat', label: 'Assurance annulation Neat', description: 'Assurance.', allowed: true, plan: null, state: 'available', recommended: false, more: true },
  { id: 'gate-access', label: 'Accès portail', description: 'Portail.', allowed: true, plan: null, state: 'available', recommended: false, more: true },
];

test('rule 36: the extra plugins are folded, then shown on demand', async () => {
  api.getOnboarding.mockResolvedValue({ open: true, company: { name: 'Les Cabanes', email: 'c@x.fr' }, property: { id: 1, existing: 1, draft: null }, plugins: PLUGINS });
  api.saveOnboardingCompany.mockResolvedValue({});
  api.saveOnboardingProperty.mockResolvedValue({ id: 1 });
  render(<MemoryRouter initialEntries={['/demarrage']}><OnboardingPage /></MemoryRouter>);
  await screen.findByText('Étape 1 sur 5');
  while (!screen.queryByText('Étape 3 sur 5')) {
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(screen.getByRole('checkbox', { name: /Arrivée et départ guidés/ })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Vigilance Météo-France/ })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /Assurance annulation Neat/ })).toBeNull();
  const fold = screen.getByRole('button', { name: 'Pour aller plus loin (2)' });
  expect(fold).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(fold);
  expect(await screen.findByRole('checkbox', { name: /Assurance annulation Neat/ })).toBeInTheDocument();
});
