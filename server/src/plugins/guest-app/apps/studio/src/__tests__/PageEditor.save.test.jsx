// specs/guest-app.md rules 16-18 — « Enregistrer le brouillon » leaves the page clean once the server has trimmed it,
// a save refused half-way never creates a block twice even when the page cannot be read back (§4.2), and
// « Annuler » puts the saved text back in the block editors.
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import PageEditor from '../components/PageEditor';
import { draftOf, isDirty, saveDraft } from '../utils/pageDraft';
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
  placements: [{ propertyId: 1, name: 'La Granja', sortOrder: 0, published: true }],
  blocks: [
    { id: 71, pageId: 7, type: 'text', data: { html: { fr: '<p>Garez-vous sous le tilleul.</p>' } }, onlyForPropertyIds: null },
  ],
};

function setup() {
  const props = {
    pageId: 7,
    lodging: LA_GRANJA,
    lodgings: [LA_GRANJA, L_ESTIVA],
    media: [],
    items: [],
    bookletPages: [{ id: 7, slug: 'arrivee', title: { fr: 'Arrivée' } }],
    upToDate: false,
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

const saveButton = () => screen.getByRole('button', { name: 'Enregistrer le brouillon' });

async function addPlace(user, name) {
  await user.click(screen.getByRole('button', { name: 'Lieu' }));
  const block = screen.getByRole('region', { name: /Bloc \d : Lieu/ });
  await user.type(within(block).getAllByRole('textbox')[0], name);
  await user.type(within(block).getByRole('textbox', { name: /Adresse/ }), 'Chemin du lavoir ');
}

describe('PageEditor — after a save (rules 16-18)', () => {
  it('takes the page as the server stored it: trimmed, no empty English, nothing left « modified »', async () => {
    vi.clearAllMocks();
    api.media.mockResolvedValue([]);
    api.page.mockResolvedValueOnce(PAGE).mockResolvedValueOnce({
      ...PAGE,
      blocks: [...PAGE.blocks, { id: 72, pageId: 7, type: 'place', data: { name: { fr: 'Le lavoir' }, address: 'Chemin du lavoir' }, onlyForPropertyIds: null }],
    });
    api.createBlock.mockResolvedValue({ id: 72 });
    const props = setup();
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Bloc 1 : Texte' });
    await addPlace(user, 'Le lavoir ');
    await user.click(saveButton());
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
    await screen.findByText('Brouillon enregistré.');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Publier' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: 'Partager avec L’Estiva' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Dupliquer vers…' })).toBeEnabled();
  });

  it('a save refused half-way while the page cannot be read back, then retried, creates each block once', async () => {
    vi.clearAllMocks();
    api.media.mockResolvedValue([]);
    api.page.mockResolvedValueOnce(PAGE).mockRejectedValue(new Error('Réseau indisponible.'));
    api.createBlock
      .mockResolvedValueOnce({ id: 72 })
      .mockRejectedValueOnce(new Error('Le texte est obligatoire en français.'))
      .mockResolvedValueOnce({ id: 73 });
    setup();
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'Bloc 1 : Texte' });
    await addPlace(user, 'Le lavoir');
    await user.click(screen.getByRole('button', { name: 'Texte' }));
    await user.click(saveButton());
    expect(await screen.findByText('Bloc 3 (Texte) : Le texte est obligatoire en français.')).toBeInTheDocument();

    await user.type(within(screen.getByRole('region', { name: 'Bloc 3 : Texte' })).getAllByRole('textbox')[0], 'Bienvenue');
    await user.click(saveButton());
    await waitFor(() => expect(api.createBlock).toHaveBeenCalledTimes(3));
    const places = api.createBlock.mock.calls.filter(([, body]) => body.type === 'place');
    expect(places).toHaveLength(1);
    expect(api.saveBlock).toHaveBeenCalledWith(72, expect.objectContaining({ data: expect.objectContaining({ address: 'Chemin du lavoir ' }) }));
  });
});

describe('PageEditor — « Annuler » (rule 18)', () => {
  it('puts the saved text back in a text block being edited', async () => {
    vi.clearAllMocks();
    api.media.mockResolvedValue([]);
    api.page.mockResolvedValue(PAGE);
    setup();
    const user = userEvent.setup();
    const block = await screen.findByRole('region', { name: 'Bloc 1 : Texte' });
    const fr = within(block).getAllByRole('textbox')[0];
    expect(fr).toHaveValue('Garez-vous sous le tilleul.');
    await user.type(fr, ' Ou pas.');
    await user.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(within(screen.getByRole('region', { name: 'Bloc 1 : Texte' })).getAllByRole('textbox')[0]).toHaveValue('Garez-vous sous le tilleul.');
    expect(saveButton()).toBeDisabled();
  });
});

describe('pageDraft — blocks compared as the server stores them (rules 18-19)', () => {
  it('an empty English and surrounding spaces are not a change, and write nothing', async () => {
    const page = { ...PAGE, blocks: [{ id: 80, type: 'place', data: { name: { fr: 'Le lavoir' }, address: 'Chemin' }, onlyForPropertyIds: null }] };
    const saved = draftOf(page);
    const draft = JSON.parse(JSON.stringify(saved));
    draft.blocks[0].data = { name: { fr: 'Le lavoir ', en: '' }, address: ' Chemin' };
    expect(isDirty(draft, saved)).toBe(false);
    const calls = { savePage: vi.fn(), createBlock: vi.fn(), saveBlock: vi.fn(), deleteBlock: vi.fn(), orderBlocks: vi.fn() };
    await saveDraft(calls, 7, draft, saved);
    Object.values(calls).forEach((fn) => expect(fn).not.toHaveBeenCalled());
  });
});
