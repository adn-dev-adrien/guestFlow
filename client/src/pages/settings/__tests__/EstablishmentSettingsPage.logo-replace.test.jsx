// specs/settings.md rule 18 (audit R25-C4, 2026-11-06) — a replaced logo shows at once: the server keeps the same path for a
// file of the same format, so the preview asks for the new bytes; the saved logo path stays the plain one.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getSettings: vi.fn(), updateSettings: vi.fn(), uploadCompanyLogo: vi.fn(), deleteCompanyLogo: vi.fn() },
}));
vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return {
    __esModule: true,
    useToast: () => stableToast,
    useAppDialogs: () => ({ confirm: vi.fn().mockResolvedValue(true), alert: vi.fn().mockResolvedValue() }),
  };
});
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => false, usePlugins: () => ({ plugins: [], isActive: () => false }) }));
vi.mock('../../../utils/setFavicon', () => ({ setFavicon: vi.fn() }));

import api from '../../../api';
import EstablishmentSettingsPage from '../EstablishmentSettingsPage';

const LOGO = '/uploads/company-logo.png';

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.getSettings.mockResolvedValue({ company: { name: 'Gîte', logoPath: LOGO }, quote: {} });
  api.uploadCompanyLogo.mockResolvedValue({ company: { logoPath: LOGO } });
});

const pick = (container, name) => fireEvent.change(container.querySelector('input[type="file"]'), {
  target: { files: [new File(['x'], name, { type: 'image/png' })] },
});

test('rule 18 — two uploads under the same path each show their own image', async () => {
  const { container } = render(<MemoryRouter><EstablishmentSettingsPage /></MemoryRouter>);
  const first = await screen.findByAltText('Logo');
  expect(first.getAttribute('src')).toBe(LOGO);
  pick(container, 'rouge.png');
  await waitFor(() => expect(screen.getByAltText('Logo').getAttribute('src')).not.toBe(LOGO));
  const afterFirst = screen.getByAltText('Logo').getAttribute('src');
  expect(afterFirst.startsWith(`${LOGO}?v=`)).toBe(true);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Remplacer le logo' })).toBeEnabled());
  await new Promise((resolve) => { setTimeout(resolve, 5); });
  pick(container, 'bleu.png');
  await waitFor(() => expect(api.uploadCompanyLogo).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByAltText('Logo').getAttribute('src')).not.toBe(afterFirst));
  expect(screen.getByRole('button', { name: /Enregistrer/ })).toBeDisabled();
});
