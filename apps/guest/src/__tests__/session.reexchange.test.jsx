// specs/guest-app.md rules 1, 4, 9, 22 — the stay link is kept on the device and exchanged again when the server
// says the session is dead; a link the server no longer knows is forgotten; an inactive plugin says so.
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ME_STAY, baseRoutes, renderApp, stubApi } from './guestFixtures';

const device = () => JSON.parse(window.localStorage.getItem('gf-guest') || '{}');

describe('session — the stay link on the device', () => {
  it('rule 1: /s/:token opens the stay, keeps the link and leaves the address bar', async () => {
    const { calls } = stubApi(baseRoutes({ 'POST /sessions': { mode: 'stay', lodging: ME_STAY.lodging } }));
    renderApp('/s/tok-123');
    expect(await screen.findByRole('heading', { name: 'Bonjour Marie' })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/sessions').body).toEqual({ stayToken: 'tok-123' });
    expect(device().stayToken).toBe('tok-123');
  });

  it('rules 4, 9: a dead session is reopened from the stored link once, and the read replayed', async () => {
    window.localStorage.setItem('gf-guest', JSON.stringify({ stayToken: 'tok-123' }));
    let dead = true;
    const { calls } = stubApi(baseRoutes({
      'GET /me': () => (dead ? { status: 401, error: { code: 'SESSION_EXPIRED', message: 'expired' } } : ME_STAY),
      'POST /sessions': () => { dead = false; return { mode: 'stay', lodging: ME_STAY.lodging }; },
    }));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Bonjour Marie' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/sessions')).toHaveLength(1);
  });

  it('rule 1: a link the server no longer knows is forgotten and the generic screen shows', async () => {
    window.localStorage.setItem('gf-guest', JSON.stringify({ stayToken: 'old' }));
    stubApi(baseRoutes({
      'GET /me': { status: 401, error: { code: 'SESSION_EXPIRED' } },
      'GET /lodging': { status: 401, error: { code: 'SESSION_EXPIRED' } },
      'POST /sessions': { status: 404, error: { code: 'CODE_NOT_FOUND', message: 'Ce code n’est pas reconnu.' } },
    }));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Ce code n’est pas reconnu.' })).toBeInTheDocument();
    await waitFor(() => expect(device().stayToken).toBeUndefined());
  });

  it('rule 9: without a link that opens, the lodging poster opens the visitor mode', async () => {
    window.localStorage.setItem('gf-guest', JSON.stringify({ stayToken: 'old', lodgingCode: 'poster' }));
    let visitor = false;
    const { calls } = stubApi(baseRoutes({
      'GET /me': () => (visitor ? { mode: 'visitor', lodging: ME_STAY.lodging, language: 'fr', tiles: [], welcome: 'Bienvenue à La Granja' } : { status: 401, error: { code: 'SESSION_EXPIRED' } }),
      'POST /sessions': (body) => {
        if (body.stayToken) return { status: 404, error: { code: 'CODE_NOT_FOUND' } };
        visitor = true;
        return { mode: 'visitor', lodging: ME_STAY.lodging };
      },
    }));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Bienvenue à La Granja' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/sessions').map((c) => c.body)).toEqual([{ stayToken: 'old' }, { lodgingCode: 'poster' }]);
  });

  it('rule 22: the plugin inactive → « Application indisponible »', async () => {
    stubApi({ 'GET /me': { status: 404, error: 'PLUGIN_INACTIVE' }, 'GET /lodging': { status: 404, error: 'PLUGIN_INACTIVE' } });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Application indisponible' })).toBeInTheDocument();
  });
});
