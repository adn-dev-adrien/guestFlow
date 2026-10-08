// specs/plugins-phase-p-productisation.md §6 — « Textes des mails »: the texts by email with the
// server's refusal under its field, the mentions with their two orders, the server-rendered preview.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getStayTexts: vi.fn(), saveStayText: vi.fn(), resetStayText: vi.fn(),
    getEmailMentions: vi.fn(), reorderEmailMentions: vi.fn(), saveConfirmationOrder: vi.fn(),
    createEmailMention: vi.fn(), updateEmailMention: vi.fn(), deleteEmailMention: vi.fn(), previewEmailMentions: vi.fn(),
    getOptions: vi.fn(), getProperties: vi.fn(),
  },
}));
vi.mock('../../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../../api';
import EmailTextsSettingsPage from '../EmailTextsSettingsPage';

const TEXTS = [
  { key: 'offers.localIntro', email: 'J-7', label: 'Produits locaux — introduction', tokens: ['list'], flags: [], fr: 'Nous proposons {{list}}.', en: 'We offer {{list}}.', isDefault: true },
  { key: 'house', email: 'J-2', label: 'Dans le logement', tokens: [], flags: [], fr: '', en: '', isDefault: true },
];
const MENTIONS = [
  { id: 1, section: 'local', optionIds: [10], offerFr: 'le cidre ({{price}})', bookedFr: 'Le cidre est prêt.' },
  { id: 2, section: 'extras', optionIds: [11], offerFr: 'un plateau ({{price}})', bookedFr: 'Le plateau est prêt.' },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getStayTexts.mockResolvedValue({ texts: TEXTS });
  api.getEmailMentions.mockResolvedValue({ mentions: MENTIONS, confirmationOrder: [] });
  api.getOptions.mockResolvedValue([{ id: 10, title: 'Cidre' }, { id: 11, title: 'Plateau' }]);
  api.getProperties.mockResolvedValue([{ id: 1, name: 'La Grange' }]);
});

const renderPage = () => render(<MemoryRouter><EmailTextsSettingsPage /></MemoryRouter>);

test('texts by email; an unknown token is refused under its field', async () => {
  api.saveStayText.mockRejectedValue(Object.assign(new Error('Variable inconnue : {{prix}}'), { field: 'fr' }));
  renderPage();
  expect(await screen.findByText('J-7')).toBeInTheDocument();
  expect(screen.getByText('J-2')).toBeInTheDocument();
  const [fr] = screen.getAllByLabelText('Français');
  fireEvent.change(fr, { target: { value: 'Nous proposons {{prix}}.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Variable inconnue : {{prix}}')).toBeInTheDocument();
  expect(api.saveStayText).toHaveBeenCalledWith('offers.localIntro', { fr: 'Nous proposons {{prix}}.', en: 'We offer {{list}}.' });
});

test('mentions by section; the confirmation order moves on its own', async () => {
  api.saveConfirmationOrder.mockResolvedValue({ confirmationOrder: ['towels', 'babyBed', 'mention:1', 'mention:2'] });
  renderPage();
  await screen.findByText('J-7');
  fireEvent.click(screen.getByRole('tab', { name: 'Options citées' }));
  expect(await screen.findByText('le cidre ({{price}})')).toBeInTheDocument();
  expect(screen.getByText('1. Lit bébé')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Descendre Lit bébé' }));
  await waitFor(() => expect(api.saveConfirmationOrder).toHaveBeenCalledWith(['towels', 'babyBed', 'mention:1', 'mention:2']));
  expect(await screen.findByText('1. Serviettes de toilette')).toBeInTheDocument();
  expect(api.reorderEmailMentions).not.toHaveBeenCalled();
});

test('the preview shows what the server renders, in both languages', async () => {
  api.previewEmailMentions.mockResolvedValue({ fr: { offers: 'Nous proposons le cidre (5 €).', confirmations: 'Le cidre est prêt.' }, en: { offers: 'We offer cider (€5).', confirmations: 'Cider is ready.' } });
  renderPage();
  await screen.findByText('J-7');
  fireEvent.click(screen.getByRole('tab', { name: 'Aperçu' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Afficher' }));
  expect(await screen.findByText('Nous proposons le cidre (5 €).')).toBeInTheDocument();
  expect(screen.getByText('Cider is ready.')).toBeInTheDocument();
  expect(api.previewEmailMentions).toHaveBeenCalledWith({ propertyId: 1, children: 1, startDate: undefined });
});
