/**
 * EmailTemplatesPage — the J-7 hook per property is edited in the J-7 template dialog
 * (specs/settings-rationalization.md rule 17c), not on the property page any more.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(),
    createEmailTemplate: vi.fn(),
    updateEmailTemplate: vi.fn(),
    deleteEmailTemplate: vi.fn(),
    getPendingEmails: vi.fn(),
    acknowledgePendingEmail: vi.fn(),
    previewEmail: vi.fn(),
    sendEmail: vi.fn(),
    getPropertyEmailHooks: vi.fn(),
    savePropertyEmailHooks: vi.fn(),
  },
}));

vi.mock('../../components/DialogProvider', () => {
  // Stable identities, like the real provider (its context value is memoized) — a fresh object per
  // render would re-trigger useCallback/useEffect chains that depend on the toast fns.
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  const stableDialogs = {
    confirm: vi.fn().mockResolvedValue(true),
    alert: vi.fn().mockResolvedValue(),
  };
  return {
    __esModule: true,
    useAppDialogs: () => stableDialogs,
    useToast: () => stableToast,
  };
});

const navigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigate };
});

import api from '../../api';
import EmailTemplatesPage from '../EmailTemplatesPage';

const REGISTRY_ROW = {
  id: 1, stableKey: 'arrival_reminder_7d',
  name: 'Rappel arrivée — J-7', subject: 'S', body: 'B',
  dayOffset: -7, sendMode: 'manual', enabled: 1,
};

const CUSTOM_ROW = {
  id: 2, stableKey: null,
  name: 'Bienvenue', subject: 'S2', body: 'B2',
  dayOffset: 0, sendMode: 'auto', enabled: 1,
};

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  navigate.mockReset();
  api.getEmailTemplates.mockResolvedValue([REGISTRY_ROW, CUSTOM_ROW]);
  api.getPendingEmails.mockResolvedValue([]); // queue empty by default
  api.previewEmail.mockResolvedValue({ to: 'jane@s.com', subject: 'Sujet', body: 'Corps', missingVariables: [] });
  api.getPropertyEmailHooks.mockResolvedValue([
    { propertyId: 1, name: 'La Granja', emailHook: 'Le soleil se lève sur la vallée.', emailHookEn: '' },
    { propertyId: 2, name: "L'Estiva", emailHook: '', emailHookEn: '' },
  ]);
  api.updateEmailTemplate.mockResolvedValue({});
  api.savePropertyEmailHooks.mockResolvedValue([]);
});

function renderPage() {
  return render(<MemoryRouter><EmailTemplatesPage /></MemoryRouter>);
}

test('the J-7 dialog lists every property with its FR / EN hook', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByText('Rappel arrivée — J-7'));
  expect(await screen.findByText('Accroche par logement')).toBeInTheDocument();
  expect(screen.getByLabelText('Accroche La Granja (français)')).toHaveValue('Le soleil se lève sur la vallée.');
  expect(screen.getByLabelText("Accroche L'Estiva (anglais)")).toHaveValue('');
});

test('saving the template writes the hooks only when one changed', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByText('Rappel arrivée — J-7'));
  const estiva = await screen.findByLabelText("Accroche L'Estiva (français)");
  await user.click(estiva);
  await user.paste('La forêt commence au pas de la porte.');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));

  await waitFor(() => expect(api.savePropertyEmailHooks).toHaveBeenCalledTimes(1));
  expect(api.savePropertyEmailHooks.mock.calls[0][0]).toEqual([
    { propertyId: 1, emailHook: 'Le soleil se lève sur la vallée.', emailHookEn: '' },
    { propertyId: 2, emailHook: 'La forêt commence au pas de la porte.', emailHookEn: '' },
  ]);
});

test('another template has no hook block and never loads them', async () => {
  const user = userEvent.setup();
  renderPage();
  await user.click(await screen.findByText('Bienvenue'));
  await screen.findByLabelText(/Nom du modèle/);
  expect(screen.queryByText('Accroche par logement')).toBeNull();
  expect(api.getPropertyEmailHooks).not.toHaveBeenCalled();
});
