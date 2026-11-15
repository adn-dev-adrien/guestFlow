// specs/guest-app-home-automation.md rules 17-21 — the « Domotique » page renders what the server wrote: the tile,
// the blocks in order, an unavailable reading, a silent house, the phone offline.
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, stubApi, baseRoutes } from './guestFixtures';
import { HOME, homeRoutes } from './smartHomeFixtures';

describe('Domotique — rendering (rules 17-21)', () => {
  it('the home shows the « Domotique » tile when the server lists it', async () => {
    stubApi(homeRoutes());
    renderApp('/');
    expect(await screen.findByRole('button', { name: /Domotique/ })).toBeInTheDocument();
  });

  it('the page shows outdoors, the rooms, the lights, the rain and the electricity, as written by the server', async () => {
    stubApi(homeRoutes());
    renderApp('/domotique');
    expect(await screen.findByText('8,5')).toBeInTheDocument();
    expect(screen.getByText('min 4° · max 12,5°')).toBeInTheDocument();
    expect(screen.getByText(/En direct · il y a 1 min/)).toBeInTheDocument();
    expect(screen.getByText('21,4')).toBeInTheDocument();
    expect(screen.getByLabelText('en hausse')).toBeInTheDocument();
    expect(screen.getByText('Mesure indisponible')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Le chêne' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Consultation')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Pluie heure par heure sur 24 heures' })).toBeInTheDocument();
    expect(screen.getByText('740 W')).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Pièces', 'Éclairage', 'Pluie', 'Électricité']);
  });

  it('a silent house: the header says « Dernière mesure », a banner dates it', async () => {
    stubApi(homeRoutes({ 'GET /home': { ...HOME, live: false, updated: 'à 20 h 50' } }));
    renderApp('/domotique');
    expect(await screen.findByText(/Dernière mesure · à 20 h 50/)).toBeInTheDocument();
    expect(screen.getByText('Plus de nouvelles de la maison : dernière mesure à 20 h 50.')).toBeInTheDocument();
  });

  it('offline: « Hors connexion » and the switches are disabled', async () => {
    stubApi(homeRoutes());
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    try {
      renderApp('/domotique');
      const banner = await screen.findByText(/Hors connexion : dernières valeurs connues/);
      expect(banner).toBeInTheDocument();
      expect(screen.getByRole('switch', { name: 'Le chêne' })).toBeDisabled();
    } finally {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    }
  });

  it('without the module the page is never mounted: no read of /home, no « Domotique » title', async () => {
    const { calls } = stubApi(baseRoutes());
    renderApp('/domotique');
    await waitFor(() => expect(calls.some((c) => c.path === '/me')).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.path === '/lodging')).toBe(true));
    expect(calls.some((c) => c.path === '/home')).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Domotique' })).toBeNull();
  });

  it('a page without an outdoor block opens on the lodging’s name', async () => {
    stubApi(homeRoutes({ 'GET /home': { ...HOME, blocks: HOME.blocks.filter((b) => b.kind !== 'outdoor') } }));
    renderApp('/domotique');
    const hero = await screen.findByRole('heading', { level: 1, name: 'La Granja' });
    expect(within(hero.closest('.sh-hero')).queryByText('Dehors')).toBeNull();
  });
});
