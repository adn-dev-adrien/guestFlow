// specs/guest-app.md rules 37bis-37quater — the Stock group of the editor's « Application clients » section, the only
// place the stock is edited: follow it, the count typed at a restock (with the last restock line and what unpaid
// orders hold), the alert threshold, « En rupture », a count below zero shown « −2 ».
import { act, fireEvent, screen } from '@testing-library/react';
import guestAppApi from '../guestAppApi';
import { itemView, renderFields } from './guestAppItemFixtures';

vi.mock('../guestAppApi', () => ({ default: { getItem: vi.fn(), saveItem: vi.fn(), getMedia: vi.fn() } }));

const tracked = (over = {}) => itemView({
  stock: {
    tracked: true, quantity: 5, quantityLabel: '5', held: 2, heldLabel: '2 réservés par des commandes en attente de paiement',
    left: 3, alertBelow: 3, soldOut: false, out: false, restockLine: 'Stock réglé à 5 — Sophie, 2 nov. 09:10', ...over,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  guestAppApi.getMedia.mockResolvedValue([]);
});

test('rule 37bis: a followed stock shows what the app can still sell, the restock line and the held units', async () => {
  guestAppApi.getItem.mockResolvedValue(tracked());
  renderFields();
  expect(await screen.findByLabelText('En stock')).toHaveValue('5');
  expect(screen.getByText('3 vendables dans l’app')).toBeInTheDocument();
  expect(screen.getByText(/Stock réglé à 5 — Sophie, 2 nov\. 09:10/)).toBeInTheDocument();
  expect(screen.getByText(/2 réservés par des commandes en attente de paiement/)).toBeInTheDocument();
  expect(screen.getByLabelText('Prévenir sous')).toHaveValue('3');
});

test('rule 37bis: following a stock asks for the count; the count typed is a restock', async () => {
  guestAppApi.getItem.mockResolvedValue(itemView());
  guestAppApi.saveItem.mockResolvedValue(tracked({ quantity: 24, quantityLabel: '24', left: 24 }));
  const { host } = renderFields();
  fireEvent.click(await screen.findByRole('switch', { name: /Suivre le stock/ }));
  await act(async () => { await expect(host.save({ itemId: 12 })).rejects.toThrow(); });
  expect(screen.getByText('Indiquez la quantité en stock.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('En stock'), { target: { value: '24' } });
  await act(async () => { await host.save({ itemId: 12 }); });
  expect(guestAppApi.saveItem).toHaveBeenCalledWith('option', 12, { stockTracked: true, stockQuantity: 24 });
});

test('rule 37ter: a stock below zero reads « −2 » and is not sent again unless retyped', async () => {
  guestAppApi.getItem.mockResolvedValue(tracked({ quantity: -2, quantityLabel: '−2', left: -2, out: true }));
  guestAppApi.saveItem.mockResolvedValue(tracked({ quantity: -2, quantityLabel: '−2', left: -2, out: true, soldOut: true }));
  const { host } = renderFields();
  expect(await screen.findByLabelText('En stock')).toHaveValue('−2');
  expect(screen.getByText('Épuisé dans l’app')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch', { name: /En rupture/ }));
  await act(async () => { await host.save({ itemId: 12 }); });
  expect(guestAppApi.saveItem).toHaveBeenCalledWith('option', 12, { soldOut: true });
});

test('rule 37quater: clearing « Prévenir sous » sends null (alert only at 0)', async () => {
  guestAppApi.getItem.mockResolvedValue(tracked());
  guestAppApi.saveItem.mockResolvedValue(tracked({ alertBelow: null }));
  const { host } = renderFields();
  fireEvent.change(await screen.findByLabelText('Prévenir sous'), { target: { value: '' } });
  await act(async () => { await host.save({ itemId: 12 }); });
  expect(guestAppApi.saveItem).toHaveBeenCalledWith('option', 12, { stockAlertBelow: null });
});

test('the bath (an hourly resource) and the breakfast have no stock group', async () => {
  guestAppApi.getItem.mockResolvedValue(itemView({ kind: 'resource', stockable: false }));
  renderFields({ kind: 'resource' });
  await screen.findByLabelText('Quantité max. par commande');
  expect(screen.queryByRole('switch', { name: /Suivre le stock/ })).not.toBeInTheDocument();
});
