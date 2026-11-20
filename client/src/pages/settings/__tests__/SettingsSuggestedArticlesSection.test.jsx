/**
 * SettingsSuggestedArticlesSection — « Proposés à l'arrivée » (specs/outside-booking-sas.md rule 37): one list per sale context, grouped by kind, reordered with ↑ / ↓, 12 articles at most, a kind
 * with no context not drawn, saved with the bar's « Enregistrer » (one PUT per list changed, the server judging every reference).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getSuggestedArticlesSettings: vi.fn(),
    saveSuggestedArticles: vi.fn(),
    getSuggestedArticlesCatalogue: vi.fn(),
  },
}));
const showError = vi.fn();
const showSuccess = vi.fn();
vi.mock('../../../components/DialogProvider', () => ({ useToast: () => ({ showError, showSuccess }) }));

import api from '../../../api';
import SettingsSuggestedArticlesSection from '../SettingsSuggestedArticlesSection';

const art = (n, label) => ({ articleRef: `option:${n}`, label });
const settings = (over = {}) => ({
  kinds: [
    { kind: 'property', label: 'Logements', contexts: [] },
    {
      kind: 'resource', label: 'Ressources à l’heure', contexts: [
        { id: '3', label: 'Bain nordique', articleRefs: ['option:1', 'option:2'], articles: [art(1, 'Bière locale'), art(2, 'Limonade')] },
        { id: '4', label: 'Sauna', articleRefs: [], articles: [] },
      ],
    },
  ],
  ...over,
});

const renderIt = () => render(<MemoryRouter><SettingsSuggestedArticlesSection barTabs={null} /></MemoryRouter>);
const card = (name) => screen.findByRole('region', { name });

beforeEach(() => {
  vi.clearAllMocks();
  api.getSuggestedArticlesSettings.mockResolvedValue(settings());
  api.saveSuggestedArticles.mockResolvedValue({ context: {} });
  api.getSuggestedArticlesCatalogue.mockResolvedValue({ articles: [art(1, 'Bière locale'), art(2, 'Limonade'), art(3, 'Miel du domaine')] });
});

test('rule 37 — one card per context, grouped by its kind; a kind with no context is not drawn', async () => {
  renderIt();
  expect(await screen.findByText('Ressources à l’heure')).toBeInTheDocument();
  expect(screen.queryByText('Logements')).toBeNull();
  const bath = await card('Ressources à l’heure · Bain nordique');
  expect(within(bath).getAllByRole('listitem').map((li) => li.textContent.trim())).toEqual(['Bière locale', 'Limonade']);
  expect(within(await card('Ressources à l’heure · Sauna')).getByText('Aucun article proposé.')).toBeInTheDocument();
});

test('rule 37 — ↑ / ↓ reorder, « Retirer » drops; the order is saved as references, one PUT for the list changed only', async () => {
  renderIt();
  const bath = await card('Ressources à l’heure · Bain nordique');
  await within(bath).findByText('Limonade');
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  fireEvent.click(within(bath).getByRole('button', { name: 'Monter Limonade' }));
  expect(within(bath).getAllByRole('listitem').map((li) => li.textContent.trim())).toEqual(['Limonade', 'Bière locale']);
  expect(within(bath).getByRole('button', { name: 'Monter Limonade' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.saveSuggestedArticles).toHaveBeenCalledTimes(1));
  expect(api.saveSuggestedArticles).toHaveBeenCalledWith('resource', '3', ['option:2', 'option:1']);
  await waitFor(() => expect(showSuccess).toHaveBeenCalledWith('Listes enregistrées.'));
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('rule 37 — « Annuler » puts the saved lists back, nothing is sent', async () => {
  renderIt();
  const bath = await card('Ressources à l’heure · Bain nordique');
  fireEvent.click(await within(bath).findByRole('button', { name: 'Retirer de la liste : Bière locale' }));
  expect(within(bath).getAllByRole('listitem')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(within(bath).getAllByRole('listitem')).toHaveLength(2);
  expect(api.saveSuggestedArticles).not.toHaveBeenCalled();
});

test('rule 37 — « Ajouter un article » searches the catalogue without what the list already has; the choice joins the end of the list', async () => {
  renderIt();
  const sauna = await card('Ressources à l’heure · Sauna');
  fireEvent.click(await within(sauna).findByRole('button', { name: 'Ajouter un article' }));
  fireEvent.click(await within(sauna).findByRole('button', { name: 'Miel du domaine' }));
  expect(within(sauna).getAllByRole('listitem').map((li) => li.textContent.trim())).toEqual(['Miel du domaine']);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.saveSuggestedArticles).toHaveBeenCalledWith('resource', '4', ['option:3']));
  const bathAgain = await card('Ressources à l’heure · Bain nordique');
  fireEvent.click(within(bathAgain).getByRole('button', { name: 'Ajouter un article' }));
  await within(bathAgain).findByRole('button', { name: 'Miel du domaine' });
  expect(within(bathAgain).queryByRole('button', { name: 'Limonade' })).toBeNull();
});

test('rule 37 — twelve articles is the limit: the message shows and « Ajouter » is disabled (the server refuses a thirteenth)', async () => {
  const twelve = Array.from({ length: 12 }, (_, i) => art(i + 10, `Article ${i + 1}`));
  api.getSuggestedArticlesSettings.mockResolvedValue(settings({ kinds: [{ kind: 'resource', label: 'Ressources à l’heure', contexts: [{ id: '3', label: 'Bain nordique', articleRefs: twelve.map((a) => a.articleRef), articles: twelve }] }] }));
  renderIt();
  const bath = await screen.findByRole('region', { name: 'Ressources à l’heure · Bain nordique' });
  expect(within(bath).getByText('12 articles au plus.')).toBeInTheDocument();
  expect(within(bath).getByRole('button', { name: 'Ajouter un article' })).toBeDisabled();
});

test('a refused save is told with the server\'s words and keeps the draft', async () => {
  api.saveSuggestedArticles.mockRejectedValue(new Error('Article inconnu : option:1.'));
  renderIt();
  const bath = await card('Ressources à l’heure · Bain nordique');
  fireEvent.click(await within(bath).findByRole('button', { name: 'Retirer de la liste : Limonade' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(showError).toHaveBeenCalledWith('Article inconnu : option:1.'));
  expect(within(bath).getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
});

test('with no list to set, the page says so; a load failure offers a retry', async () => {
  api.getSuggestedArticlesSettings.mockResolvedValueOnce({ kinds: [{ kind: 'property', label: 'Logements', contexts: [] }] });
  const { unmount } = renderIt();
  expect(await screen.findByText('Aucune liste à régler.')).toBeInTheDocument();
  unmount();
  api.getSuggestedArticlesSettings.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(settings());
  renderIt();
  fireEvent.click(await screen.findByRole('button', { name: /Réessayer/ }));
  expect(await screen.findByText('Ressources à l’heure')).toBeInTheDocument();
});
