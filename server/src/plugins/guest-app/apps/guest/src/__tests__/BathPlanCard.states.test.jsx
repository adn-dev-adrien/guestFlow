// specs/guest-app/guest-app-bath-home-scheduling.md rules 4-6, 21, Q1, Q2 — the home's bath card: its three states from `/me`, its place (under the
// stay card while hours are to schedule, after the tiles otherwise), its buttons stacked, and where each one leads.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { baseRoutes, renderApp, stubApi } from './guestFixtures';
import {
  BLOCKS, SHOP_BATH, SLOTS, card, meWith,
} from './bathPlanFixtures';

const routes = (cards) => baseRoutes({
  'GET /me': meWith(cards), 'GET /shop': SHOP_BATH, 'GET /shop/resources/5/slots': SLOTS, 'GET /shop/resources/5/blocks': BLOCKS,
});

const order = () => [...document.querySelectorAll('.bathcard, .tiles')].map((el) => (el.classList.contains('bathcard') ? 'bath' : 'tiles'));

describe('bath card on the home', () => {
  it('to schedule: the server words, one button, above the tiles; « Programmer » opens the scheduling screen', async () => {
    stubApi(routes([card()]));
    renderApp('/');
    expect(await screen.findByText('1 h offerte à programmer')).toBeInTheDocument();
    expect(screen.getByText('En journée, ou en soirée avec 20 € de supplément')).toBeInTheDocument();
    expect(order()).toEqual(['bath', 'tiles']);
    fireEvent.click(screen.getByRole('button', { name: 'Programmer' }));
    expect(await screen.findByText('1 h offerte')).toBeInTheDocument();
  });

  it('scheduled: the sessions, two buttons of the same kind stacked, after the tiles; « Changer une séance » opens the contacts', async () => {
    stubApi(routes([card({
      state: 'scheduled', title: 'Vos séances', detail: null, ownedMinutes: 0, offeredMinutes: 0,
      upcoming: [{ date: '2099-07-07', start: '18:00', end: '19:00', label: 'mar. 7 juil., 18 h – 19 h' }],
      actions: [{ key: 'add', label: 'Ajouter une heure' }, { key: 'change', label: 'Changer une séance' }],
    })]));
    renderApp('/');
    expect(await screen.findByText('mar. 7 juil., 18 h – 19 h')).toBeInTheDocument();
    expect(order()).toEqual(['tiles', 'bath']);
    const buttons = [...document.querySelectorAll('.bathcard .acts .btn')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Ajouter une heure', 'Changer une séance']);
    expect(buttons.every((b) => b.classList.contains('block'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Changer une séance' }));
    expect(await screen.findByRole('heading', { name: 'Urgences & contacts' })).toBeInTheDocument();
  });

  it('no card when `/me` has none', async () => {
    stubApi(routes([]));
    renderApp('/');
    await screen.findByText('Jour 2 sur 4');
    expect(document.querySelector('.bathcard')).toBeNull();
  });
});
