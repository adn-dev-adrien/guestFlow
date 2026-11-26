// specs/guest-app/guest-app-bath-home-scheduling.md rules 8-14 — the scheduling screen: no switch for one hour, « À la suite » reads the
// server's blocks of N hours, « Réparties » the slot grid with its counter; a tap beyond the count is refused in place with the
// two ways out, and « ajoutez une heure » raises the extra hours and takes the slot.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { baseRoutes, renderApp, stubApi } from './guestFixtures';
import {
  BLOCKS, SHOP_BATH, SLOTS, card, meWith, quoteOf,
} from './bathPlanFixtures';

const routes = (cards, over = {}) => baseRoutes({
  'GET /me': meWith(cards),
  'GET /shop': SHOP_BATH,
  'GET /shop/resources/5/slots': SLOTS,
  'GET /shop/resources/5/blocks': BLOCKS,
  'POST /orders/quote': quoteOf(0, [{ key: 'offered', label: 'Offerte · 1 h', amount: 0, amountLabel: '0 €' }]),
  ...over,
});
const THREE = card({ title: '3 h à programmer', ownedMinutes: 180, offeredMinutes: 60, heldMinutes: 120 });

describe('bath scheduling — modes', () => {
  it('one hour: no mode switch, the slot grid', async () => {
    stubApi(routes([card()]));
    renderApp('/bain/programmer/5');
    expect(await screen.findByText('16 h – 17 h')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'À la suite' })).toBeNull();
  });

  it('three hours: « À la suite » first, its blocks asked with hours=3; « Réparties » shows the counter', async () => {
    const { calls } = stubApi(routes([THREE]));
    renderApp('/bain/programmer/5');
    expect(await screen.findByText('20 h – 22 h')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'À la suite' })).toHaveAttribute('aria-pressed', 'true');
    expect(calls.find((c) => c.path === '/shop/resources/5/blocks').url).toContain('hours=3');
    fireEvent.click(screen.getByRole('button', { name: 'Réparties' }));
    expect(await screen.findByText('0 sur 3')).toBeInTheDocument();
  });

  it('no block of N hours on any day: says so and offers to spread them', async () => {
    stubApi(routes([THREE], { 'GET /shop/resources/5/blocks': { open: true, hours: 3, days: [] } }));
    renderApp('/bain/programmer/5');
    fireEvent.click(await screen.findByRole('button', { name: 'Les répartir sur le séjour' }));
    expect(await screen.findByText('0 sur 3')).toBeInTheDocument();
  });

  it('rule 11 — beyond the count: refused in place, « ajoutez une heure » raises the stepper and takes the slot', async () => {
    stubApi(routes([card()]));
    renderApp('/bain/programmer/5');
    fireEvent.click(await screen.findByText('16 h – 17 h'));
    expect(screen.getByText('1 sur 1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('17 h – 18 h'));
    expect(screen.getByRole('alert')).toHaveTextContent('1 sur 1 déjà choisies — retirez-en une ou ajoutez une heure');
    expect(screen.getByText('17 h – 18 h').closest('button')).toHaveClass('refused');
    fireEvent.click(screen.getByRole('button', { name: 'ajoutez une heure' }));
    expect(screen.getByText('2 sur 2')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Heures en plus' })).toHaveTextContent('1');
  });
});
