// specs/guest-email-texts-made-simple.md rule 13 — the preview always shows the latest draft: a slower
// answer to an older draft (or its refusal) never overwrites the newer one.
import { vi } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getEmailTexts: vi.fn(), saveEmailTexts: vi.fn(), getEmailReadiness: vi.fn(), previewEmailDraft: vi.fn(), sendTestEmail: vi.fn(),
  },
}));
vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import EmailTextsSettingsPage from '../EmailTextsSettingsPage';
import { TEXTS, PREVIEW, renderAt } from './emailTextsFixtures';

const IN_PREVIEW = { selector: '[data-testid="email-preview"] *' };

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTexts.mockResolvedValue(TEXTS);
  api.getEmailReadiness.mockResolvedValue({ items: [], soonCount: 0 });
  api.previewEmailDraft.mockResolvedValue(PREVIEW);
});

async function openAndEdit() {
  renderAt(EmailTextsSettingsPage);
  fireEvent.click(await screen.findByRole('button', { name: 'Voir l’email' }));
  await within(await screen.findByTestId('email-preview')).findByText(/Café offert\./);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier Dans le logement' }));
  return screen.getByDisplayValue('Café offert.');
}

async function typeOlderThenNewer(field, olderValue) {
  const older = deferred();
  api.previewEmailDraft.mockReturnValueOnce(older.promise);
  fireEvent.change(field, { target: { value: olderValue } });
  await waitFor(() => expect(api.previewEmailDraft).toHaveBeenLastCalledWith(
    expect.objectContaining({ draft: { texts: { 'text:house': { fr: olderValue } } } }),
  ), { timeout: 2000 });
  api.previewEmailDraft.mockResolvedValueOnce({ ...PREVIEW, body: 'Bonjour Camille,\n\nThé et café.' });
  fireEvent.change(field, { target: { value: 'Thé et café.' } });
  expect(await screen.findByText(/Thé et café\./, IN_PREVIEW, { timeout: 2000 })).toBeInTheDocument();
  return older;
}

const flush = () => new Promise((r) => { setTimeout(r, 50); });

test('a late answer to an older draft does not overwrite the newer preview', async () => {
  const field = await openAndEdit();
  const older = await typeOlderThenNewer(field, 'Thé.');
  older.resolve({ ...PREVIEW, body: 'Bonjour Camille,\n\nThé.' });
  await flush();
  expect(screen.getByText(/Thé et café\./, IN_PREVIEW)).toBeInTheDocument();
  expect(screen.queryByText(/^Thé\.$/, IN_PREVIEW)).not.toBeInTheDocument();
});

test('a late refusal of an older draft does not mark the newer one', async () => {
  const field = await openAndEdit();
  const older = await typeOlderThenNewer(field, '{{inconnu}}');
  older.reject(Object.assign(new Error('Variable inconnue'), { key: 'text:house', field: 'fr', unknown: 'inconnu' }));
  await flush();
  expect(screen.queryByText(/Variable inconnue/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Texte à corriger/)).not.toBeInTheDocument();
});
