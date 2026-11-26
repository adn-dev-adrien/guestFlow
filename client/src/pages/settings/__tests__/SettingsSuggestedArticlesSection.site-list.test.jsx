// specs/site/site-outside-resource-booking.md §3.H rules 34-36 — « Options proposées »: each card says where its list shows (« Sur le site » / « À l'arrivée seulement »), each row its unit price,
// « Ajouter des articles » opens a checklist that stays open, an article now refused is drawn in warning with « Retirer pour enregistrer. » and the server's refusal of the save is said on the card.
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

const NEEDS_STAY = 'Le prix « par personne » a besoin d’un séjour : il ne se vend pas seul.';
const art = (n, label, unitCents = 600, reason = null) => ({ articleRef: `option:${n}`, label, unitCents, unitLabel: 'l’unité', reason });
const settings = (bathArticles) => ({
  kinds: [
    { kind: 'property', label: 'Logements', contexts: [{ id: '1', label: 'Gîte', shownOn: ['arrival'], articleRefs: [], articles: [] }] },
    {
      kind: 'resource',
      label: 'Ressources à l’heure',
      contexts: [
        { id: '3', label: 'Bain nordique', shownOn: ['arrival', 'site'], articleRefs: bathArticles.map((a) => a.articleRef), articles: bathArticles },
        { id: '4', label: 'Sauna', shownOn: ['arrival'], articleRefs: [], articles: [] },
      ],
    },
  ],
});
const GROUPS = [{ category: 'Boissons', articles: [
  { articleRef: 'option:1', label: 'Jus de pomme', unitCents: 600, unitLabel: 'l’unité', sellable: true, reason: null },
  { articleRef: 'option:2', label: 'Champagne', unitCents: 5500, unitLabel: 'l’unité', sellable: true, reason: null },
  { articleRef: 'option:9', label: 'Linge de toilette', unitCents: null, sellable: false, reason: NEEDS_STAY },
] }];

const renderIt = () => render(<MemoryRouter><SettingsSuggestedArticlesSection barTabs={null} /></MemoryRouter>);
const card = (name) => screen.findByRole('region', { name });

beforeEach(() => {
  vi.clearAllMocks();
  api.getSuggestedArticlesSettings.mockResolvedValue(settings([art(1, 'Jus de pomme'), art(2, 'Champagne', 5500)]));
  api.saveSuggestedArticles.mockResolvedValue({ context: {} });
  api.getSuggestedArticlesCatalogue.mockResolvedValue({ groups: GROUPS, articles: [] });
});

test('rule 35 — a context the site shows has the « Sur le site » badge and its caption; the others say « À l’arrivée seulement »', async () => {
  renderIt();
  const bath = await card('Ressources à l’heure · Bain nordique');
  expect(within(bath).getByText('Sur le site')).toBeInTheDocument();
  expect(within(bath).getByText('À l’arrivée et dans « Ajouter à la séance » de la page du site.')).toBeInTheDocument();
  const sauna = await card('Ressources à l’heure · Sauna');
  expect(within(sauna).getByText('À l’arrivée seulement')).toBeInTheDocument();
  expect(within(await card('Logements · Gîte')).getByText('À l’arrivée seulement')).toBeInTheDocument();
  expect(screen.getByText('Articles proposés à l’arrivée et, pour une activité vendue en ligne, sur sa page du site, dans l’ordre choisi.')).toBeInTheDocument();
});

test('rule 36 — each row shows its unit price under the name, as the server gave it', async () => {
  renderIt();
  const bath = await card('Ressources à l’heure · Bain nordique');
  const rows = within(bath).getAllByRole('listitem').map((li) => li.textContent);
  expect(rows[0]).toContain('Jus de pomme');
  expect(rows[0]).toContain('6,00 € l’unité');
  expect(rows[1]).toContain('55,00 € l’unité');
});

test('rule 36 — « Ajouter des articles » opens a checklist asked for this context with `all`; it stays open while several articles are ticked, then « Fermer »', async () => {
  renderIt();
  const sauna = await card('Ressources à l’heure · Sauna');
  fireEvent.click(within(sauna).getByRole('button', { name: 'Ajouter des articles' }));
  const juice = await within(sauna).findByRole('checkbox', { name: /Jus de pomme/ });
  expect(api.getSuggestedArticlesCatalogue).toHaveBeenCalledWith({ q: '', context: 'resource:4', all: true });
  fireEvent.click(juice);
  fireEvent.click(within(sauna).getByRole('checkbox', { name: /Champagne/ }));
  expect(within(sauna).getByRole('checkbox', { name: /Linge de toilette/ })).toBeDisabled();
  expect(within(sauna).getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Jus de pomme'), expect.stringContaining('Champagne')]);
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.saveSuggestedArticles).toHaveBeenCalledWith('resource', '4', ['option:1', 'option:2']));
  fireEvent.click(within(sauna).getByRole('button', { name: 'Fermer' }));
  expect(within(sauna).queryByRole('checkbox', { name: /Jus de pomme/ })).toBeNull();
});

test('rule 36 — a listed article now refused is drawn in warning with its reason and « Retirer pour enregistrer. »; the save of that list is refused with the server\'s sentence on its card', async () => {
  api.getSuggestedArticlesSettings.mockResolvedValue(settings([art(1, 'Jus de pomme'), art(9, 'Linge de toilette', null, NEEDS_STAY)]));
  api.saveSuggestedArticles.mockRejectedValue(new Error(`${NEEDS_STAY} Retirer pour enregistrer.`));
  renderIt();
  const bath = await card('Ressources à l’heure · Bain nordique');
  expect(within(bath).getByText(`${NEEDS_STAY} Retirer pour enregistrer.`)).toBeInTheDocument();
  fireEvent.click(within(bath).getByRole('button', { name: 'Monter Linge de toilette' }));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(showError).toHaveBeenCalledWith(`${NEEDS_STAY} Retirer pour enregistrer.`));
  expect(within(bath).getByRole('alert')).toHaveTextContent('Retirer pour enregistrer.');
  expect(showSuccess).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled();
});
