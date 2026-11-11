// specs/guest-app.md rule 63 (audit R37-C-L1) — the plugin switched off while a guest has the app open: any read
// answered 404 `PLUGIN_INACTIVE` (the loader's bare code) shows the « app unavailable » screen, in the guest's
// language, never the raw code under « Réessayer ». `gate-access` switched off (`/gate` names that plugin) leaves the
// app open.
import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { baseRoutes, renderApp, stubApi } from './guestFixtures';

const INACTIVE = { status: 404, error: 'PLUGIN_INACTIVE', plugin: 'guest-app' };

describe('session — the plugin switched off mid-visit (rule 63)', () => {
  it('« Commandes » answered PLUGIN_INACTIVE shows « Application indisponible », not the code', async () => {
    stubApi(baseRoutes({ 'GET /orders': INACTIVE }));
    renderApp('/commandes');
    expect(await screen.findByRole('heading', { name: 'Application indisponible' })).toBeInTheDocument();
    expect(screen.queryByText('PLUGIN_INACTIVE')).not.toBeInTheDocument();
  });

  it('« Livret » answered PLUGIN_INACTIVE shows the screen in English for an English guest', async () => {
    window.localStorage.setItem('gf-guest', JSON.stringify({ lang: 'en' }));
    stubApi(baseRoutes({ 'GET /booklet': INACTIVE }));
    renderApp('/livret');
    expect(await screen.findByRole('heading', { name: 'App unavailable' })).toBeInTheDocument();
    expect(screen.queryByText('PLUGIN_INACTIVE')).not.toBeInTheDocument();
  });

  it('`/gate` answered PLUGIN_INACTIVE for gate-access keeps the app open', async () => {
    const { calls } = stubApi(baseRoutes({ 'GET /gate': { status: 404, error: 'PLUGIN_INACTIVE', plugin: 'gate-access' } }));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Bonjour Marie' })).toBeInTheDocument();
    // The negative check is only worth something once the `/gate` answer has been read (verification R37 N2).
    await waitFor(() => expect(calls.some((c) => c.method === 'GET' && c.path === '/gate')).toBe(true));
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
    expect(screen.queryByRole('heading', { name: 'Application indisponible' })).not.toBeInTheDocument();
  });
});
