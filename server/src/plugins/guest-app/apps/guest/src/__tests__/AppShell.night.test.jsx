// specs/guest-app.md §6.1 night register, rule 53 — night from the server's sunset (`isNight`) or the device's dark
// scheme, unless the guest chose; the choice stays on the device; the tokens follow on the .app root.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME_STAY, baseRoutes, renderApp, stubApi } from './guestFixtures';
import { TOKENS } from '../theme';

const app = () => document.querySelector('.app');

function prefersDark(dark) {
  vi.stubGlobal('matchMedia', vi.fn((query) => ({
    matches: dark && query.includes('dark'), media: query, addEventListener: () => {}, removeEventListener: () => {},
  })));
  window.matchMedia = globalThis.matchMedia;
}

describe('night register', () => {
  afterEach(() => prefersDark(false));

  it('day by default: the day tokens on the root', async () => {
    prefersDark(false);
    stubApi(baseRoutes());
    renderApp('/');
    await screen.findByRole('heading', { name: 'Bonjour Marie' });
    expect(app()).not.toHaveClass('night');
    expect(app().style.getPropertyValue('--paper')).toBe(TOKENS.day.paper);
  });

  it('the server says it is night → night tokens', async () => {
    prefersDark(false);
    stubApi(baseRoutes({ 'GET /me': { ...ME_STAY, isNight: true } }));
    renderApp('/');
    await waitFor(() => expect(app()).toHaveClass('night'));
    expect(app().style.getPropertyValue('--action')).toBe(TOKENS.night.action);
  });

  it('the device asks for dark → night, and « Passer en jour » wins and is remembered', async () => {
    prefersDark(true);
    stubApi(baseRoutes());
    renderApp('/');
    await waitFor(() => expect(app()).toHaveClass('night'));
    fireEvent.click(screen.getByRole('button', { name: 'Passer en jour' }));
    expect(app()).not.toHaveClass('night');
    expect(JSON.parse(window.localStorage.getItem('gf-guest')).register).toBe('day');
  });

  it('rule 19: switching to English re-reads the session in English and switches `lang`', async () => {
    prefersDark(false);
    const { calls } = stubApi(baseRoutes());
    renderApp('/');
    await screen.findByRole('heading', { name: 'Bonjour Marie' });
    fireEvent.click(screen.getByRole('button', { name: /English/ }));
    expect(await screen.findByRole('heading', { name: 'Hello Marie' })).toBeInTheDocument();
    expect(app()).toHaveAttribute('lang', 'en');
    expect(calls.some((c) => c.path === '/me' && c.url.includes('lang=en'))).toBe(true);
  });
});
