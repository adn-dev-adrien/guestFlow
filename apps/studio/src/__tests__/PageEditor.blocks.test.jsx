// specs/guest-app.md rules 16-18, 48 — the page editor: a block added from the palette, edited FR / EN, restricted
// to one lodging on a shared page, removed, reordered, and « Enregistrer le brouillon » writing exactly that.
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import PageEditor from '../components/PageEditor';
import { draftOf, saveDraft } from '../utils/pageDraft';
import { api } from '../services/api';
import { LA_GRANJA, L_ESTIVA, renderStudio } from './studioFixtures';

vi.mock('../services/api', () => ({
  api: {
    page: vi.fn(), savePage: vi.fn(), createBlock: vi.fn(), saveBlock: vi.fn(), deleteBlock: vi.fn(), orderBlocks: vi.fn(),
    sharePage: vi.fn(), unsharePage: vi.fn(), duplicatePage: vi.fn(), deletePage: vi.fn(), media: vi.fn(),
  },
}));

const PAGE = {
  id: 7,
  slug: 'arrivee',
  icon: 'gate',
  coverMediaId: null,
  title: { fr: 'Arrivée', en: 'Arrival' },
  placeholder: false,
  placements: [{ propertyId: 1, name: 'La Granja', sortOrder: 1, published: true }, { propertyId: 2, name: 'L’Estiva', sortOrder: 0, published: true }],
  blocks: [
    { id: 70, pageId: 7, type: 'callout', data: { tone: 'warning', text: { fr: 'Roulez au pas.', en: 'Drive slowly.' } }, onlyForPropertyIds: null },
    { id: 71, pageId: 7, type: 'text', data: { html: { fr: '<p>Garez-vous sous le tilleul.</p>' } }, onlyForPropertyIds: [2] },
  ],
};

function setup(page = PAGE) {
  api.page.mockResolvedValue(page);
  api.media.mockResolvedValue([]);
  const props = {
    pageId: page.id,
    lodging: LA_GRANJA,
    lodgings: [LA_GRANJA, L_ESTIVA],
    media: [],
    items: [],
    bookletPages: [{ id: 7, slug: 'arrivee', title: { fr: 'Arrivée' } }],
    upToDate: true,
    list: null,
    preview: null,
    previewRef: createRef(),
    onChanged: vi.fn(),
    onDeleted: vi.fn(),
    onPublish: vi.fn(),
  };
  renderStudio(<PageEditor {...props} />);
  return props;
}

describe('PageEditor (rules 16-18)', () => {
  it('a shared page says it changes the other lodging too, and a restricted block names its lodging', async () => {
    setup();
    expect(await screen.findByText(/modifie aussi le livret de L’Estiva/)).toBeInTheDocument();
    expect(screen.getByText(/seulement pour L’Estiva/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ne plus partager avec L’Estiva' })).toBeInTheDocument();
  });

  it('adds a block from the palette, edits it FR / EN, and saves: created, the others untouched, order written', async () => {
    const props = setup();
    api.createBlock.mockResolvedValue({ id: 72 });
    const user = userEvent.setup();
    await screen.findByText(/modifie aussi/);
    await user.click(screen.getByRole('button', { name: 'Lieu' }));
    const block = screen.getByRole('region', { name: 'Bloc 3 : Lieu' });
    const [fr, en] = within(block).getAllByRole('textbox').slice(0, 2);
    await user.type(fr, 'Le lavoir');
    await user.type(en, 'The wash-house');
    await user.type(within(block).getByRole('textbox', { name: /Adresse/ }), 'Chemin du lavoir');
    await user.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    await waitFor(() => expect(api.createBlock).toHaveBeenCalledTimes(1));
    expect(api.createBlock).toHaveBeenCalledWith(7, {
      type: 'place', data: { name: { fr: 'Le lavoir', en: 'The wash-house' }, address: 'Chemin du lavoir' }, onlyForPropertyIds: null,
    });
    expect(api.saveBlock).not.toHaveBeenCalled();
    expect(api.deleteBlock).not.toHaveBeenCalled();
    expect(api.orderBlocks).toHaveBeenCalledWith(7, [70, 71, 72]);
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  it('restricting, removing and moving blocks are written in that order of operations', async () => {
    setup();
    const user = userEvent.setup();
    await screen.findByText(/modifie aussi/);
    await user.click(screen.getByRole('button', { name: 'Retirer le bloc 2 (Texte)' }));
    await user.click(within(screen.getByRole('region', { name: 'Bloc 1 : Encadré' })).getByRole('combobox', { name: 'Pour' }));
    await user.click(await screen.findByRole('option', { name: 'Seulement La Granja' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    await waitFor(() => expect(api.saveBlock).toHaveBeenCalledWith(70, { onlyForPropertyIds: [1] }));
    expect(api.deleteBlock).toHaveBeenCalledWith(71);
    expect(api.orderBlocks).not.toHaveBeenCalled();
  });

  it('a refused block keeps the draft and names the block', async () => {
    setup();
    api.createBlock.mockRejectedValue(new Error('Le texte est obligatoire en français.'));
    const user = userEvent.setup();
    await screen.findByText(/modifie aussi/);
    await user.click(screen.getByRole('button', { name: 'Texte' }));
    await user.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    expect(await screen.findByText('Bloc 3 (Texte) : Le texte est obligatoire en français.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Bloc 3 : Texte' })).toBeInTheDocument();
  });
});

describe('saveDraft (rules 16-18)', () => {
  it('an untouched page writes nothing, rich text included', async () => {
    const calls = { savePage: vi.fn(), createBlock: vi.fn(), saveBlock: vi.fn(), deleteBlock: vi.fn(), orderBlocks: vi.fn() };
    const saved = draftOf(PAGE);
    await saveDraft(calls, 7, JSON.parse(JSON.stringify(saved)), saved);
    Object.values(calls).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });

  it('a title changed alone writes the title only', async () => {
    const calls = { savePage: vi.fn(), createBlock: vi.fn(), saveBlock: vi.fn(), deleteBlock: vi.fn(), orderBlocks: vi.fn() };
    const saved = draftOf(PAGE);
    const draft = { ...JSON.parse(JSON.stringify(saved)), title: { fr: 'Votre arrivée', en: 'Arrival' } };
    await saveDraft(calls, 7, draft, saved);
    expect(calls.savePage).toHaveBeenCalledWith(7, { title: { fr: 'Votre arrivée', en: 'Arrival' } });
    expect(calls.saveBlock).not.toHaveBeenCalled();
  });
});
