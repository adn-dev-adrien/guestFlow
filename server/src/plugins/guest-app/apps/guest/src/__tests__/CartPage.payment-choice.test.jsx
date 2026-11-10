// specs/guest-app.md rules 32, 33, 35, 37quater, 41bis — the cart's total is the quote, the payment choice follows
// what the server allows, the button carries the total, pickup mode asks « récupérer ».
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SHOP, baseRoutes, renderApp, stubApi } from './guestFixtures';

const QUOTE = { lines: [{ kind: 'option', id: 11, title: 'Cidre', quantity: 2, total: 9, totalLabel: '9 €' }], total: 9, totalLabel: '9 €', needsDelivery: false };

function seedCart(lines) {
  window.localStorage.setItem('gf-guest', JSON.stringify({ 'cart:1:2099-07-06T16:00:00+02:00': { lines, meta: { 'option:11': { title: 'Cidre', max: 10 } } } }));
}

describe('cart — payment choice and the server total', () => {
  it('rules 33, 86: both ways offered in one radio group, « Payer par carte » first and selected; the button follows the choice with the server total', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 2 }]);
    stubApi(baseRoutes({ 'POST /orders/quote': QUOTE }));
    renderApp('/panier');
    await screen.findByRole('button', { name: 'Payer 9 €' });
    const [first, second] = screen.getAllByRole('radio');
    expect(first).toHaveTextContent('Payer par carte');
    expect(first).toHaveAttribute('aria-checked', 'true');
    expect(second).toHaveAttribute('aria-checked', 'false');
    expect(first.className).toBe(second.className);
    fireEvent.click(screen.getByRole('radio', { name: /Ajouter à ma note/ }));
    expect(await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Payer 9 €' })).toBeNull();
  });

  it('rules 67, 86: before the arrival the note reads the server\'s words and the card is still first', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 2 }]);
    stubApi(baseRoutes({ 'GET /shop': { ...SHOP, noteLabel: 'Régler à l’arrivée' }, 'POST /orders/quote': QUOTE }));
    renderApp('/panier');
    await screen.findByRole('button', { name: 'Payer 9 €' });
    fireEvent.click(screen.getByRole('radio', { name: /Régler à l’arrivée/ }));
    expect(await screen.findByRole('button', { name: 'Régler à l’arrivée · 9 €' })).toBeEnabled();
  });

  it('rule 33: card unavailable → the note is stated, not offered', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 2 }]);
    stubApi(baseRoutes({ 'GET /shop': { ...SHOP, canPayCard: false }, 'POST /orders/quote': QUOTE }));
    renderApp('/panier');
    await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('Ajouter à ma note')).toBeInTheDocument();
  });

  it('rule 25: a 0 € quote needs no payment: « Réserver »', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 1 }]);
    stubApi(baseRoutes({ 'POST /orders/quote': { ...QUOTE, total: 0, totalLabel: '0 €' } }));
    renderApp('/panier');
    expect(await screen.findByRole('button', { name: 'Réserver' })).toBeEnabled();
    expect(screen.queryByText('Paiement')).toBeNull();
  });

  it('rule 37quater: a line beyond the stock comes back lowered, with the server words', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 4 }]);
    stubApi(baseRoutes({ 'POST /orders/quote': (body) => ({
      ...QUOTE,
      lines: [{ ...QUOTE.lines[0], quantity: body.lines[0].quantity, ...(body.lines[0].quantity > 2 ? { outOfStock: { left: 2, label: 'Plus que 2 disponibles' } } : {}) }],
    }) }));
    renderApp('/panier');
    expect(await screen.findByText('Plus que 2 disponibles')).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.stepper b')).toHaveTextContent('2'));
  });

  it('rule 41bis: in pickup mode the cart asks « Quand souhaitez-vous la récupérer ? » and preselects « Dès que possible »', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 2 }]);
    stubApi(baseRoutes({
      'POST /orders/quote': { ...QUOTE, needsDelivery: true },
      'POST /shop/delivery-slots': {
        needed: true, mode: 'pickup', asap: { at: '2099-07-07T15:30:00.000Z', label: 'Dès que possible — vers 17 h 30' },
        days: [{ date: '2099-07-07', label: 'Aujourd’hui', available: true, times: [{ at: '2099-07-07T15:30:00.000Z', label: '17 h 30' }, { at: '2099-07-07T16:00:00.000Z', label: '18 h' }] }],
      },
    }));
    renderApp('/panier');
    expect(await screen.findByRole('heading', { name: 'Quand souhaitez-vous la récupérer ?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dès que possible — vers 17 h 30' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('rule 33: « Ajouter à ma note » orders with the note and opens the confirmation', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 2 }]);
    const { calls } = stubApi(baseRoutes({
      'POST /orders/quote': QUOTE,
      'POST /orders': { orderId: 7, status: 'confirmed' },
      'GET /orders/7': { id: 7, createdAt: '2099-07-07T10:00:00.000Z', lines: [{ label: '2 × Cidre', totalLabel: '9 €' }], totalLabel: '9 €', payment: 'note', status: 'confirmed', statusLabel: 'Sur votre note', promise: 'Livrée à La Granja aujourd’hui vers 17 h 30.' },
    }));
    renderApp('/panier');
    await screen.findByRole('button', { name: 'Payer 9 €' });
    fireEvent.click(screen.getByRole('radio', { name: /Ajouter à ma note/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' }));
    expect(await screen.findByRole('heading', { name: 'Commande envoyée' })).toBeInTheDocument();
    expect(screen.getByText('Livrée à La Granja aujourd’hui vers 17 h 30.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.path === '/orders').body).toMatchObject({ payment: 'note', lines: [{ kind: 'option', id: 11, quantity: 2 }] });
  });
});
