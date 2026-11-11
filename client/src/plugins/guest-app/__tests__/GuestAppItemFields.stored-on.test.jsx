// specs/guest-app.md rule 23 — a switch stored on for an item the app cannot sell (its price type changed, or a
// per_person resource) shows the server's reason, and stays enabled so the operator can switch it off.
import { screen } from '@testing-library/react';
import guestAppApi from '../guestAppApi';
import { itemView, renderFields } from './guestAppItemFixtures';

vi.mock('../guestAppApi', () => ({ default: { getItem: vi.fn(), saveItem: vi.fn(), getMedia: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  guestAppApi.getMedia.mockResolvedValue([]);
});

test('rule 23: a stored-on switch on an unsellable item says why and can still be switched off', async () => {
  guestAppApi.getItem.mockResolvedValue(itemView({ kind: 'resource', sold: true, sellable: { ok: false, reason: 'Un prix par personne ne se vend pas dans l’app.' } }));
  renderFields({ kind: 'resource' });
  const sold = await screen.findByRole('switch', { name: /Vendu dans l’app/ });
  expect(sold).toBeChecked();
  expect(sold).not.toBeDisabled();
  expect(screen.getByText('Un prix par personne ne se vend pas dans l’app.')).toBeInTheDocument();
  expect(screen.queryByText('Le prix et le titre restent ceux de GuestFlow, par logement.')).not.toBeInTheDocument();
});
