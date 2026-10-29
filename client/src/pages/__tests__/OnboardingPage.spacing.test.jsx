// specs/plugins-phase-p-productisation.md rule 47 (§3.D, 2026-10-27 audit) — the start assistant reserved an
// empty helper line under every field, so the gaps varied with the stack, the grid and the hints.
// No blank helper is drawn now: a message shows when there is one.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getOnboarding: vi.fn(), saveOnboardingCompany: vi.fn(), saveOnboardingProperty: vi.fn(),
    saveOnboardingPlugins: vi.fn(), completeOnboarding: vi.fn(), getOnboardingDefaultCapacity: vi.fn(),
  },
}));
const refresh = vi.fn().mockResolvedValue();
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ refresh }) }));

import api from '../../api';
import OnboardingPage from '../OnboardingPage';

beforeEach(() => {
  vi.clearAllMocks();
  api.getOnboarding.mockResolvedValue({ open: true, company: { name: '', email: '' }, plugins: [], questions: [] });
});

test('step 1 draws no blank helper line; the SIRET hint and a refusal still show', async () => {
  api.saveOnboardingCompany.mockRejectedValueOnce(Object.assign(new Error('x'), { errors: { email: 'Adresse obligatoire' } }));
  const { container } = render(<MemoryRouter initialEntries={['/demarrage']}><OnboardingPage /></MemoryRouter>);
  await screen.findByText('Étape 1 sur 5');
  const helpers = [...container.querySelectorAll('.MuiFormHelperText-root')].map((h) => h.textContent.trim());
  expect(helpers).toEqual(['14 chiffres']);
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  expect(await screen.findByText('Adresse obligatoire')).toBeInTheDocument();
});
