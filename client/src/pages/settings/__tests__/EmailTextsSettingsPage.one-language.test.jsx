// specs/guest-email-texts-made-simple.md rule 42 (UI/UX review 2026-10-18, decision 10) — one language at
// a time: FR | EN at the top of the texts, the server's « N à traduire », the French as a reference
// above each English field, the count following what is typed.
import { vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

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

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTexts.mockResolvedValue(TEXTS);
  api.getEmailReadiness.mockResolvedValue({ items: [], soonCount: 0 });
  api.previewEmailDraft.mockResolvedValue({ ...PREVIEW, toTranslate: 1 });
});

test('the server’s count sits beside FR | EN', async () => {
  renderAt(EmailTextsSettingsPage);
  expect(await screen.findByText('1 à traduire')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'FR' })).toHaveAttribute('aria-pressed', 'true');
});

test('French only by default; in English the French reads above the English field', async () => {
  renderAt(EmailTextsSettingsPage);
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Dans le logement' }));
  expect(await screen.findByLabelText('Dans le logement — français')).toHaveValue('Café offert.');
  expect(screen.queryByLabelText('Dans le logement — anglais')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(await screen.findByLabelText('Dans le logement — anglais')).toHaveValue('');
  expect(screen.getByTestId('french-reference')).toHaveTextContent('Café offert.');
  expect(screen.getAllByText('À traduire').length).toBeGreaterThan(0);
  await waitFor(() => expect(api.previewEmailDraft).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'en' })));
});

test('the count follows the draft as the server counts it', async () => {
  renderAt(EmailTextsSettingsPage);
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Dans le logement' }));
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  api.previewEmailDraft.mockResolvedValue({ ...PREVIEW, toTranslate: 0 });
  fireEvent.change(await screen.findByLabelText('Dans le logement — anglais'), { target: { value: 'Coffee on us.' } });
  expect(await screen.findByText('Anglais complet')).toBeInTheDocument();
  await waitFor(() => expect(api.previewEmailDraft).toHaveBeenLastCalledWith(expect.objectContaining({ draft: { texts: { 'text:house': { en: 'Coffee on us.' } } } })));
});
