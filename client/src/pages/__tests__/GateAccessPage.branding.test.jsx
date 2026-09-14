// specs/gate-access-portier.md §3.5 — the tab « Application des clients »: the source of the app's logo,
// the upload constraints refused before anything is sent, and the warning about installed iPhones.
import { vi, beforeEach, afterEach, test, expect } from 'vitest';
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getPortierAccesses: vi.fn(),
    getPortierBranding: vi.fn(),
    setPortierBrandingSource: vi.fn(),
  },
}));

import api from '../../api';
import { LIST, renderGateAccessPage } from './gateAccessPageFixtures';

const BRANDING = { source: 'guestflow', syncLabel: 'Logo de Réglages › Société, envoyé à Portier le 12/09 à 18:03.', customLabel: '' };
const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

beforeEach(() => {
  vi.clearAllMocks();
  api.getPortierAccesses.mockResolvedValue(LIST);
  api.getPortierBranding.mockResolvedValue({ branding: BRANDING });
  URL.createObjectURL = vi.fn(() => 'blob:logo');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  URL.createObjectURL = original.create;
  URL.revokeObjectURL = original.revoke;
});

async function openTab(user) {
  renderGateAccessPage();
  await user.click(await screen.findByRole('tab', { name: 'Application des clients' }));
  await screen.findByText(BRANDING.syncLabel);
}

const fileInput = () => screen.getByLabelText('Logo personnalisé', { selector: 'input[type="file"]' });

test('the tab shows the synchronised source and warns that an installed iPhone icon does not change', async () => {
  const user = userEvent.setup();
  await openTab(user);
  expect(screen.getByLabelText('Logo de guestFlow (synchronisé)')).toBeChecked();
  expect(screen.getByText(/Un iPhone qui a déjà installé l'application garde l'ancienne icône/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Choisir un fichier' })).toHaveAttribute('aria-disabled', 'true');
});

test('a custom logo is refused before sending when its type or size is wrong', async () => {
  const user = userEvent.setup();
  await openTab(user);
  await user.click(screen.getByRole('radio', { name: 'Logo personnalisé' }));

  fireEvent.change(fileInput(), { target: { files: [new File(['GIF89a'], 'logo.gif', { type: 'image/gif' })] } });
  expect(screen.getByText('Refusé : PNG, SVG ou JPEG seulement.')).toBeInTheDocument();

  const big = new File(['x'], 'logo.png', { type: 'image/png' });
  Object.defineProperty(big, 'size', { value: 2 * 1024 * 1024 + 1 });
  fireEvent.change(fileInput(), { target: { files: [big] } });
  expect(screen.getByText('Refusé : 2 Mo au plus.')).toBeInTheDocument();
  expect(api.setPortierBrandingSource).not.toHaveBeenCalled();
});

test('an SVG logo is sent to Portier with its source', async () => {
  const user = userEvent.setup();
  api.setPortierBrandingSource.mockResolvedValue({ branding: { ...BRANDING, source: 'custom', customLabel: 'Logo personnalisé enregistré le 14/09 à 10:00.' } });
  await openTab(user);
  await user.click(screen.getByRole('radio', { name: 'Logo personnalisé' }));
  const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.svg', { type: 'image/svg+xml' });
  fireEvent.change(fileInput(), { target: { files: [svg] } });
  expect(screen.getByAltText('Aperçu du logo')).toHaveAttribute('src', 'blob:logo');

  await user.click(screen.getByRole('button', { name: 'Enregistrer le logo' }));
  await waitFor(() => expect(api.setPortierBrandingSource).toHaveBeenCalledTimes(1));
  const form = api.setPortierBrandingSource.mock.calls[0][0];
  expect(form.get('source')).toBe('custom');
  expect(form.get('logo').name).toBe('logo.svg');
  expect(await screen.findByText('Logo personnalisé enregistré le 14/09 à 10:00.')).toBeInTheDocument();
});
