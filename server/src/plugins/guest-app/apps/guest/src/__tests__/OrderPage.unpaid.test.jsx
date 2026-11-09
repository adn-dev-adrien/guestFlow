// specs/guest-app.md rules 33, 35 — an unpaid card order: once the app has stopped following it, « Vérifier à
// nouveau » reads it again; abandoning it gives its lines back to the cart, merged with what the cart holds since.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';
import { ME_STAY, baseRoutes, renderApp, stubApi } from './guestFixtures';
import { useOrderStatus } from '../hooks/useOrderStatus';

vi.mock('../hooks/useOrderStatus', () => ({ useOrderStatus: vi.fn() }));

const CART_KEY = `cart:1:${ME_STAY.stay.arrival}`;
const ORDER = {
  id: 42, status: 'awaiting_payment', statusLabel: 'Paiement en attente', payment: 'card', lines: [{ label: '2 × Cidre', totalLabel: '9 €' }], totalLabel: '9 €', fulfilment: 'delivery',
};
const device = () => JSON.parse(window.localStorage.getItem('gf-guest') || '{}');

let recheck;
beforeEach(() => {
  recheck = vi.fn();
  useOrderStatus.mockReturnValue({
    order: ORDER, error: null, polling: false, stalled: true, recheck,
  });
});

describe('an unpaid card order (rules 33, 35)', () => {
  it('once the app has stopped following it, « Vérifier à nouveau » reads it again', async () => {
    stubApi(baseRoutes());
    renderApp('/commandes/42');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Vérifier à nouveau' }));
    expect(recheck).toHaveBeenCalledTimes(1);
  });

  it('abandoning it merges its lines into the cart instead of replacing the cart', async () => {
    window.localStorage.setItem('gf-guest', JSON.stringify({
      [CART_KEY]: { lines: [{ kind: 'option', id: 12, quantity: 1 }, { kind: 'option', id: 11, quantity: 1 }], meta: {} },
    }));
    stubApi(baseRoutes({
      'POST /orders/42/abandon': { status: 'abandoned', cartLines: [{ kind: 'option', id: 11, quantity: 2 }] },
      'POST /orders/quote': { lines: [], total: 0, totalLabel: '0 €' },
      'POST /shop/delivery-slots': { needed: false },
    }));
    renderApp('/commandes/42');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Abandonner et revenir au panier' }));
    await waitFor(() => expect(device()[CART_KEY].lines).toEqual([
      { kind: 'option', id: 12, quantity: 1 },
      { kind: 'option', id: 11, quantity: 3 },
    ]));
  });
});
