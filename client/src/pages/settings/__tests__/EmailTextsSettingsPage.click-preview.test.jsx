// specs/guest-email-texts-made-simple.md rules 37 and 41 (UI/UX review 2026-10-18, decisions 5 and 13) —
// a sentence of the email opens its field (beside it on a computer, in a sheet on a phone); a refused
// variable leaves the last email in place and says where to fix it.
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

const TAGGED = {
  ...PREVIEW,
  subjectKey: 'subject:arrival_reminder_1d',
  segments: [{ text: 'Bonjour Camille,\n\n', key: null }, { text: 'Café offert.', key: 'text:house' }],
};

// The whole page renders on a computer: jsdom takes its time.
const SLOW = { timeout: 5000 };
vi.setConfig({ testTimeout: 15000 });

const realMatchMedia = window.matchMedia;
function asDesktop(on) {
  window.matchMedia = on
    ? (query) => ({ matches: !/reduce/.test(query), media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } })
    : realMatchMedia;
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  api.getEmailTexts.mockResolvedValue(TEXTS);
  api.getEmailReadiness.mockResolvedValue({ items: [], soonCount: 0 });
  api.previewEmailDraft.mockResolvedValue(TAGGED);
});
afterEach(() => asDesktop(false));

test('on a computer, a click on a sentence focuses its field', async () => {
  asDesktop(true);
  renderAt(EmailTextsSettingsPage);
  const sentence = await screen.findByRole('button', { name: 'Modifier : Café offert.' }, SLOW);
  fireEvent.click(sentence);
  const field = await screen.findByLabelText('Dans le logement — français');
  await waitFor(() => expect(field).toHaveFocus());
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  expect(sentence).toHaveAttribute('data-active', 'true');
});

test('on a phone, a tap opens the sentence in a sheet over the email', async () => {
  renderAt(EmailTextsSettingsPage);
  fireEvent.click(await screen.findByRole('button', { name: 'Voir l’email' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier : Café offert.' }, SLOW));
  const sheet = await screen.findByRole('presentation');
  expect(within(sheet).getByDisplayValue('Café offert.')).toHaveFocus();
  fireEvent.click(within(sheet).getByRole('button', { name: 'OK' }));
  await waitFor(() => expect(screen.queryByRole('presentation')).toBeNull());
});

test('the subject is a sentence too', async () => {
  asDesktop(true);
  renderAt(EmailTextsSettingsPage);
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier : objet' }, SLOW));
  await waitFor(() => expect(document.getElementById('subject:arrival_reminder_1d-fr')).toHaveFocus());
});

test('rule 37: a refused variable is said under its field with the fix; the email stays', async () => {
  asDesktop(true);
  renderAt(EmailTextsSettingsPage);
  await screen.findByRole('button', { name: 'Modifier : Café offert.' }, SLOW);
  api.previewEmailDraft.mockRejectedValue(Object.assign(new Error('Variable inconnue : {{prenon}}'), {
    key: 'text:house', field: 'fr', message: 'Variable inconnue : {{prenon}}', unknown: 'prenon',
    suggestion: { name: 'clientFirstName', label: 'Prénom du voyageur' },
  }));
  fireEvent.change(screen.getByLabelText('Dans le logement — français'), { target: { value: 'Café {{prenon}}' } });
  expect(await screen.findByText('Variable inconnue : ⟦prenon⟧')).toBeInTheDocument();
  expect(screen.getByText('Prénom du voyageur ?')).toBeInTheDocument();
  expect(screen.getByText('Texte à corriger : l’aperçu montre le dernier texte valide.')).toBeInTheDocument();
  expect(screen.getByTestId('email-preview')).toHaveTextContent('Café offert.');
  api.previewEmailDraft.mockResolvedValue(TAGGED);
  fireEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
  await waitFor(() => expect(screen.getByLabelText('Dans le logement — français')).toHaveValue('Café {{clientFirstName}}'));
});
