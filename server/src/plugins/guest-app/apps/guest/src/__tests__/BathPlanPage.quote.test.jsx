// specs/guest-app/guest-app-bath-home-scheduling.md rules 15-19 — the price is the server's: the button carries the quote's total, the
// breakdown lines are the server's words. 0 € places the sessions at once (`POST /orders`, payment none); above, the line goes to
// the cart and its payment choice.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { baseRoutes, renderApp, stubApi } from './guestFixtures';
import {
  BLOCKS, SHOP_BATH, SLOTS, card, meWith, quoteOf,
} from './bathPlanFixtures';

const routes = (quote, over = {}) => baseRoutes({
  'GET /me': meWith([card()]),
  'GET /shop': SHOP_BATH,
  'GET /shop/resources/5/slots': SLOTS,
  'GET /shop/resources/5/blocks': BLOCKS,
  'POST /orders/quote': quote,
  'GET /orders/*': { id: 41, lines: [], total: 0, totalLabel: '0 €', status: 'confirmed', statusLabel: 'Confirmée', payment: 'none', collectAt: 'arrival', fulfilment: 'delivery' },
  ...over,
});

describe('bath scheduling — the server quote', () => {
  it('an evening slot: « Supplément soirée » and « Confirmer · 20 € » from the quote, then the cart', async () => {
    stubApi(routes(quoteOf(20, [
      { key: 'offered', label: 'Offerte · 1 h', amount: 0, amountLabel: '0 €' },
      { key: 'evening', label: 'Supplément soirée', amount: 20, amountLabel: '20 €' },
    ])));
    renderApp('/bain/programmer/5');
    fireEvent.click(await screen.findByText('20 h – 21 h'));
    const button = await screen.findByRole('button', { name: 'Confirmer · 20 €' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByText('Supplément soirée')).toBeInTheDocument();
    fireEvent.click(button);
    expect(await screen.findByText('Votre panier')).toBeInTheDocument();
  });

  it('0 €: « Confirmer mes séances » places the sessions with no payment, then opens the order', async () => {
    const { calls } = stubApi(routes(quoteOf(0, [{ key: 'offered', label: 'Offerte · 1 h', amount: 0, amountLabel: '0 €' }]), {
      'POST /orders': { orderId: 41, status: 'confirmed' },
    }));
    renderApp('/bain/programmer/5');
    fireEvent.click(await screen.findByText('16 h – 17 h'));
    const confirm = await screen.findByRole('button', { name: 'Confirmer mes séances' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/orders')).toBe(true));
    const sent = calls.find((c) => c.method === 'POST' && c.path === '/orders').body;
    expect(sent).toEqual({ lines: [{ kind: 'resource', id: 5, sessions: [{ date: '2099-07-07', start: '16:00', end: '17:00' }] }], payment: 'none' });
  });

  it('a quote the server refuses: its sentence is said and nothing can be confirmed', async () => {
    stubApi(routes({ status: 409, error: { code: 'SLOT_TAKEN', message: 'Ce créneau vient d’être pris.' } }));
    renderApp('/bain/programmer/5');
    fireEvent.click(await screen.findByText('16 h – 17 h'));
    expect(await screen.findByText('Ce créneau vient d’être pris.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmer mes séances' })).toBeDisabled();
  });
});
