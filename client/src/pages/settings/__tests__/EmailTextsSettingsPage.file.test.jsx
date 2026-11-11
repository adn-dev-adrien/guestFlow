// specs/guest-email-texts-made-simple.md rules 16–20 — one file out, one file in with its summary
// before anything is saved (a refused row shown with its line), and the translator offered only when
// the platform has a key.
import { vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getEmailTexts: vi.fn(), saveEmailTexts: vi.fn(), getEmailReadiness: vi.fn(), previewEmailDraft: vi.fn(),
    downloadEmailTexts: vi.fn(), importEmailTexts: vi.fn(), translateEmailTexts: vi.fn(),
  },
}));
vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import EmailTextsSettingsPage from '../EmailTextsSettingsPage';
import { TEXTS, PREVIEW, renderAt } from './emailTextsFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTexts.mockResolvedValue(TEXTS);
  api.getEmailReadiness.mockResolvedValue({ items: [], soonCount: 0 });
  api.previewEmailDraft.mockResolvedValue(PREVIEW);
});

const fileOf = (text) => ({ name: 'textes.csv', arrayBuffer: () => Promise.resolve(new TextEncoder().encode(text).buffer) });

test('rule 16: « Exporter les textes » downloads the file', async () => {
  api.downloadEmailTexts.mockResolvedValue('textes-emails.csv');
  renderAt(EmailTextsSettingsPage);
  await screen.findByText('Préparation du séjour');
  fireEvent.click(screen.getByRole('button', { name: 'Exporter les textes' }));
  expect(api.downloadEmailTexts).toHaveBeenCalled();
});

test('rule 17: the summary first, a refused row with its line; the confirmation writes', async () => {
  api.importEmailTexts.mockResolvedValueOnce({
    changed: [{ line: 3, key: 'text:house', description: 'Dans le logement', fr: 'Café et thé.', frShown: 'Café et thé.', enShown: 'Coffee and tea.' }],
    refused: [{ line: 4, key: 'text:beds.made', message: 'Variable inconnue : {{prenon}}' }],
    unchanged: 40, applied: false,
  });
  api.importEmailTexts.mockResolvedValueOnce({ applied: true });
  renderAt(EmailTextsSettingsPage);
  await screen.findByText('Préparation du séjour');
  fireEvent.change(screen.getByTestId('email-texts-file'), { target: { files: [fileOf('csv')] } });
  expect(await screen.findByText('1 texte modifié, 1 refusé')).toBeInTheDocument();
  expect(screen.getByText('Variable inconnue : {{prenon}}')).toBeInTheDocument();
  // Both languages of a changed row (rule 17, 2026-10-17).
  expect(screen.getByText('Café et thé.')).toBeInTheDocument();
  expect(screen.getByText('Coffee and tea.')).toBeInTheDocument();
  expect(screen.getByText('4')).toBeInTheDocument();
  expect(api.importEmailTexts).toHaveBeenCalledWith('csv');
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer 1' }));
  await waitFor(() => expect(api.importEmailTexts).toHaveBeenLastCalledWith('csv', { confirm: true }));
});

test('rule 20: no platform key, no translate button; with it, the button translates', async () => {
  const { unmount } = renderAt(EmailTextsSettingsPage);
  await screen.findByText('Préparation du séjour');
  expect(screen.queryByRole('button', { name: 'Traduire les textes manquants' })).toBeNull();
  unmount();
  api.getEmailTexts.mockResolvedValue({ ...TEXTS, canTranslate: true });
  api.translateEmailTexts.mockResolvedValue({ translated: 3 });
  renderAt(EmailTextsSettingsPage);
  fireEvent.click(await screen.findByRole('button', { name: 'Traduire les textes manquants' }));
  await waitFor(() => expect(api.translateEmailTexts).toHaveBeenCalled());
});

test('rule 19: a translated text says « à relire » until confirmed', async () => {
  const sections = TEXTS.sections.map((s) => ({ ...s, items: s.items.map((i) => (i.key === 'text:house' ? { ...i, en: 'Coffee on us.', autoTranslated: true } : i)) }));
  api.getEmailTexts.mockResolvedValue({ ...TEXTS, sections });
  renderAt(EmailTextsSettingsPage);
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Dans le logement' }));
  expect(await screen.findByText('Traduit automatiquement, à relire')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Relu' })).toBeInTheDocument();
});
