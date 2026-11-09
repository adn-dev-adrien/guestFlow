// specs/guest-app.md rules 41bis, 45 — « Commandes clients »: the orders by delivery time, « À préparer » / « Toutes »,
// « Marquer livrée » (« Marquer retirée » in pickup mode, the server's words), the push's order outlined.
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';
import guestAppApi from '../guestAppApi';
import GuestOrdersPage from '../GuestOrdersPage';

vi.mock('../guestAppApi', () => ({ default: { getOrders: vi.fn(), markDelivered: vi.fn() } }));

const order = (over = {}) => ({
  id: 11,
  reservationId: 40,
  lodging: 'L’Estiva',
  guest: 'Thomas Ribeiro',
  lines: [{ label: '2 × Cidre', total: 9, totalLabel: '9,00 €' }],
  deliverAt: '2026-11-07T17:00:00.000Z', // date-literal-ok: the server's order, rendered as sent
  deliverLabel: 'sam. 7 nov. 18 h',
  fulfilment: 'delivery',
  fulfilmentLabel: 'Livraison au logement',
  payment: 'note',
  paymentLabel: 'Sur la note',
  status: 'confirmed',
  statusLabel: 'À préparer',
  total: 9,
  totalLabel: '9,00 €',
  canMarkDelivered: true,
  markLabel: 'Marquer livrée',
  ...over,
});

function renderPage(path = '/commandes-app') {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[path]}>
        <DialogProvider>
          <GuestOrdersPage />
        </DialogProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

test('rule 45: « À préparer » by default, each order with its time, lodging, guest, lines, payment and status', async () => {
  guestAppApi.getOrders.mockResolvedValue({ orders: [order()] });
  renderPage();
  expect(await screen.findByText('sam. 7 nov. 18 h')).toBeInTheDocument();
  expect(guestAppApi.getOrders).toHaveBeenCalledWith('todo');
  expect(screen.getByText('L’Estiva · Thomas Ribeiro')).toBeInTheDocument();
  expect(screen.getByText('2 × Cidre')).toBeInTheDocument();
  expect(screen.getByText('Sur la note · 9,00 €')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Voir la fiche/ })).toHaveAttribute('href', '/reservations/40?from=%2Fcommandes-app');
});

test('rule 45: « Marquer livrée » marks the order and reloads the list', async () => {
  guestAppApi.getOrders.mockResolvedValueOnce({ orders: [order()] }).mockResolvedValueOnce({ orders: [] });
  guestAppApi.markDelivered.mockResolvedValue({ status: 'delivered' });
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'Marquer livrée' }));
  expect(guestAppApi.markDelivered).toHaveBeenCalledWith(11);
  expect(await screen.findByText(/Aucune commande à préparer/)).toBeInTheDocument();
});

test('rule 41bis: pickup mode — « Marquer retirée » and the place, as the server words them', async () => {
  guestAppApi.getOrders.mockResolvedValue({
    orders: [order({
      fulfilment: 'pickup', fulfilmentLabel: 'À retirer', pickupPlace: 'À l’accueil, maison principale', markLabel: 'Marquer retirée', deliverLabel: 'À retirer sam. 7 nov. 18 h',
    })],
  });
  renderPage();
  expect(await screen.findByRole('button', { name: 'Marquer retirée' })).toBeInTheDocument();
  expect(screen.getByText('À retirer : À l’accueil, maison principale')).toBeInTheDocument();
});

test('« Toutes » reads the last 30 days; an order that cannot be marked has no button', async () => {
  guestAppApi.getOrders.mockResolvedValueOnce({ orders: [] })
    .mockResolvedValueOnce({ orders: [order({ status: 'expired', statusLabel: 'Expirée', canMarkDelivered: false })] });
  renderPage();
  await screen.findByText(/Aucune commande à préparer/);
  await userEvent.click(screen.getByRole('tab', { name: 'Toutes' }));
  expect(await screen.findByText('Expirée')).toBeInTheDocument();
  expect(guestAppApi.getOrders).toHaveBeenLastCalledWith('all');
  expect(screen.queryByRole('button', { name: 'Marquer livrée' })).not.toBeInTheDocument();
});

test('the push link: the order is outlined and brought into view, looked for in « Toutes » once it is delivered', async () => {
  guestAppApi.getOrders.mockResolvedValueOnce({ orders: [order({ id: 3 })] })
    .mockResolvedValueOnce({ orders: [order({ id: 3 }), order({ id: 11, status: 'delivered', statusLabel: 'Livrée', canMarkDelivered: false })] });
  const { container } = renderPage('/commandes-app?order=11');
  await waitFor(() => expect(guestAppApi.getOrders).toHaveBeenLastCalledWith('all'));
  await waitFor(() => expect(container.querySelector('[data-order-id="11"]')).not.toBeNull());
  await waitFor(() => expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled());
  expect(within(container.querySelector('[data-order-id="11"]')).getByText('Livrée')).toBeInTheDocument();
});

test('a failed read offers « Réessayer »', async () => {
  guestAppApi.getOrders.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ orders: [] });
  renderPage();
  await userEvent.click(await screen.findByRole('button', { name: /Réessayer/ }));
  expect(await screen.findByText(/Aucune commande à préparer/)).toBeInTheDocument();
});

test('only the latest read lands: « À préparer » answered after « Toutes » does not replace it', async () => {
  let answerTodo;
  guestAppApi.getOrders
    .mockImplementationOnce(() => new Promise((resolve) => { answerTodo = resolve; }))
    .mockResolvedValueOnce({ orders: [order({ id: 12, status: 'expired', statusLabel: 'Expirée', canMarkDelivered: false })] });
  renderPage();
  await userEvent.click(await screen.findByRole('tab', { name: 'Toutes' }));
  expect(await screen.findByText('Expirée')).toBeInTheDocument();
  answerTodo({ orders: [order({ id: 99, deliverLabel: 'dim. 8 nov. 9 h' })] });
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  expect(screen.queryByText('dim. 8 nov. 9 h')).not.toBeInTheDocument();
  expect(screen.getByText('Expirée')).toBeInTheDocument();
});
