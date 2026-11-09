// specs/guest-app.md rules 22, 23, 39 — the « Application clients » section of the option / resource editor: the sell
// switch (disabled with the server's reason), the presentation fields, and a save that writes only what changed.
import { act, fireEvent, screen } from '@testing-library/react';
import guestAppApi from '../guestAppApi';
import { itemView, renderFields } from './guestAppItemFixtures';

vi.mock('../guestAppApi', () => ({ default: { getItem: vi.fn(), saveItem: vi.fn(), getMedia: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  guestAppApi.getMedia.mockResolvedValue([]);
});

test('rule 23: a price type the app cannot sell leaves the switch off and says why', async () => {
  guestAppApi.getItem.mockResolvedValue(itemView({ sold: false, sellable: { ok: false, reason: 'Un prix par nuit ne se vend pas à l’unité.' } }));
  renderFields();
  const sold = await screen.findByRole('switch', { name: /Vendu dans l’app/ });
  expect(sold).toBeDisabled();
  expect(screen.getByText('Un prix par nuit ne se vend pas à l’unité.')).toBeInTheDocument();
  expect(screen.queryByLabelText('Description courte')).not.toBeInTheDocument();
});

test('rules 22, 39: sold → photo, descriptions with their counter, prepared by the team with its lead time', async () => {
  guestAppApi.getItem.mockResolvedValue(itemView());
  renderFields();
  expect(await screen.findByLabelText('Description courte')).toHaveValue('Pur jus.');
  expect(screen.getByText('8/140')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Choisir une photo' })).toBeInTheDocument();
  expect(screen.getByLabelText('Délai de préparation (min)')).toHaveValue('30');
  fireEvent.click(screen.getByRole('switch', { name: /Préparé par l’équipe/ }));
  expect(screen.queryByLabelText('Délai de préparation (min)')).not.toBeInTheDocument();
});

test('a resource has no « Préparé par l’équipe » (rule 31 governs it)', async () => {
  guestAppApi.getItem.mockResolvedValue(itemView({ kind: 'resource', needsStaff: false }));
  renderFields({ kind: 'resource' });
  await screen.findByLabelText('Quantité max. par commande');
  expect(screen.queryByRole('switch', { name: /Préparé par l’équipe/ })).not.toBeInTheDocument();
});

test('the host save writes only the changed keys, typed, then the section is clean again', async () => {
  guestAppApi.getItem.mockResolvedValue(itemView());
  guestAppApi.saveItem.mockImplementation(async (kind, id, patch) => itemView({ ...patch }));
  const { host } = renderFields();
  fireEvent.change(await screen.findByLabelText('Quantité max. par commande'), { target: { value: '6' } });
  fireEvent.change(screen.getByLabelText('Description courte (anglais)'), { target: { value: 'Pure juice.' } });
  expect(host.dirty).toBe(true);
  await act(async () => { await host.save({ itemId: 12 }); });
  expect(guestAppApi.saveItem).toHaveBeenCalledWith('option', 12, { maxQuantity: 6, shortDescriptionEn: 'Pure juice.' });
  expect(host.dirty).toBe(false);
});

test('an invalid quantity is shown on the field and nothing is sent', async () => {
  guestAppApi.getItem.mockResolvedValue(itemView());
  const { host } = renderFields();
  fireEvent.change(await screen.findByLabelText('Quantité max. par commande'), { target: { value: '80' } });
  expect(screen.getByText('Un entier de 1 à 50.')).toBeInTheDocument();
  await act(async () => { await expect(host.save({ itemId: 12 })).rejects.toThrow('corrigez les champs signalés'); });
  expect(guestAppApi.saveItem).not.toHaveBeenCalled();
});

test('the server refusal is shown in the section and reaches the host', async () => {
  guestAppApi.getItem.mockResolvedValue(itemView());
  guestAppApi.saveItem.mockRejectedValue(new Error('La photo est introuvable.'));
  const { host } = renderFields();
  fireEvent.change(await screen.findByLabelText('Quantité max. par commande'), { target: { value: '4' } });
  await act(async () => { await expect(host.save({ itemId: 12 })).rejects.toThrow('Application clients : La photo est introuvable.'); });
  expect(screen.getByText('La photo est introuvable.')).toBeInTheDocument();
});

test('an article not created yet: nothing to sell before it exists', () => {
  renderFields({ itemId: null });
  expect(screen.getByText(/Enregistrez d’abord l’option/)).toBeInTheDocument();
  expect(guestAppApi.getItem).not.toHaveBeenCalled();
});
