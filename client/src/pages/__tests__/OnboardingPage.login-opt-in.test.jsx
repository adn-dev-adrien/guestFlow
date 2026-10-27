// specs/hosting-h2-account-security.md rule 37 (audit 2026-10-27) — saving « Entreprise » never changes
// the login e-mail implicitly: an explicit « Utiliser aussi cette adresse pour se connecter », off by
// default and offered only over the bootstrap login, decides it.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getOnboarding: vi.fn(), saveOnboardingCompany: vi.fn(), saveOnboardingProperty: vi.fn(), saveOnboardingPlugins: vi.fn(),
    saveOnboardingEmails: vi.fn(), completeOnboarding: vi.fn(), getEmailReadiness: vi.fn(),
  },
}));
const refresh = vi.fn().mockResolvedValue();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ refresh }) }));

import api from '../../api';
import OnboardingPage from '../OnboardingPage';

const BOX = 'Utiliser aussi cette adresse pour se connecter';

function onboarding(canAdopt) {
  api.getOnboarding.mockResolvedValue({
    open: true, company: { name: 'Les Cabanes', email: 'contact@cabanes.fr' }, property: { id: null, existing: 0, draft: null },
    plugins: [], login: { email: 'admin@guestflow.local', canAdopt },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.saveOnboardingCompany.mockResolvedValue({ loginChanged: false });
});

const start = async () => {
  render(<MemoryRouter initialEntries={['/demarrage']}><OnboardingPage /></MemoryRouter>);
  await screen.findByText('Étape 1 sur 5');
};
const next = () => fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));

test('rule 37: the box is offered over the bootstrap login, unticked; untouched, the login is kept', async () => {
  onboarding(true);
  await start();
  expect(screen.getByLabelText(BOX)).not.toBeChecked();
  next();
  await waitFor(() => expect(api.saveOnboardingCompany).toHaveBeenCalled());
  expect(api.saveOnboardingCompany.mock.calls[0][0].useAsLogin).toBe(false);
});

test('rule 37: ticked, the step asks the server to make it the login', async () => {
  onboarding(true);
  api.saveOnboardingCompany.mockResolvedValue({ loginEmail: 'contact@cabanes.fr', loginChanged: true });
  await start();
  fireEvent.click(screen.getByLabelText(BOX));
  next();
  await waitFor(() => expect(api.saveOnboardingCompany).toHaveBeenCalled());
  expect(api.saveOnboardingCompany.mock.calls[0][0].useAsLogin).toBe(true);
  expect(await screen.findByText('Connexion désormais avec contact@cabanes.fr.')).toBeInTheDocument();
});

test('rule 37: a login the owner chose is not offered to change', async () => {
  onboarding(false);
  await start();
  expect(screen.queryByLabelText(BOX)).not.toBeInTheDocument();
});
