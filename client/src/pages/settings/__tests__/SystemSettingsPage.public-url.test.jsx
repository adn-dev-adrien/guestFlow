/**
 * SystemSettingsPage — the hosting's address as the public URL's default
 * (specs/hosting-h1-fleet-runtime.md rule 25). A hosted instance gets `GUESTFLOW_PUBLIC_URL` from the
 * console (server `smtp.derived.publicUrl`): the empty field shows it and says it is the default; a
 * self-hosted instance without it keeps the plain hint.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getSettings: vi.fn(), updateSettings: vi.fn() },
}));

vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return {
    __esModule: true,
    useToast: () => stableToast,
    useAppDialogs: () => ({ confirm: vi.fn().mockResolvedValue(true), alert: vi.fn().mockResolvedValue() }),
  };
});
vi.mock('../../../components/SettingsSystemUpdateSection', () => ({ __esModule: true, default: () => null }));
vi.mock('../../../components/TranslationCatalogueCard', () => ({ __esModule: true, default: () => null }));

import api from '../../../api';
import SystemSettingsPage from '../SystemSettingsPage';

const payload = (derived) => ({ smtp: { publicUrl: '', derived }, updatedAtLabel: 'aujourd’hui' });

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
});

test('rule 25 — the hosting’s address is the empty field’s default', async () => {
  api.getSettings.mockResolvedValue(payload({ publicUrl: 'https://aulnes.guestflow.fr' }));
  render(<MemoryRouter><SystemSettingsPage /></MemoryRouter>);
  expect(await screen.findByText('Par défaut : https://aulnes.guestflow.fr.')).toBeInTheDocument();
  expect(screen.getByLabelText('URL publique')).toHaveAttribute('placeholder', 'https://aulnes.guestflow.fr');
});

test('rule 25 — without a hosting address the plain hint stays', async () => {
  api.getSettings.mockResolvedValue(payload({ publicUrl: '' }));
  render(<MemoryRouter><SystemSettingsPage /></MemoryRouter>);
  expect(await screen.findByText(/Adresse de cet espace, utilisée dans les liens des emails/)).toBeInTheDocument();
});
