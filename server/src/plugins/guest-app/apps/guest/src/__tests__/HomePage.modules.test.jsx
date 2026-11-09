// specs/guest-app.md rules 10, 11bis, 13, 51 — the home draws the lodging's tiles in its order, the gate tile only
// while it can act, and the tab bar follows the same modules.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LODGING, ME_STAY, baseRoutes, renderApp, stubApi } from './guestFixtures';

describe('home — the lodging decides what its guests see', () => {
  it('draws the server tiles, in the server order, and greets the guest by first name', async () => {
    stubApi(baseRoutes());
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Bonjour Marie' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Portail' })).toBeInTheDocument());
    const labels = [...document.querySelectorAll('.tiles .tile')].map((tile) => tile.textContent.trim());
    expect(labels).toEqual(['Portail', 'Wifi', 'Boutique', 'Livret']);
  });

  it('rule 13: before the key exists the gate tile reads « Accès en préparation » and is not a button', async () => {
    stubApi(baseRoutes({ 'GET /gate': { state: 'preparing' } }));
    renderApp('/');
    await screen.findByText('Accès en préparation');
    const gate = screen.getByText('Accès en préparation').closest('.tile');
    expect(gate).toHaveAttribute('aria-disabled', 'true');
    expect(gate.tagName).toBe('DIV');
  });

  it('rule 13: outside the gate window the tile is absent', async () => {
    stubApi(baseRoutes({ 'GET /gate': { state: 'outside' } }));
    renderApp('/');
    await screen.findByRole('heading', { name: 'Bonjour Marie' });
    await waitFor(() => expect(document.querySelector('.tiles').textContent).not.toMatch(/Portail/));
    expect(document.querySelector('.tiles').textContent).toMatch(/Wifi/);
  });

  it('rule 11bis: no « Boutique » tab in a lodging without shop', async () => {
    const lodging = { ...LODGING, modules: LODGING.modules.filter((m) => m.key !== 'shop') };
    const me = { ...ME_STAY, tiles: ME_STAY.tiles.filter((t) => t.key !== 'shop') };
    stubApi(baseRoutes({ 'GET /me': me, 'GET /lodging': lodging }));
    renderApp('/');
    const nav = await screen.findByRole('navigation', { name: 'Navigation' });
    expect(within(nav).queryByText('Boutique')).toBeNull();
    expect(within(nav).getByText('Livret')).toBeInTheDocument();
  });

  it('rules 3, 5: the visitor home tells nothing of a stay and offers to find one', async () => {
    stubApi(baseRoutes({
      'GET /me': { mode: 'visitor', lodging: ME_STAY.lodging, language: 'fr', tiles: [{ key: 'booklet', label: 'Livret', order: 0 }], welcome: 'Bienvenue à La Granja' },
      'GET /lodging': { ...LODGING, modules: [{ key: 'booklet', label: 'Livret', order: 0 }] },
    }));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Bienvenue à La Granja' })).toBeInTheDocument();
    expect(screen.getByText('Vous séjournez ici ? Retrouver mon séjour')).toBeInTheDocument();
    expect(document.querySelector('.stay')).toBeNull();
  });

  it('rule 11: the highlight is the server one, with its words', async () => {
    stubApi(baseRoutes({ 'GET /me': { ...ME_STAY, highlight: { key: 'departure', text: 'Départ demain : les consignes', module: 'booklet', page: 'depart' } } }));
    renderApp('/');
    expect(await screen.findByText('Départ demain : les consignes')).toBeInTheDocument();
    expect(screen.getByText('Demain')).toBeInTheDocument();
  });
});
