/**
 * specs/plugins-phase-3a-online-payment.md rule 15 — the public site's address is saved from the CGV
 * page; the server validates it and its refusal shows under the field.
 */
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({ __esModule: true, default: { saveTermsPublicSiteOrigin: vi.fn() } }));
vi.mock('../DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../api';
import PublicSiteOriginCard from '../PublicSiteOriginCard';

beforeEach(() => vi.clearAllMocks());

test('saves the address and hands the overview back', async () => {
  const onSaved = vi.fn();
  api.saveTermsPublicSiteOrigin.mockResolvedValue({ publicSiteOrigin: 'https://www.domainesolio.com' });
  render(<PublicSiteOriginCard value="" onSaved={onSaved} />);
  const button = screen.getByRole('button', { name: 'Enregistrer l’adresse' });
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Adresse du site public'), 'https://www.domainesolio.com/');
  await userEvent.click(button);
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ publicSiteOrigin: 'https://www.domainesolio.com' }));
  expect(api.saveTermsPublicSiteOrigin).toHaveBeenCalledWith('https://www.domainesolio.com/');
});

test('shows the server refusal under the field', async () => {
  api.saveTermsPublicSiteOrigin.mockRejectedValue(new Error('Adresse invalide : le domaine seul, par exemple https://www.mon-site.fr'));
  render(<PublicSiteOriginCard value="" onSaved={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('Adresse du site public'), 'https://x.fr/page');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer l’adresse' }));
  expect(await screen.findByText(/Adresse invalide/)).toBeInTheDocument();
});
