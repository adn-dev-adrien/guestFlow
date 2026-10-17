// specs/guest-email-texts-made-simple.md rules 9–10 (and specs/plugins-phase-p-productisation.md §6) —
// the single page: one section per email in send order, variables shown by label, one save for every
// draft with the server's refusal under its field; the mentions keep their two orders.
import { vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getEmailTexts: vi.fn(), saveEmailTexts: vi.fn(), getEmailReadiness: vi.fn(), previewEmailDraft: vi.fn(),
    getEmailMentions: vi.fn(), reorderEmailMentions: vi.fn(), saveConfirmationOrder: vi.fn(),
    createEmailMention: vi.fn(), updateEmailMention: vi.fn(), deleteEmailMention: vi.fn(), getOptions: vi.fn(),
  },
}));
vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import EmailTextsSettingsPage from '../EmailTextsSettingsPage';
import { TEXTS, PREVIEW, renderAt } from './emailTextsFixtures';

const MENTIONS = [
  { id: 1, section: 'local', optionIds: [10], offerFr: 'le cidre ({{price}})', bookedFr: 'Le cidre est prêt.' },
  { id: 2, section: 'extras', optionIds: [11], offerFr: 'un plateau ({{price}})', bookedFr: 'Le plateau est prêt.' },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTexts.mockResolvedValue(TEXTS);
  api.getEmailReadiness.mockResolvedValue({ items: [], soonCount: 0 });
  api.previewEmailDraft.mockResolvedValue(PREVIEW);
  api.getEmailMentions.mockResolvedValue({ mentions: MENTIONS, confirmationOrder: [] });
  api.getOptions.mockResolvedValue([{ id: 10, title: 'Cidre' }, { id: 11, title: 'Plateau' }]);
});

test('rule 9: one section per email, in send order; the J-2 opens by default', async () => {
  renderAt(EmailTextsSettingsPage);
  const titles = await screen.findAllByText(/^\d\. /);
  expect(titles.map((t) => t.textContent)).toEqual(['1. Confirmation', '2. J-7', '3. J-2']);
  expect(screen.getByRole('button', { name: '3. J-2' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: '2. J-7' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: 'Modifier le modèle complet' })).toBeInTheDocument();
});

test('rule 9: `#j7` opens that email', async () => {
  renderAt(EmailTextsSettingsPage, '/settings/emails/textes#j7');
  expect(await screen.findByRole('button', { name: '2. J-7' })).toHaveAttribute('aria-expanded', 'true');
});

test('rule 10: a variable shows as its label, and is saved as its token', async () => {
  api.saveEmailTexts.mockResolvedValue({ applied: 1 });
  renderAt(EmailTextsSettingsPage, '/settings/emails/textes#j7');
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Produits locaux — introduction' }));
  const field = await screen.findByDisplayValue('Nous proposons ⟦Liste⟧.');
  fireEvent.change(field, { target: { value: 'Nous pouvons prévoir ⟦Liste⟧.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.saveEmailTexts).toHaveBeenCalledWith({ 'text:offers.localIntro': { fr: 'Nous pouvons prévoir {{list}}.' } }));
});

test('rule 11: the server refusal lands under its field', async () => {
  api.saveEmailTexts.mockRejectedValue(Object.assign(new Error('Variable inconnue : {{prix}}'), { key: 'text:house', field: 'fr', message: 'Variable inconnue : {{prix}}' }));
  renderAt(EmailTextsSettingsPage);
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier Dans le logement' }));
  const field = await screen.findByDisplayValue('Café offert.');
  fireEvent.change(field, { target: { value: 'Café {{prix}}' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Variable inconnue : {{prix}}', { selector: 'p' })).toBeInTheDocument();
});

test('mentions by section; the confirmation order moves on its own', async () => {
  api.saveConfirmationOrder.mockResolvedValue({ confirmationOrder: ['towels', 'babyBed', 'mention:1', 'mention:2'] });
  renderAt(EmailTextsSettingsPage);
  await screen.findByText('1. Confirmation');
  fireEvent.click(screen.getByRole('tab', { name: 'Options citées' }));
  expect(await screen.findByText('le cidre ({{price}})')).toBeInTheDocument();
  expect(screen.getByText('1. Lit bébé')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Descendre Lit bébé' }));
  await waitFor(() => expect(api.saveConfirmationOrder).toHaveBeenCalledWith(['towels', 'babyBed', 'mention:1', 'mention:2']));
  expect(await screen.findByText('1. Serviettes de toilette')).toBeInTheDocument();
  expect(api.reorderEmailMentions).not.toHaveBeenCalled();
});

test('rule 25: sentences the stored template never places are folded away', async () => {
  const sections = TEXTS.sections.map((s) => (s.id !== 'j2' ? s : {
    ...s, items: s.items.map((i) => (i.key === 'access:1' ? { ...i, used: false } : { ...i, used: true })),
  }));
  api.getEmailTexts.mockResolvedValue({ ...TEXTS, sections });
  renderAt(EmailTextsSettingsPage);
  const fold = await screen.findByText('Phrases non utilisées par le modèle (1)');
  expect(screen.getByText('Accès — Le Gîte')).not.toBeVisible();
  fireEvent.click(fold);
  await waitFor(() => expect(screen.getByText('Accès — Le Gîte')).toBeVisible());
});

test('rule 24: option and resource names lead to the translation catalogue', async () => {
  renderAt(EmailTextsSettingsPage);
  expect(await screen.findByRole('link', { name: 'Noms des options et des ressources : Traductions' })).toHaveAttribute('href', '/settings/systeme');
});

test('rule 25: on a phone each sentence is one line until tapped', async () => {
  renderAt(EmailTextsSettingsPage);
  const row = await screen.findByRole('button', { name: 'Modifier Dans le logement' });
  expect(row).toHaveTextContent('Café offert.');
  expect(screen.queryByDisplayValue('Café offert.')).toBeNull();
  expect(row).toHaveTextContent('EN manquant');
  fireEvent.click(row);
  expect(await screen.findByDisplayValue('Café offert.')).toHaveFocus();
});
