// specs/guest-app.md rules 33, 35 and §4.3 (`Idempotency-Key`) — an order sent again after a lost answer carries the
// same key, so the server answers the first order instead of creating a second; a changed cart is a new key. An
// unpaid card order whose link is still live offers « Reprendre le paiement ».
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, describe, expect, it, vi,
} from 'vitest';
import { OFFLINE, baseRoutes, renderApp, stubApi } from './guestFixtures';
import { useOrderStatus } from '../hooks/useOrderStatus';

vi.mock('../hooks/useOrderStatus', () => ({ useOrderStatus: vi.fn() }));

const QUOTE = { lines: [{ kind: 'option', id: 11, title: 'Cidre', quantity: 2, total: 9, totalLabel: '9 €' }], total: 9, totalLabel: '9 €', needsDelivery: false };
const seedCart = (lines) => window.localStorage.setItem('gf-guest', JSON.stringify({ 'cart:1:2099-07-06T16:00:00+02:00': { lines, meta: { 'option:11': { title: 'Cidre', max: 10 } } } }));
const keysSent = (fetchStub) => fetchStub.mock.calls
  .filter(([url, init = {}]) => String(url).endsWith('/orders') && init.method === 'POST')
  .map(([, init]) => init.headers['Idempotency-Key']);

afterEach(() => { vi.unstubAllGlobals(); });

describe('an order is created once (§4.3 Idempotency-Key)', () => {
  it('the order sent again after a network failure carries the same key', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 2 }]);
    let tries = 0;
    const { fetchStub } = stubApi(baseRoutes({
      'POST /orders/quote': QUOTE,
      'POST /orders': () => { tries += 1; return tries === 1 ? OFFLINE : { orderId: 7, status: 'confirmed' }; },
      'GET /orders/7': { id: 7, lines: [], totalLabel: '9 €', payment: 'note', status: 'confirmed', statusLabel: 'Sur votre note' },
    }));
    useOrderStatus.mockReturnValue({ order: null, error: null, polling: false, stalled: false, recheck: vi.fn() });
    renderApp('/panier');
    const button = await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' });
    fireEvent.click(button);
    await waitFor(() => expect(tries).toBe(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' }));
    await waitFor(() => expect(tries).toBe(2));
    const keys = keysSent(fetchStub);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[A-Za-z0-9._:-]{8,100}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('the first send still being written (ORDER_IN_PROGRESS) keeps the key: the next tap is the same order', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 2 }]);
    let tries = 0;
    const { fetchStub } = stubApi(baseRoutes({
      'POST /orders/quote': QUOTE,
      'POST /orders': () => { tries += 1; return { status: 409, error: { code: 'ORDER_IN_PROGRESS', message: 'Cette commande est en cours d’enregistrement.' } }; },
    }));
    useOrderStatus.mockReturnValue({ order: null, error: null, polling: false, stalled: false, recheck: vi.fn() });
    renderApp('/panier');
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' }));
    await waitFor(() => expect(tries).toBe(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' }));
    await waitFor(() => expect(tries).toBe(2));
    const keys = keysSent(fetchStub);
    expect(keys[1]).toBe(keys[0]);
  });

  it('an order refused for a reason other than the network gets a new key next time', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 2 }]);
    let tries = 0;
    const { fetchStub } = stubApi(baseRoutes({
      'POST /orders/quote': QUOTE,
      'POST /orders': () => { tries += 1; return { status: 409, error: { code: 'SHOP_CLOSED', message: 'La boutique est fermée.' } }; },
    }));
    useOrderStatus.mockReturnValue({ order: null, error: null, polling: false, stalled: false, recheck: vi.fn() });
    renderApp('/panier');
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' }));
    await waitFor(() => expect(tries).toBe(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' }));
    await waitFor(() => expect(tries).toBe(2));
    const keys = keysSent(fetchStub);
    expect(keys[1]).not.toBe(keys[0]);
  });
});

describe('an unpaid card order (rules 33, 35)', () => {
  const ORDER = {
    id: 42, status: 'awaiting_payment', statusLabel: 'Paiement en attente', payment: 'card', lines: [{ label: '2 × Cidre', totalLabel: '9 €' }], totalLabel: '9 €', fulfilment: 'delivery',
  };

  it('offers « Reprendre le paiement » while its link is live, and opens it', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    useOrderStatus.mockReturnValue({ order: { ...ORDER, paymentUrl: 'https://pay.example.test/l/abc' }, error: null, polling: false, stalled: false, recheck: vi.fn() });
    stubApi(baseRoutes());
    renderApp('/commandes/42');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Reprendre le paiement' }));
    expect(assign).toHaveBeenCalledWith('https://pay.example.test/l/abc');
  });

  it('without a live link there is nothing to resume', async () => {
    useOrderStatus.mockReturnValue({ order: ORDER, error: null, polling: false, stalled: false, recheck: vi.fn() });
    stubApi(baseRoutes());
    renderApp('/commandes/42');
    await screen.findByRole('button', { name: 'Abandonner et revenir au panier' });
    expect(screen.queryByRole('button', { name: 'Reprendre le paiement' })).toBeNull();
  });
});
