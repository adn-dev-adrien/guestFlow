// specs/guest-app-home-automation.md rules 8, 22 — a tap on a light: the switch moves on the press, the house
// confirms (the page is read again), or the switch goes back with the reason.
import { act, fireEvent, screen } from '@testing-library/react';
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { renderApp, stubApi } from './guestFixtures';
import { HOME, homeRoutes } from './smartHomeFixtures';

const lit = { ...HOME, blocks: HOME.blocks.map((b) => (b.kind === 'lights' ? { ...b, items: b.items.map((l) => (l.id === 'l1' ? { ...l, on: true, status: 'Allumé' } : l)) } : b)) };

describe('Domotique — the lights (rules 8, 22)', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it('pending on the press, then the house’s state once it confirms', async () => {
    let confirmed = false;
    const { calls } = stubApi(homeRoutes({
      'GET /home': () => (confirmed ? lit : HOME),
      'POST /home/lights/l1': { id: 7, state: 'pending', on: true },
      'GET /home/commands/7': () => { confirmed = true; return { id: 7, state: 'done', on: true }; },
    }));
    renderApp('/domotique');
    const sw = await screen.findByRole('switch', { name: 'Le chêne' });
    fireEvent.click(sw);
    expect(await screen.findByText('Allumage…')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Le chêne' })).toHaveAttribute('aria-checked', 'true');
    expect(calls.find((c) => c.method === 'POST').body).toEqual({ on: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(await screen.findAllByText('Allumé')).toHaveLength(2);
    expect(screen.getByRole('switch', { name: 'Le chêne' })).toHaveAttribute('aria-checked', 'true');
  });

  it('expired: the switch goes back and says the house is not answering', async () => {
    stubApi(homeRoutes({
      'POST /home/lights/l1': { id: 8, state: 'pending', on: true },
      'GET /home/commands/8': { id: 8, state: 'expired', on: true, message: 'La maison ne répond pas. Réessayer dans un instant.' },
    }));
    renderApp('/domotique');
    fireEvent.click(await screen.findByRole('switch', { name: 'Le chêne' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(await screen.findByText('La maison ne répond pas. Réessayer dans un instant.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Le chêne' })).toHaveAttribute('aria-checked', 'false');
  });

  it('too many taps: the refusal in words, nothing pending', async () => {
    stubApi(homeRoutes({
      'POST /home/lights/l1': { status: 429, error: { code: 'TOO_MANY_REQUESTS', message: 'Trop de demandes. Réessayer dans quelques minutes.' } },
    }));
    renderApp('/domotique');
    fireEvent.click(await screen.findByRole('switch', { name: 'Le chêne' }));
    expect(await screen.findByText('Trop de demandes. Réessayer dans quelques minutes.')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Le chêne' })).not.toBeDisabled();
  });
});
