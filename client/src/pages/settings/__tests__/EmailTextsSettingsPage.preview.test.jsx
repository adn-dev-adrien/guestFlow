// specs/guest-email-texts-made-simple.md rules 13–15 — beside the texts, the email the server renders
// from the draft: on the next stay or « Exemple », FR/EN with the English gap said, and a test sent
// to oneself.
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

// jsdom has no media queries: the page lays out as on a phone, where the email opens under its section.
async function showPreview() {
  fireEvent.click(await screen.findByRole('button', { name: 'Voir l’email' }));
  return screen.findByTestId('email-preview');
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTexts.mockResolvedValue(TEXTS);
  api.getEmailReadiness.mockResolvedValue({ items: [], soonCount: 0 });
  api.previewEmailDraft.mockResolvedValue(PREVIEW);
});

test('rule 13: the preview is the server rendering of the draft being typed', async () => {
  renderAt(EmailTextsSettingsPage);
  expect(await within(await showPreview()).findByText(/Café offert\./)).toBeInTheDocument();
  expect(api.previewEmailDraft).toHaveBeenLastCalledWith(expect.objectContaining({ templateId: 2, language: 'fr', draft: { texts: {} } }));
  api.previewEmailDraft.mockResolvedValue({ ...PREVIEW, body: 'Bonjour Camille,\n\nThé et café.' });
  fireEvent.change(screen.getByDisplayValue('Café offert.'), { target: { value: 'Thé et café.' } });
  expect(await screen.findByText(/Thé et café\./, { selector: '[data-testid="email-preview"] *' })).toBeInTheDocument();
  expect(api.previewEmailDraft).toHaveBeenLastCalledWith(expect.objectContaining({ draft: { texts: { 'text:house': { fr: 'Thé et café.' } } } }));
});

test('rule 13: another stay, or « Exemple », from the selector', async () => {
  renderAt(EmailTextsSettingsPage);
  await within(await showPreview()).findByText(/Café offert\./);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Réservation' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Exemple' }));
  await waitFor(() => expect(api.previewEmailDraft).toHaveBeenLastCalledWith(expect.objectContaining({ reservationId: 'sample' })), { timeout: 2000 });
});

test('rule 14: English on the toggle, the gap said by the server', async () => {
  renderAt(EmailTextsSettingsPage);
  await showPreview();
  api.previewEmailDraft.mockResolvedValue({ ...PREVIEW, lang: 'en', englishNotice: 'Texte anglais manquant : le français sera envoyé' });
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(await screen.findByText('Texte anglais manquant : le français sera envoyé')).toBeInTheDocument();
  expect(api.previewEmailDraft).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'en' }));
});

test('rule 15: « M’envoyer un test » sends the previewed draft and says where', async () => {
  api.sendTestEmail.mockResolvedValue({ ok: true, to: 'contact@lespres.fr' });
  renderAt(EmailTextsSettingsPage);
  await showPreview();
  fireEvent.click(screen.getByRole('button', { name: 'M’envoyer un test' }));
  expect(await screen.findByText('Envoyé à contact@lespres.fr')).toBeInTheDocument();
  expect(api.sendTestEmail).toHaveBeenCalledWith(expect.objectContaining({ templateId: 2 }));
  api.sendTestEmail.mockRejectedValue(new Error('SMTP non configuré : Paramètres › Emails'));
  fireEvent.click(screen.getByRole('button', { name: 'M’envoyer un test' }));
  expect(await screen.findByText('SMTP non configuré : Paramètres › Emails')).toBeInTheDocument();
});
