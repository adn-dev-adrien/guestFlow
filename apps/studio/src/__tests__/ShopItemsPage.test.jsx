// specs/guest-app.md rules 22-24, 37bis, 48 — the studio's Boutique: the lodging's articles at its price, the sell
// switch and presentation, the stock read-only.
// specs/guest-app.md rule 50 — one flag, two views: the studio writes the same `PUT /api/guest-app/items/:kind/:id`
// rows as GuestFlow's option and resource editors.
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShopItemsPage from '../pages/ShopItemsPage';
import { api } from '../services/api';
import { LA_GRANJA, renderStudio } from './studioFixtures';

vi.mock('../services/api', () => ({ api: { items: vi.fn(), media: vi.fn(), saveItem: vi.fn() } }));
vi.mock('../components/PhonePreview', () => ({ default: () => null }));

const STOCK = {
  tracked: true, quantity: 3, quantityLabel: '3', held: 1, heldLabel: '1 réservé par des commandes en attente de paiement', left: 2, alertBelow: 5, soldOut: false, out: false, restockLine: 'Stock réglé à 24 — Sophie, 6 nov. 14:02',
};
const ITEMS = [
  {
    kind: 'option', id: 1, title: 'Cidre', priceType: 'per_stay', category: 'Boissons', archived: false, sellable: { ok: true, reason: null }, sold: true, mediaId: null, shortDescriptionFr: null, shortDescriptionEn: null, maxQuantity: 10, needsStaff: true, leadMinutes: 30, stockable: true, stock: STOCK, price: 4.5, priceLabel: '4,50 €', priceUnitLabel: 'la bouteille',
  },
  {
    kind: 'option', id: 2, title: 'Lit bébé', priceType: 'per_night', category: 'Pour la maison', archived: false, sellable: { ok: false, reason: 'Facturé à la nuit : le prix dépend de la durée du séjour.' }, sold: false, mediaId: null, shortDescriptionFr: null, shortDescriptionEn: null, maxQuantity: 10, needsStaff: false, leadMinutes: 30, stockable: true, stock: { ...STOCK, tracked: false, quantityLabel: null }, price: 0, priceLabel: 'Inclus (0 €)', priceUnitLabel: null,
  },
];

function setup() {
  api.items.mockResolvedValue(ITEMS);
  api.media.mockResolvedValue([]);
  api.saveItem.mockImplementation(async (kind, id, patch) => ({ ...ITEMS.find((i) => i.id === id), ...patch }));
  renderStudio(<ShopItemsPage lodging={LA_GRANJA} />);
}

describe('ShopItemsPage (rules 22-24, 37bis, 48, 50)', () => {
  it('lists the lodging’s articles with GuestFlow’s price and stock, and why one cannot be sold', async () => {
    setup();
    expect(await screen.findByText('Cidre')).toBeInTheDocument();
    expect(screen.getByText(/Boissons · 4,50 € · la bouteille/)).toBeInTheDocument();
    expect(screen.getByText('Stock : 3')).toBeInTheDocument();
    expect(screen.getByText('Vendu dans l’app')).toBeInTheDocument();
    expect(screen.getByText('Ne se vend pas dans l’app')).toBeInTheDocument();
    expect(screen.getByText('Facturé à la nuit : le prix dépend de la durée du séjour.')).toBeInTheDocument();
    expect(api.items).toHaveBeenCalledWith(1);
  });

  it('the stock is read only here, with « Modifier dans GuestFlow »', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Cidre/ }));
    expect(screen.getByText(/En stock : 3 · 1 réservé par des commandes en attente de paiement · Stock réglé à 24/)).toBeInTheDocument();
    expect(screen.getByText(/Le stock se règle dans GuestFlow seulement/)).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /stock/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Modifier dans GuestFlow' })[0]).toHaveAttribute('href', '/parametres/options-ressources');
  });

  it('saves only the presentation fields that changed', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Cidre/ }));
    await user.type(screen.getByRole('textbox', { name: 'Description courte' }), 'Cidre fermier');
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(api.saveItem).toHaveBeenCalledWith('option', 1, { shortDescriptionFr: 'Cidre fermier' }));
  });

  it('an article the app cannot sell keeps its switch off and disabled', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Lit bébé/ }));
    expect(screen.getByRole('switch', { name: 'Vendu dans l’app' })).toBeDisabled();
  });
});
