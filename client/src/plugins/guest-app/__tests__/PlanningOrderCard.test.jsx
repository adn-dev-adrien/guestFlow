// specs/guest-app.md rules 41bis, 43 — the planning's « Commande client » card and its share of the day counter.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';
import guestAppApi from '../guestAppApi';
import PlanningOrderCard from '../PlanningOrderCard';
import { countOrderTasks, loadOrderDays } from '../planningOrders';

vi.mock('../guestAppApi', () => ({ default: { markDelivered: vi.fn(), getOrderCards: vi.fn() } }));

const card = (over = {}) => ({
  orderId: 9, reservationId: 40, time: '18:00', timeLabel: '18 h', lodging: 'La Granja', guest: 'Marie Durand',
  lines: ['2 × Cidre', '1 × Plateau de picodons'], paymentLabel: 'Sur la note', delivered: false, fulfilment: 'delivery', doneLabel: 'Livrée', ...over,
});

const renderCard = (item, props = {}) => render(
  <ThemeProvider theme={theme}><DialogProvider><PlanningOrderCard entry={{ item }} reload={vi.fn()} {...props} /></DialogProvider></ThemeProvider>,
);

beforeEach(() => vi.clearAllMocks());

test('rule 43: the time, the lodging, the guest, what to prepare and how it is paid; the detail opens the fiche', async () => {
  const onOpenReservation = vi.fn();
  renderCard(card(), { onOpenReservation });
  expect(screen.getByText('18 h')).toBeInTheDocument();
  expect(screen.getByText('1 × Plateau de picodons')).toBeInTheDocument();
  expect(screen.getByText('Sur la note · commande n° 9')).toBeInTheDocument();
  await userEvent.click(screen.getByText('La Granja'));
  expect(onOpenReservation).toHaveBeenCalledWith(40);
});

test('rule 43: ticking the circle marks the order delivered, then reloads the day', async () => {
  guestAppApi.markDelivered.mockResolvedValue({ status: 'delivered' });
  const reload = vi.fn();
  renderCard(card(), { reload });
  await userEvent.click(screen.getByRole('checkbox', { name: /Marquer livrée — commande n° 9/ }));
  await waitFor(() => expect(reload).toHaveBeenCalled());
  expect(guestAppApi.markDelivered).toHaveBeenCalledWith(9);
});

test('rule 41bis: a pickup order says « À retirer » and is « Retirée » once done, with no way back', () => {
  renderCard(card({ timeLabel: 'À retirer 18 h', fulfilment: 'pickup', delivered: true, doneLabel: 'Retirée' }));
  expect(screen.getByText('À retirer 18 h')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Retirée' })).toBeDisabled();
});

test('the loader files each card on its day; the counter counts the delivered ones as done', async () => {
  guestAppApi.getOrderCards.mockResolvedValue({ days: [{ date: '2026-11-07', cards: [card(), card({ orderId: 10, delivered: true })] }] });
  const days = await loadOrderDays({ from: '2026-11-07', to: '2026-11-08' });
  expect(days['2026-11-07'].map((e) => [e.key, e.time])).toEqual([['order-9', '18:00'], ['order-10', '18:00']]);
  expect(countOrderTasks(days['2026-11-07'])).toEqual({ total: 2, done: 1 });
});
