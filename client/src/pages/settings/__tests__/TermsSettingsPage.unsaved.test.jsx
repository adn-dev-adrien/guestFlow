// specs/ui-review-2026-10-19-operations.md rule 42 — the CGV draft is guarded like any other form: leaving asks, a saved
// draft does not, and the guard waits for the page to know what is stored.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getTerms: vi.fn(), saveTermsDraft: vi.fn(), previewTerms: vi.fn(), publishTerms: vi.fn(), getTermsVersion: vi.fn() },
}));
vi.mock('../../../hooks/useAuth', () => ({ __esModule: true, useAuth: () => ({ user: { roles: ['admin'], enabledPlugins: [] } }) }));
vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import TermsSettingsPage from '../TermsSettingsPage';

const overview = (draft = { fr: '## Conditions', en: '## Terms', updatedAt: '2026-09-22T08:00:00Z' }) => ({
  draft,
  current: null,
  nextVersion: 1,
  canPublish: true,
  publishBlockedReason: null,
  staleVariables: [],
  unknownVariables: [],
  variables: [],
  versions: [],
});

beforeEach(() => {
  Object.values(api).forEach((m) => m.mockReset());
  api.getTerms.mockResolvedValue(overview());
  api.previewTerms.mockResolvedValue({ html: { fr: '', en: '' }, unknownVariables: [] });
  api.saveTermsDraft.mockImplementation(async (d) => overview({ ...d, updatedAt: 'x' }));
});
afterEach(() => { delete window.__guestflowBeforeNavigate; });

const openPage = async () => {
  render(<MemoryRouter><TermsSettingsPage /></MemoryRouter>);
  return screen.findByLabelText('Texte en français (Markdown)');
};

test('rule 42: a clean draft leaves freely', async () => {
  await openPage();
  await waitFor(() => expect(screen.getByLabelText('Texte en français (Markdown)')).toHaveValue('## Conditions'));
  expect(window.__guestflowBeforeNavigate).toBeUndefined();
});

test('rule 42: an edited draft asks before leaving, staying keeps the text', async () => {
  const field = await openPage();
  fireEvent.change(field, { target: { value: '## Autre' } });
  await waitFor(() => expect(typeof window.__guestflowBeforeNavigate).toBe('function'));
  expect(window.__guestflowBeforeNavigate('/clients')).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Rester sur la page' }));
  expect(screen.getByLabelText('Texte en français (Markdown)')).toHaveValue('## Autre');
});

test('rule 42: « Enregistrer et quitter » saves the draft first', async () => {
  const field = await openPage();
  fireEvent.change(field, { target: { value: '## Autre' } });
  await waitFor(() => expect(typeof window.__guestflowBeforeNavigate).toBe('function'));
  window.__guestflowBeforeNavigate('/clients');
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer et quitter' }));
  await waitFor(() => expect(api.saveTermsDraft).toHaveBeenCalledWith(expect.objectContaining({ fr: '## Autre' })));
});

test('rule 42: a saved draft holds no guard any more', async () => {
  const field = await openPage();
  fireEvent.change(field, { target: { value: '## Autre' } });
  await waitFor(() => expect(typeof window.__guestflowBeforeNavigate).toBe('function'));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
  await waitFor(() => expect(window.__guestflowBeforeNavigate).toBeUndefined());
});
