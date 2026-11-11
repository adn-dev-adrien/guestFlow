// specs/guest-app.md rules 1, 4, 9, 21 and the edge case « stay cancelled mid-cart » — a stay link opened without
// network is kept and « Réessayer » opens it; a session re-exchanged mid-use is read again (`/me`, `/lodging`), a
// stay that came back as a visitor or did not come back at all clears the cart and empties the offline data.
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  ME_STAY, OFFLINE, baseRoutes, renderApp, stubApi,
} from './guestFixtures';

const device = () => JSON.parse(window.localStorage.getItem('gf-guest') || '{}');
const CART_KEY = `cart:1:${ME_STAY.stay.arrival}`;
const VISITOR = { mode: 'visitor', lodging: ME_STAY.lodging, language: 'fr', tiles: [], welcome: 'Bienvenue à La Granja' };

let postMessage;
beforeEach(() => {
  postMessage = vi.fn();
  Object.defineProperty(navigator, 'serviceWorker', { value: { controller: { postMessage } }, configurable: true });
});
afterEach(() => { delete navigator.serviceWorker; });

describe('session — the stay link opened without network (rule 1)', () => {
  it('keeps the link, stays on the page, and « Réessayer » opens the stay', async () => {
    let online = false;
    const { calls } = stubApi(baseRoutes({
      'POST /sessions': () => (online ? { mode: 'stay', lodging: ME_STAY.lodging } : OFFLINE),
    }));
    renderApp('/s/tok-9');
    expect(await screen.findByText('Pas de réseau. Réessayez dans un instant.')).toBeInTheDocument();
    expect(device().stayToken).toBe('tok-9');
    expect(screen.getByRole('heading', { name: 'Ouverture de votre séjour' })).toBeInTheDocument();

    online = true;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('heading', { name: 'Bonjour Marie' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/sessions').map((c) => c.body)).toEqual([{ stayToken: 'tok-9' }, { stayToken: 'tok-9' }]);
    expect(device().stayToken).toBe('tok-9');
  });
});

describe('session — re-exchanged mid-use (rules 4, 9)', () => {
  function seed() {
    window.localStorage.setItem('gf-guest', JSON.stringify({
      stayToken: 'tok-123',
      [CART_KEY]: { lines: [{ kind: 'option', id: 11, quantity: 2 }], meta: {} },
    }));
  }

  it('a 401 that reopens the link as a visitor (stay cancelled) shows the visitor mode, clears the cart and the offline data', async () => {
    seed();
    let state = 'stay';
    stubApi(baseRoutes({
      'GET /me': () => (state === 'stay' ? ME_STAY : VISITOR),
      // The stay is cancelled while the guest reads: the next read finds the session dead.
      'GET /booklet': () => (state === 'stay' ? { status: 401, error: { code: 'SESSION_EXPIRED' } } : { version: 1, pages: [] }),
      'POST /sessions': () => { state = 'visitor'; return { mode: 'visitor', lodging: ME_STAY.lodging }; },
    }));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Bienvenue à La Granja' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bonjour Marie' })).not.toBeInTheDocument();
    await waitFor(() => expect(device()[CART_KEY]).toBeUndefined());
    expect(device().stayToken).toBe('tok-123');
    expect(postMessage).toHaveBeenCalledWith({ type: 'purge' });
  });

  it('a 401 that nothing on the device reopens shows « Ce code n’est pas reconnu », clears the cart and the offline data', async () => {
    seed();
    stubApi(baseRoutes({
      'GET /booklet': { status: 401, error: { code: 'SESSION_EXPIRED' } },
      'POST /sessions': { status: 404, error: { code: 'CODE_NOT_FOUND', message: 'Ce code n’est pas reconnu.' } },
    }));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Ce code n’est pas reconnu.' })).toBeInTheDocument();
    await waitFor(() => expect(device()[CART_KEY]).toBeUndefined());
    expect(device().stayToken).toBeUndefined();
    expect(postMessage).toHaveBeenCalledWith({ type: 'purge' });
  });

  it('a 401 met without network keeps the stay on screen and the link on the device', async () => {
    seed();
    stubApi(baseRoutes({
      'GET /booklet': { status: 401, error: { code: 'SESSION_EXPIRED' } },
      'POST /sessions': OFFLINE,
    }));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Bonjour Marie' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Ce code n’est pas reconnu.' })).not.toBeInTheDocument());
    expect(device().stayToken).toBe('tok-123');
    expect(device()[CART_KEY]).toBeTruthy();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
