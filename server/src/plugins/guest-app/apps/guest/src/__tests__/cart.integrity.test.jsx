// specs/guest-app.md rules 24, 29, 32, 37quater — the cart only orders what the server has just priced: a quote
// that failed leaves no total to commit; a bath session no longer free is removed on its own and blocks the order
// until it is, and never reaches the cart from the slots; an article's bound counts what the cart already holds.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  ME_STAY, SHOP, baseRoutes, item, renderApp, stubApi,
} from './guestFixtures';
import { mergeLine } from '../hooks/useCart';

const CART_KEY = `cart:1:${ME_STAY.stay.arrival}`;
const device = () => JSON.parse(window.localStorage.getItem('gf-guest') || '{}');
const seedCart = (lines, meta = {}) => window.localStorage.setItem('gf-guest', JSON.stringify({ [CART_KEY]: { lines, meta } }));

const S1 = { date: '2099-07-07', start: '17:00', end: '18:00' };
const S2 = { date: '2099-07-07', start: '20:00', end: '21:00' };
const BATH = item({ kind: 'resource', id: 5, title: 'Bain nordique', scheduling: 'hourly', priceLabel: '30 €' });
const sessionsQuote = (sessions) => ({
  lines: [{
    kind: 'resource',
    id: 5,
    title: 'Bain nordique',
    total: 30,
    totalLabel: '30 €',
    sessions: sessions.map((s) => ({
      ...s, label: `mar. 7 juil. ${s.start}`, ...(s.start === '20:00' ? { unavailable: true, reasonLabel: 'Ce créneau vient d’être pris' } : {}),
    })),
  }],
  total: 30,
  totalLabel: '30 €',
});

describe('cart — a failed quote (rule 32)', () => {
  it('leaves no total to order: the button waits for a quote that succeeds', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 2 }], { 'option:11': { title: 'Cidre', max: 10 } });
    stubApi(baseRoutes({ 'GET /shop': { ...SHOP, canPayCard: false },
      'POST /orders/quote': (body) => (body.lines[0].quantity === 2
        ? { lines: [{ kind: 'option', id: 11, title: 'Cidre', quantity: 2, total: 9, totalLabel: '9 €' }], total: 9, totalLabel: '9 €' }
        : { status: 500, error: { code: 'QUOTE_FAILED', message: 'Le total n’a pas pu être calculé.' } }),
    }));
    renderApp('/panier');
    const user = userEvent.setup();
    expect(await screen.findByRole('button', { name: 'Ajouter à ma note · 9 €' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Plus' }));
    expect(await screen.findByText('Le total n’a pas pu être calculé.')).toBeInTheDocument();
    expect(screen.queryByText('9 €', { selector: '.total b' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Ajouter à ma note/ })).toBeDisabled();
  });
});

describe('cart — a bath session no longer free (rule 29)', () => {
  it('blocks the order, is removed on its own, and the order opens again', async () => {
    seedCart([{ kind: 'resource', id: 5, sessions: [S1, S2] }], { 'resource:5': { title: 'Bain nordique' } });
    stubApi(baseRoutes({ 'GET /shop': { ...SHOP, canPayCard: false }, 'POST /orders/quote': (body) => sessionsQuote(body.lines[0].sessions) }));
    renderApp('/panier');
    const user = userEvent.setup();
    expect(await screen.findByText('Retirez d’abord ce qui n’est plus disponible.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Ajouter à ma note/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Retirer mar. 7 juil. 20:00' }));
    await waitFor(() => expect(device()[CART_KEY].lines).toEqual([{ kind: 'resource', id: 5, sessions: [S1] }]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ajouter à ma note · 30 €' })).toBeEnabled());
    expect(screen.queryByText('Retirez d’abord ce qui n’est plus disponible.')).toBeNull();
  });

  it('from the slots, only the sessions still free go to the cart', async () => {
    seedCart([{ kind: 'resource', id: 5, sessions: [S1, S2] }], { 'resource:5': { title: 'Bain nordique' } });
    stubApi(baseRoutes({
      'GET /shop': { ...SHOP, categories: [{ name: 'Bien-être', items: [BATH] }] },
      'GET /shop/resources/5/slots': { days: [{ date: '2099-07-07', label: 'mar. 7 juil.', available: true, slots: [{ start: '17:00', end: '18:00', state: 'free', priceLabel: '30 €' }] }] },
      'POST /orders/quote': (body) => sessionsQuote(body.lines[0].sessions),
    }));
    renderApp('/boutique/bain/5');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce créneau vient d’être pris');
    await userEvent.setup().click(screen.getByRole('button', { name: /^Ajouter · 30 €/ }));
    await waitFor(() => expect(device()[CART_KEY].lines).toEqual([{ kind: 'resource', id: 5, sessions: [S1] }]));
  });
});

describe('cart — the article bound counts what the cart holds (rules 24, 37quater)', () => {
  it('the sheet lets add only what is left of the bound', async () => {
    seedCart([{ kind: 'option', id: 11, quantity: 9 }], { 'option:11': { title: 'Cidre', max: 10 } });
    stubApi(baseRoutes({ 'GET /shop': { ...SHOP, canPayCard: false }, 'POST /orders/quote': (body) => ({ lines: body.lines.map((l) => ({ ...l, title: 'Cidre', totalLabel: '4,50 €' })), total: 4.5, totalLabel: '4,50 €' }) }));
    renderApp('/boutique');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Cidre, 4,50 €/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Plus' })).toBeDisabled();
    expect(within(sheet).getByText('10 au maximum par commande.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: /^Ajouter/ }));
    await waitFor(() => expect(device()[CART_KEY].lines).toEqual([{ kind: 'option', id: 11, quantity: 10 }]));
  });

  it('mergeLine never adds past the bound, and never lowers what is there', () => {
    const cart = [{ kind: 'option', id: 11, quantity: 9 }];
    expect(mergeLine(cart, { kind: 'option', id: 11, quantity: 3 }, 10)).toEqual([{ kind: 'option', id: 11, quantity: 10 }]);
    expect(mergeLine([], { kind: 'option', id: 11, quantity: 12 }, 10)).toEqual([{ kind: 'option', id: 11, quantity: 10 }]);
    expect(mergeLine([{ kind: 'option', id: 11, quantity: 12 }], { kind: 'option', id: 11, quantity: 1 }, 10)).toEqual([{ kind: 'option', id: 11, quantity: 12 }]);
    expect(mergeLine(cart, { kind: 'option', id: 11, quantity: 3 })).toEqual([{ kind: 'option', id: 11, quantity: 12 }]);
  });
});
